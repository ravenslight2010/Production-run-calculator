import { canWriteRunState } from "./write-gate.mjs";
import { STATIONS, calculateStationMetrics } from "/v2/core/station-workflows.mjs";
import { initializeInventory, updateInventoryContext } from "./inventory.js";

const API = "/api/v2/runs";
const AUTH_API = "/api/v2/auth";
const POLL_INTERVAL_MS = 3000;
const AUTO_TRACK_INTERVAL_MS = 1000;
const STATION_STATUSES = new Set(["not_started", "running", "paused", "completed"]);
const TIMER_STATUSES = new Set(["idle", "running", "paused"]);
const TIMER_FIELDS = new Set(["timerStatus", "timerStartedAt", "timerPausedAt", "timerElapsedMs"]);
const TRACKING_FIELDS = new Set(["autoTrackLastAt", "autoTrackRemainder"]);
const PENDING_PREFIX = "fieldline:v2:pending-command:";
const PENDING_CREATE_KEY = "fieldline:v2:pending-create";
const PENDING_STATION_PREFIX = "fieldline:v2:pending-station:";
const OFFLINE_CACHE_KEY = "fieldline:v2:last-confirmed-state";
const RUN_STATUSES = new Set(["planned", "running", "paused", "completed"]);
const COMMANDS = new Set(["start", "pause", "resume", "complete"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const el = {
  authPanel: document.querySelector("#auth-panel"),
  authStatus: document.querySelector("#auth-status"),
  authError: document.querySelector("#auth-error"),
  authErrorTitle: document.querySelector("#auth-error-title"),
  authErrorMessage: document.querySelector("#auth-error-message"),
  authForm: document.querySelector("#auth-form"),
  authUsername: document.querySelector("#auth-username"),
  authPassword: document.querySelector("#auth-password"),
  authSubmit: document.querySelector("#auth-submit"),
  authRetry: document.querySelector("#auth-retry"),
  setupToggle: document.querySelector("#setup-toggle"),
  bootstrapForm: document.querySelector("#bootstrap-form"),
  bootstrapCode: document.querySelector("#bootstrap-code"),
  bootstrapUsername: document.querySelector("#bootstrap-username"),
  bootstrapPassword: document.querySelector("#bootstrap-password"),
  bootstrapSubmit: document.querySelector("#bootstrap-submit"),
  setupCancel: document.querySelector("#setup-cancel"),
  authenticatedApp: document.querySelector("#authenticated-app"),
  staffPanel: document.querySelector("#staff-panel"),
  staffStatus: document.querySelector("#staff-status"),
  staffError: document.querySelector("#staff-error"),
  staffCreateForm: document.querySelector("#staff-create-form"),
  staffUsername: document.querySelector("#new-staff-username"),
  staffPassword: document.querySelector("#new-staff-password"),
  staffRole: document.querySelector("#new-staff-role"),
  staffCreateButton: document.querySelector("#create-staff-button"),
  staffList: document.querySelector("#staff-list"),
  accountControls: document.querySelector("#account-controls"),
  staffLabel: document.querySelector("#staff-label"),
  signOut: document.querySelector("#sign-out-button"),
  connection: document.querySelector("#connection-indicator"),
  connectionLabel: document.querySelector("#connection-label"),
  lastCheck: document.querySelector("#last-check"),
  globalError: document.querySelector("#global-error"),
  errorTitle: document.querySelector("#error-title"),
  errorMessage: document.querySelector("#error-message"),
  refresh: document.querySelector("#refresh-button"),
  runContent: document.querySelector("#run-content"),
  revision: document.querySelector("#revision-value"),
  runsList: document.querySelector("#runs-list"),
  runCount: document.querySelector("#run-count"),
  createForm: document.querySelector("#create-form"),
  createButton: document.querySelector("#create-button"),
  createNote: document.querySelector("#create-note"),
  label: document.querySelector("#setup-label"),
  target: document.querySelector("#target-cases"),
  announcer: document.querySelector("#live-announcer"),
  stationPanel: document.querySelector("#station-panel"),
  stationTabs: document.querySelector("#station-tabs"),
  stationLabel: document.querySelector("#station-label"),
  stationState: document.querySelector("#station-state"),
  stationRevision: document.querySelector("#station-revision"),
  stationMetrics: document.querySelector("#station-metrics"),
  stationForm: document.querySelector("#station-form"),
  stationFields: document.querySelector("#station-fields"),
  stationSaveButton: document.querySelector("#station-save-button"),
  stationSaveNote: document.querySelector("#station-save-note"),
  stationTimerValue: document.querySelector("#station-timer-value"),
  stationTimerControls: document.querySelector("#station-timer-controls"),
};

let runs = [];
let selectedRunId = null;
let refreshInFlight = false;
let createInFlight = false;
let commandInFlight = false;
let authCheckInFlight = false;
let authInFlight = false;
let signOutInFlight = false;
let currentStaff = null;
let authGeneration = 0;
let bootstrapAvailable = false;
let bootstrapStatusInFlight = false;
let bootstrapInFlight = false;
let staffInFlight = false;
let staffGeneration = 0;
let staffDirectory = null;
let serverStateConfirmed = false;
let lastKnownRun = null;
let selectedStationKey = "line";
let stationActionInFlight = false;
let stationConflictDraft = null;
let cachedServerClock = null;
let pendingCreate = loadPendingCreate();

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getCsrfHeaders() {
  try {
    const cookie = document.cookie.split(";").map((part) => part.trim());
    const values = cookie.filter((part) => part.startsWith("v2_csrf="));
    if (values.length !== 1) return null;
    const token = values[0].slice("v2_csrf=".length);
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? { "X-CSRF-Token": token } : null;
  } catch {
    return null;
  }
}

function isTimestamp(value, nullable = false) {
  if (nullable && value === null) return true;
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function validateRun(run) {
  if (!isObject(run) || typeof run.id !== "string" || !UUID.test(run.id)
    || !RUN_STATUSES.has(run.status) || !Number.isSafeInteger(run.revision) || run.revision < 0
    || !isTimestamp(run.createdAt) || !isTimestamp(run.updatedAt)
    || !isTimestamp(run.startedAt, true) || !isTimestamp(run.pausedAt, true)
    || !isTimestamp(run.resumedAt, true) || !isTimestamp(run.completedAt, true)
    || !isObject(run.setupSnapshot) || typeof run.setupSnapshot.label !== "string"
    || !run.setupSnapshot.label.trim() || !Number.isSafeInteger(run.setupSnapshot.targetCases)
    || run.setupSnapshot.targetCases < 1 || !Array.isArray(run.pauseIntervals)) {
    throw new Error("The server returned run data in an unexpected format. Refresh to load the current state.");
  }
  if (run.serverNow !== undefined && !isTimestamp(run.serverNow)) {
    throw new Error("The server returned an invalid server clock. Refresh to load the current state.");
  }
  if (typeof run.serverNow === "string") {
    cachedServerClock = { serverMs: Date.parse(run.serverNow), receivedAt: performance.now() };
  }
  if (run.stationProgress !== undefined) {
    if (!isObject(run.stationProgress)) {
      throw new Error("The server returned station data in an unexpected format. Refresh to load the current state.");
    }
    for (const [stationKey, state] of Object.entries(run.stationProgress)) {
      const definition = STATIONS[stationKey];
      const progressFields = new Set([...definition?.progress || [], ...TIMER_FIELDS, ...TRACKING_FIELDS]);
      if (!Object.hasOwn(STATIONS, stationKey) || !isObject(state)
        || !Number.isSafeInteger(state.revision) || state.revision < 0
        || !STATION_STATUSES.has(state.status)
        || !isObject(state.inputs) || !isObject(state.progress)
        || Object.entries(state.inputs).some(([key, value]) =>
          !definition.inputs.includes(key) || typeof value !== "number" || !Number.isFinite(value) || value < 0)
        || Object.entries(state.progress).some(([key, value]) => {
          if (!progressFields.has(key)) return true;
          if (key === "timerStatus") return !TIMER_STATUSES.has(value);
          if (key === "timerStartedAt" || key === "timerPausedAt" || key === "autoTrackLastAt") return !isTimestamp(value, true);
          return typeof value !== "number" || !Number.isFinite(value) || value < 0;
        })
        || !isTimestamp(state.updatedAt)
        || !isTimestamp(state.startedAt, true)
        || !isTimestamp(state.pausedAt, true)
        || !isTimestamp(state.completedAt, true)
        || !isTimestamp(state.nextDueAt, true)) {
        throw new Error("The server returned invalid station progress. Refresh to load the current state.");
      }
    }
  }
  for (const interval of run.pauseIntervals) {
    if (!isObject(interval) || !isTimestamp(interval.startedAt) || !isTimestamp(interval.endedAt, true)) {
      throw new Error("The server returned run history in an unexpected format. Refresh to load the current state.");
    }
  }
  return run;
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function readJson(response, { allowCommandConflict = false, allowStationConflict = false } = {}) {
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("The server response could not be read. Refresh and try again.");
  }
  const knownCommandConflict = allowCommandConflict && response.status === 409
    && ["conflict", "invalid_transition"].includes(body?.outcome);
  const knownStationConflict = allowStationConflict && response.status === 409
    && ["conflict", "invalid_transition"].includes(body?.outcome);
  if (!response.ok && !knownCommandConflict && !knownStationConflict) {
    const message = isObject(body) && typeof body.error === "string"
      ? body.error
      : "The request was not accepted. Refresh the run state before trying again.";
    throw new ApiError(response.status, message);
  }
  if (!isObject(body)) throw new Error("The server returned an unexpected response. Refresh and try again.");
  return body;
}

function announce(message) {
  el.announcer.textContent = "";
  window.setTimeout(() => { el.announcer.textContent = message; }, 20);
}

function showError(message, title = "Could not update run state") {
  el.errorTitle.textContent = title;
  el.errorMessage.textContent = message;
  el.globalError.hidden = false;
}

function clearError() {
  el.globalError.hidden = true;
}

function isStaffRecord(staff) {
  return isObject(staff)
    && typeof staff.userId === "string"
    && UUID.test(staff.userId)
    && typeof staff.username === "string"
    && staff.username.length >= 3
    && staff.username.length <= 40
    && typeof staff.role === "string"
    && staff.role.length > 0
    && Array.isArray(staff.capabilities)
    && staff.capabilities.length <= 100
    && staff.capabilities.every((capability) => typeof capability === "string" && capability.length <= 80);
}

function clearUserScopedState() {
  authGeneration += 1;
  runs = [];
  selectedRunId = null;
  lastKnownRun = null;
  serverStateConfirmed = false;
  stationConflictDraft = null;
  updateInventoryContext(currentStaff, false);
  render();
}

function canWriteNow() {
  return canWriteRunState({
    authenticated: Boolean(currentStaff),
    online: typeof navigator === "undefined" || navigator.onLine !== false,
    serverStateConfirmed,
  });
}

function enterOfflineMode() {
  serverStateConfirmed = false;
  updateInventoryContext(currentStaff, false);
  setConnection(false);
  updateCreateFormForAuth();
  renderRun(selectedRun());
  renderStationPanel(selectedRun());
  if (currentStaff) {
    saveOfflineCache();
    showError("This device is offline. V2 is read-only until a fresh server check succeeds.", "Offline — read-only");
  }
}

function saveOfflineCache() {
  if (!currentStaff || runs.length === 0) return;
  try {
    localStorage.setItem(OFFLINE_CACHE_KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      staff: {
        userId: currentStaff.userId,
        username: currentStaff.username,
        role: currentStaff.role,
        capabilities: currentStaff.capabilities,
      },
      runs,
      selectedRunId,
      stationKey: selectedStationKey,
    }));
  } catch {
    // A full browser store must not prevent online or offline read-only use.
  }
}

function clearOfflineCache() {
  try {
    localStorage.removeItem(OFFLINE_CACHE_KEY);
  } catch {
    // Cache cleanup is best-effort; it never changes server authorization.
  }
}

function restoreOfflineCache() {
  try {
    const saved = JSON.parse(localStorage.getItem(OFFLINE_CACHE_KEY) || "null");
    if (!isObject(saved) || !isStaffRecord(saved.staff) || !Array.isArray(saved.runs)
      || saved.runs.length > 100 || !isTimestamp(saved.savedAt)) return null;
    const cachedRuns = saved.runs.map(validateRun);
    if (!cachedRuns.length) return null;
    return {
      staff: saved.staff,
      runs: cachedRuns,
      selectedRunId: UUID.test(saved.selectedRunId || "") ? saved.selectedRunId : null,
      stationKey: Object.hasOwn(STATIONS, saved.stationKey) ? saved.stationKey : "line",
      savedAt: saved.savedAt,
    };
  } catch {
    return null;
  }
}

function showOfflineCachedSession(saved) {
  authGeneration += 1;
  currentStaff = saved.staff;
  runs = saved.runs;
  selectedRunId = runs.some((run) => run.id === saved.selectedRunId)
    ? saved.selectedRunId
    : runs.find((run) => run.status === "running" || run.status === "paused")?.id || runs[0]?.id || null;
  selectedStationKey = saved.stationKey;
  lastKnownRun = selectedRun();
  serverStateConfirmed = false;
  el.authPanel.hidden = true;
  el.authenticatedApp.hidden = false;
  el.accountControls.hidden = false;
  el.staffLabel.textContent = `${saved.staff.username} · ${saved.staff.role}`;
  el.signOut.disabled = false;
  setConnection(false);
  updateCreateFormForAuth();
  render();
  const savedTime = new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(saved.savedAt));
  showError(`Showing the last server-confirmed state saved ${savedTime}. Changes are unavailable until the connection is confirmed.`, "Offline — read-only");
}

function requireWritableState() {
  if (!currentStaff) {
    showSignIn("Sign in to load the current server state before changing anything.");
    return false;
  }
  if (navigator.onLine === false) {
    enterOfflineMode();
    return false;
  }
  if (!serverStateConfirmed) {
    showError("The server has not confirmed current state. Refresh and wait for confirmation before changing anything.", "Read-only until refreshed");
    return false;
  }
  return true;
}

function updateCreateFormForAuth() {
  const writable = canWriteNow();
  if (!pendingCreate) {
    el.label.disabled = createInFlight || !writable;
    el.target.disabled = createInFlight || !writable;
    el.createButton.disabled = createInFlight || !writable;
    el.createButton.textContent = "Prepare run";
    return;
  }
  el.label.disabled = true;
  el.target.disabled = true;
  const belongsToCurrentStaff = currentStaff?.userId === pendingCreate.actorId;
  el.createButton.disabled = !belongsToCurrentStaff || createInFlight || !writable;
  el.createButton.textContent = belongsToCurrentStaff ? "Retry same request" : "Another account's request";
  el.createNote.textContent = belongsToCurrentStaff
    ? "The server may have received this request. Retry uses the same request ID and run details."
    : "This unconfirmed request belongs to another staff account. Sign in as that person to confirm it.";
}

function showAuthError(title, message) {
  el.authErrorTitle.textContent = title;
  el.authErrorMessage.textContent = message;
  el.authError.hidden = false;
}

function showSignIn(message = null, { title = "Sign-in needed", retry = false } = {}) {
  if (currentStaff) {
    clearOfflineCache();
    clearUserScopedState();
  }
  currentStaff = null;
  staffGeneration += 1;
  staffDirectory = null;
  updateInventoryContext(null, false);
  el.authPanel.hidden = false;
  el.authForm.hidden = false;
  el.bootstrapForm.hidden = true;
  el.setupToggle.hidden = !bootstrapAvailable;
  el.setupToggle.setAttribute("aria-expanded", "false");
  el.authSubmit.disabled = authInFlight;
  el.authRetry.hidden = !retry;
  el.authStatus.textContent = message ? "Your session is not confirmed." : "Sign in to load the current server state.";
  el.accountControls.hidden = true;
  el.staffPanel.hidden = true;
  el.authenticatedApp.hidden = true;
  if (message) showAuthError(title, message);
  else el.authError.hidden = true;
  updateCreateFormForAuth();
  if (!authInFlight) {
    window.requestAnimationFrame(() => el.authUsername.focus());
  }
  void refreshBootstrapAvailability();
}

function showAuthenticated(staff) {
  if (!isStaffRecord(staff)) {
    throw new Error("The server returned an unexpected staff session. Sign in again.");
  }
  if (currentStaff?.userId !== staff.userId) clearUserScopedState();
  currentStaff = staff;
  serverStateConfirmed = false;
  updateInventoryContext(currentStaff, false);
  el.authPanel.hidden = true;
  el.bootstrapForm.hidden = true;
  el.setupToggle.hidden = true;
  el.authError.hidden = true;
  el.accountControls.hidden = false;
  el.authenticatedApp.hidden = false;
  el.staffLabel.textContent = `${staff.username} · ${staff.role}`;
  el.signOut.disabled = false;
  updateCreateFormForAuth();
  const canManageStaff = staffManagementAllowed(staff);
  el.staffPanel.hidden = !canManageStaff;
  if (canManageStaff) void loadStaffDirectory();
  announce(`Signed in as ${staff.username}.`);
  setConnection(true);
  document.querySelector("#page-title")?.focus();
  void fetchRuns();
}

function staffManagementAllowed(staff = currentStaff) {
  return isStaffRecord(staff) && staff.capabilities.includes("manage-staff");
}

async function refreshBootstrapAvailability() {
  if (currentStaff || bootstrapInFlight || bootstrapStatusInFlight) return;
  bootstrapStatusInFlight = true;
  const requestGeneration = authGeneration;
  let available = false;
  let statusError = false;
  try {
    const response = await fetch(`${AUTH_API}/bootstrap-status`, {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const body = await readJson(response);
    if (typeof body.available !== "boolean") throw new Error("Setup status was incomplete.");
    available = body.available;
  } catch {
    available = false;
    statusError = true;
  } finally {
    bootstrapStatusInFlight = false;
  }
  if (currentStaff || requestGeneration !== authGeneration) return;
  if (statusError) {
    bootstrapAvailable = false;
    el.setupToggle.hidden = true;
    el.bootstrapForm.hidden = true;
    el.authForm.hidden = false;
    el.authStatus.textContent = "First-manager setup could not be checked.";
    el.authRetry.hidden = false;
    showAuthError("Setup status unavailable", "The app could not confirm whether first-manager setup is available. Check the connection, then try again.");
    return;
  }
  bootstrapAvailable = available;
  el.setupToggle.hidden = !bootstrapAvailable;
  if (!bootstrapAvailable) {
    el.bootstrapForm.hidden = true;
    el.authForm.hidden = false;
    el.setupToggle.setAttribute("aria-expanded", "false");
  }
}

function toggleBootstrapForm(show) {
  if (!bootstrapAvailable || bootstrapInFlight) return;
  el.authForm.hidden = show;
  el.bootstrapForm.hidden = !show;
  el.setupToggle.hidden = show;
  el.setupToggle.setAttribute("aria-expanded", String(show));
  el.authError.hidden = true;
  if (show) el.bootstrapCode.focus();
  else el.authUsername.focus();
}

async function submitBootstrap(event) {
  event.preventDefault();
  if (bootstrapInFlight || !bootstrapAvailable) return;
  bootstrapInFlight = true;
  el.bootstrapSubmit.disabled = true;
  el.authError.hidden = true;
  try {
    const response = await fetch(`${AUTH_API}/bootstrap`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        bootstrapCode: el.bootstrapCode.value,
        username: el.bootstrapUsername.value,
        password: el.bootstrapPassword.value,
      }),
    });
    const body = await readJson(response);
    if (!isStaffRecord(body.staff) || !isTimestamp(body.expiresAt)) {
      throw new Error("The server returned an incomplete setup result. Try again.");
    }
    bootstrapAvailable = false;
    el.bootstrapForm.reset();
    showAuthenticated(body.staff);
  } catch (error) {
    el.bootstrapCode.value = "";
    el.bootstrapPassword.value = "";
    showAuthError(
      error instanceof ApiError && error.status === 409 ? "Setup already completed" : "First-manager setup failed",
      error instanceof Error ? error.message : "Check the setup code and try again.",
    );
    if (error instanceof ApiError && error.status === 409) void refreshBootstrapAvailability();
  } finally {
    bootstrapInFlight = false;
    el.bootstrapSubmit.disabled = false;
  }
}

function isStaffDirectory(body) {
  return isObject(body)
    && Array.isArray(body.staff)
    && body.staff.length <= 200
    && body.staff.every((staff) => isObject(staff)
      && typeof staff.userId === "string"
      && UUID.test(staff.userId)
      && typeof staff.username === "string"
      && staff.username.length >= 3
      && staff.username.length <= 40
      && typeof staff.role === "string"
      && staff.role.length > 0
      && typeof staff.disabled === "boolean"
      && isTimestamp(staff.createdAt))
    && Array.isArray(body.roles)
    && body.roles.length <= 100
    && body.roles.every((role) => isObject(role)
      && typeof role.name === "string"
      && role.name.length > 0
      && role.name.length <= 80
      && Array.isArray(role.capabilities)
      && role.capabilities.length <= 100
      && role.capabilities.every((capability) => typeof capability === "string" && capability.length <= 80));
}

function showStaffError(message) {
  el.staffError.textContent = message;
  el.staffError.hidden = false;
}

function clearStaffError() {
  el.staffError.hidden = true;
  el.staffError.textContent = "";
}

function renderStaffDirectory(directory) {
  staffDirectory = directory;
  el.staffRole.innerHTML = directory.roles
    .map((role) => `<option value="${escapeHtml(role.name)}">${escapeHtml(role.name)}</option>`)
    .join("");
  if (directory.staff.length === 0) {
    el.staffList.innerHTML = '<tr><td colspan="4">No staff accounts yet.</td></tr>';
    return;
  }
  el.staffList.innerHTML = directory.staff.map((staff) => {
    const self = staff.userId === currentStaff?.userId;
    const roleOptions = directory.roles.map((role) => `<option value="${escapeHtml(role.name)}" ${role.name === staff.role ? "selected" : ""}>${escapeHtml(role.name)}</option>`).join("");
    const actionMarkup = self
      ? '<span class="staff-self-note">Your account</span>'
      : `<div class="staff-actions">
          <label class="visually-hidden" for="staff-role-${escapeHtml(staff.userId)}">Role for ${escapeHtml(staff.username)}</label>
          <select id="staff-role-${escapeHtml(staff.userId)}" data-staff-role="${escapeHtml(staff.userId)}" ${staffInFlight ? "disabled" : ""}>${roleOptions}</select>
          <button type="button" class="staff-action-button" data-staff-action="role" data-staff-id="${escapeHtml(staff.userId)}" ${staffInFlight ? "disabled" : ""}>Save role</button>
          <button type="button" class="staff-action-button ${staff.disabled ? "" : "danger"}" data-staff-action="status" data-staff-id="${escapeHtml(staff.userId)}" ${staffInFlight ? "disabled" : ""}>${staff.disabled ? "Enable" : "Disable"}</button>
        </div>`;
    return `<tr>
      <th scope="row">${escapeHtml(staff.username)}</th>
      <td data-label="Status"><span class="staff-state ${staff.disabled ? "disabled" : "enabled"}">${staff.disabled ? "Disabled" : "Enabled"}</span></td>
      <td data-label="Role">${escapeHtml(staff.role)}</td>
      <td data-label="Actions">${actionMarkup}</td>
    </tr>`;
  }).join("");
}

async function loadStaffDirectory() {
  if (!staffManagementAllowed() || staffInFlight) return;
  const generation = ++staffGeneration;
  el.staffStatus.textContent = "Loading staff accounts…";
  clearStaffError();
  try {
    const response = await fetch(`${AUTH_API}/staff`, {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const body = await readJson(response);
    if (!isStaffDirectory(body)) throw new Error("The server returned an unexpected staff list.");
    if (generation !== staffGeneration || !staffManagementAllowed()) return;
    renderStaffDirectory(body);
    el.staffStatus.textContent = `${body.staff.length} staff account${body.staff.length === 1 ? "" : "s"}`;
  } catch (error) {
    if (generation !== staffGeneration) return;
    if (error instanceof ApiError && error.status === 401) {
      showSignIn("Your session has ended. Sign in again to manage staff accounts.");
      return;
    }
    el.staffStatus.textContent = "Staff accounts could not be loaded.";
    showStaffError(error instanceof Error ? error.message : "Refresh and try again.");
  }
}

async function sendStaffMutation(url, method, body) {
  if (!staffManagementAllowed() || staffInFlight) return;
  if (navigator.onLine === false) {
    showStaffError("Reconnect before changing staff accounts.");
    return;
  }
  const csrf = getCsrfHeaders();
  if (!csrf) {
    showStaffError("Refresh your session before changing staff accounts.");
    return;
  }
  staffInFlight = true;
  el.staffCreateButton.disabled = true;
  clearStaffError();
  try {
    const response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...csrf,
      },
      body: JSON.stringify(body),
    });
    const result = await readJson(response);
    if (!isStaffDirectory(result)) throw new Error("The server returned an unexpected staff list.");
    renderStaffDirectory(result);
    el.staffStatus.textContent = `${result.staff.length} staff account${result.staff.length === 1 ? "" : "s"}`;
    announce("Staff account changes saved.");
    return result;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      showSignIn("Your session has ended. Sign in again to manage staff accounts.");
      return;
    }
    showStaffError(error instanceof Error ? error.message : "The change could not be confirmed. Refresh and try again.");
  } finally {
    staffInFlight = false;
    el.staffCreateButton.disabled = false;
    if (staffDirectory) renderStaffDirectory(staffDirectory);
  }
}

async function submitStaffCreate(event) {
  event.preventDefault();
  if (staffInFlight) return;
  const result = await sendStaffMutation(`${AUTH_API}/staff`, "POST", {
    username: el.staffUsername.value,
    password: el.staffPassword.value,
    roleName: el.staffRole.value,
  });
  if (result) {
    el.staffCreateForm.reset();
    if (staffDirectory?.roles.length) el.staffRole.value = staffDirectory.roles[0].name;
  } else {
    el.staffPassword.value = "";
  }
}

async function handleStaffAction(event) {
  const button = event.target.closest("[data-staff-action]");
  if (!button || staffInFlight) return;
  const staff = staffDirectory?.staff.find((item) => item.userId === button.dataset.staffId);
  if (!staff || staff.userId === currentStaff?.userId) return;
  const patch = button.dataset.staffAction === "role"
    ? { roleName: el.staffList.querySelector(`[data-staff-role="${CSS.escape(staff.userId)}"]`)?.value }
    : { disabled: !staff.disabled };
  if (patch.roleName === undefined && button.dataset.staffAction === "role") {
    showStaffError("Choose a role before saving.");
    return;
  }
  await sendStaffMutation(`${AUTH_API}/staff/${encodeURIComponent(staff.userId)}`, "PATCH", patch);
}

async function checkSession() {
  if (authCheckInFlight || authInFlight) return;
  authCheckInFlight = true;
  el.authStatus.textContent = "Checking your saved session…";
  el.authForm.hidden = true;
  el.authRetry.hidden = true;
  el.authError.hidden = true;
  try {
    const response = await fetch(`${AUTH_API}/session`, {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (response.status === 401) {
      setConnection(true);
      clearOfflineCache();
      showSignIn();
      return;
    }
    const body = await readJson(response);
    showAuthenticated(body.staff);
  } catch (error) {
    setConnection(false);
    const saved = restoreOfflineCache();
    if (saved) {
      showOfflineCachedSession(saved);
      return;
    }
    showSignIn(
      "The app could not verify the saved session. Check the connection, then try again.",
      { title: "Session check unavailable", retry: true },
    );
  } finally {
    authCheckInFlight = false;
  }
}

async function submitSignIn(event) {
  event.preventDefault();
  if (authInFlight) return;
  authInFlight = true;
  el.authSubmit.disabled = true;
  el.authStatus.textContent = "Checking your staff account…";
  el.authError.hidden = true;
  el.authUsername.removeAttribute("aria-invalid");
  el.authPassword.removeAttribute("aria-invalid");
  try {
    const response = await fetch(`${AUTH_API}/sign-in`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        username: el.authUsername.value,
        password: el.authPassword.value,
      }),
    });
    const body = await readJson(response);
    if (!isStaffRecord(body.staff) || !isTimestamp(body.expiresAt)) {
      throw new Error("The server returned an incomplete sign-in result. Try again.");
    }
    el.authForm.reset();
    showAuthenticated(body.staff);
  } catch (error) {
    el.authPassword.value = "";
    if (error instanceof ApiError && error.status === 401) {
      el.authUsername.setAttribute("aria-invalid", "true");
      el.authPassword.setAttribute("aria-invalid", "true");
    }
    showAuthError(
      error instanceof ApiError && error.status === 401 ? "Sign-in failed" : "Sign-in could not be completed",
      error instanceof Error ? error.message : "Check your connection and try again.",
    );
    el.authStatus.textContent = "Your run state is not loaded until sign-in succeeds.";
  } finally {
    authInFlight = false;
    if (!currentStaff) el.authSubmit.disabled = false;
  }
}

async function signOut() {
  if (!currentStaff || authInFlight || signOutInFlight || createInFlight || commandInFlight || stationActionInFlight) return;
  const csrf = getCsrfHeaders();
  if (!csrf) {
    showError("Your CSRF session token is unavailable. Refresh the session before signing out.", "Sign-out unavailable");
    return;
  }
  signOutInFlight = true;
  el.signOut.disabled = true;
  try {
    const response = await fetch(`${AUTH_API}/sign-out`, {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json", ...csrf },
    });
    if (response.status !== 204) await readJson(response);
    clearOfflineCache();
    showSignIn("You are signed out. Sign in again to load current server state.");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      clearOfflineCache();
      showSignIn("Your session has ended. Sign in again to load current server state.");
    } else {
      showError(error instanceof Error ? error.message : "The sign-out result is not confirmed. Check the connection and try again.", "Sign-out not confirmed");
    }
  } finally {
    signOutInFlight = false;
    el.signOut.disabled = false;
  }
}

function setConnection(online) {
  el.connection.dataset.state = online ? "online" : "offline";
  el.connectionLabel.textContent = online ? "Connected" : "Offline";
}

function setLastCheck() {
  el.lastCheck.textContent = new Intl.DateTimeFormat(undefined, {
    hour: "numeric", minute: "2-digit", second: "2-digit",
  }).format(new Date());
}

function formatDate(value) {
  if (!value) return "Not started";
  return new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(value));
}

function statusLabel(status) {
  return status.replace("_", " ");
}

function pendingStorageKey(runId) {
  return `${PENDING_PREFIX}${runId}`;
}

function loadPendingCreate() {
  try {
    const raw = localStorage.getItem(PENDING_CREATE_KEY);
    if (!raw) return null;
    const pending = JSON.parse(raw);
    if (!isObject(pending) || !UUID.test(pending.requestId) || !UUID.test(pending.actorId)
      || !isObject(pending.setupSnapshot)
      || typeof pending.setupSnapshot.label !== "string" || !pending.setupSnapshot.label.trim()
      || !Number.isSafeInteger(pending.setupSnapshot.targetCases) || pending.setupSnapshot.targetCases < 1) return null;
    return pending;
  } catch {
    return null;
  }
}

function savePendingCreate(pending) {
  try {
    localStorage.setItem(PENDING_CREATE_KEY, JSON.stringify(pending));
    pendingCreate = pending;
    el.label.value = pending.setupSnapshot.label;
    el.target.value = String(pending.setupSnapshot.targetCases);
    updateCreateFormForAuth();
  } catch {
    pendingCreate = null;
    showError("This device could not save the request identity. Run creation is paused; refresh the register before trying again.", "Retry protection unavailable");
  }
}

function clearPendingCreate() {
  try {
    localStorage.removeItem(PENDING_CREATE_KEY);
    pendingCreate = null;
    updateCreateFormForAuth();
  } catch {
    showError("The server returned a result, but this device could not clear the saved request identity. Refresh the register before creating another run.", "Local storage unavailable");
  }
}

function getPending(runId) {
  try {
    const raw = localStorage.getItem(pendingStorageKey(runId));
    if (!raw) return null;
    const pending = JSON.parse(raw);
    if (!isObject(pending) || !UUID.test(pending.commandId) || !UUID.test(pending.actorId)
      || !COMMANDS.has(pending.commandType)
      || !Number.isSafeInteger(pending.expectedRevision) || pending.expectedRevision < 0
      || pending.runId !== runId) return null;
    return pending;
  } catch {
    return null;
  }
}

function storePending(pending) {
  try {
    localStorage.setItem(pendingStorageKey(pending.runId), JSON.stringify(pending));
    return true;
  } catch {
    showError("This device could not save the retry identity. Do not repeat the action on another device; refresh to check the server state.", "Retry protection unavailable");
    return false;
  }
}

function clearPending(runId) {
  try {
    localStorage.removeItem(pendingStorageKey(runId));
  } catch {
    showError("The server responded, but this device could not clear its saved retry identity. Refresh state before another action.", "Local storage unavailable");
  }
}

function renderRun(run) {
  el.revision.textContent = run ? `REV ${String(run.revision).padStart(2, "0")}` : "—";
  if (!run) {
    el.runContent.innerHTML = `<div class="status-row"><span class="status-pill planned">No run selected</span></div>
      <h2 class="run-label" id="run-label">Ready when you are</h2>
      <p class="run-meta">Prepare a run below to begin production control.</p>
      <div class="run-divider"></div><p class="control-label">RUN CONTROLS</p>
      <p class="control-note">Create a planned run before starting production.</p>`;
    return;
  }
  const pending = getPending(run.id);
  const pendingOwnedByCurrentStaff = pending?.actorId === currentStaff?.userId;
  const actions = {
    planned: [["start", "Start run", "primary"]],
    running: [["pause", "Pause run", "secondary"], ["complete", "Finish run", "caution"]],
    paused: [["resume", "Resume run", "primary"], ["complete", "Finish run", "caution"]],
    completed: [],
  }[run.status];
  const actionMarkup = actions.length
    ? actions.map(([command, label, style]) => `<button class="button button-${style}" type="button" data-command="${command}" data-testid="button-${command}" ${pending || commandInFlight || !canWriteNow() ? "disabled" : ""}>${label}${command === "start" || command === "resume" ? '<span class="button-arrow" aria-hidden="true">→</span>' : ""}</button>`).join("")
    : `<p class="control-note">This run is finished. Its state remains available in the server register.</p>`;
  const pendingMarkup = pending
    ? `<div class="pending-box" role="status"><p><strong>${pendingOwnedByCurrentStaff ? `${escapeHtml(commandTitle(pending.commandType))} needs confirmation.` : "This saved action belongs to another staff account."}</strong> ${pendingOwnedByCurrentStaff ? "The request may have reached the server. Retry sends the same command identity." : "Sign in as the original operator to confirm it. It will not be resent under this account."}</p>${pendingOwnedByCurrentStaff ? `<button type="button" data-retry-command="true" data-testid="button-retry-command" ${commandInFlight || !canWriteNow() ? "disabled" : ""}>Retry same action</button>` : ""}</div>`
    : "";
  el.runContent.innerHTML = `<div class="status-row"><span class="status-pill ${run.status}" data-testid="status-run">${statusLabel(run.status)}</span></div>
    <h2 class="run-label" id="run-label" data-testid="text-run-label">${escapeHtml(run.setupSnapshot.label)}</h2>
    <div class="run-meta"><span><i class="meta-marker" aria-hidden="true"></i>${run.setupSnapshot.targetCases.toLocaleString()} target cases</span><span><i class="meta-marker" aria-hidden="true"></i>${run.startedAt ? `Started ${escapeHtml(formatDate(run.startedAt))}` : `Created ${escapeHtml(formatDate(run.createdAt))}`}</span></div>
    <div class="run-divider"></div><p class="control-label">RUN CONTROLS</p>
    <div class="controls">${actionMarkup}</div>${pendingMarkup}`;
  el.runContent.querySelectorAll("[data-command]").forEach((button) => {
    button.addEventListener("click", () => beginCommand(run, button.dataset.command));
  });
  const retry = el.runContent.querySelector("[data-retry-command]");
  if (retry) retry.addEventListener("click", () => retryCommand(run.id));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function commandTitle(command) {
  return ({ start: "Start run", pause: "Pause run", resume: "Resume run", complete: "Finish run" })[command] || "Run action";
}

function renderRuns() {
  el.runCount.textContent = String(runs.length);
  if (runs.length === 0) {
    el.runsList.innerHTML = `<div class="empty-runs">No runs are registered yet. Prepare a run to put it on the floor.</div>`;
    return;
  }
  const ordered = [...runs].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  el.runsList.innerHTML = ordered.map((run) => `<button type="button" class="run-item" data-run-id="${escapeHtml(run.id)}" aria-current="${run.id === selectedRunId ? "true" : "false"}" data-testid="button-select-run-${escapeHtml(run.id)}">
    <span class="run-item-top"><span class="run-item-name">${escapeHtml(run.setupSnapshot.label)}</span><span class="mini-status" data-status="${run.status}">${statusLabel(run.status)}</span></span>
    <span class="run-item-detail"><span>${run.setupSnapshot.targetCases.toLocaleString()} cases</span><span>REV ${run.revision}</span></span>
  </button>`).join("");
  el.runsList.querySelectorAll("[data-run-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedRunId = button.dataset.runId;
      lastKnownRun = selectedRun();
      render();
    });
  });
}

function selectedRun() {
  return runs.find((run) => run.id === selectedRunId) || null;
}

function mergeServerRuns(serverRuns, currentRuns) {
  const currentById = new Map(currentRuns.map((run) => [run.id, run]));
  const merged = serverRuns.map((serverRun) => {
    const currentRun = currentById.get(serverRun.id);
    currentById.delete(serverRun.id);
    return currentRun && currentRun.revision > serverRun.revision ? currentRun : serverRun;
  });
  merged.push(...currentById.values());
  return merged;
}

function render() {
  renderRuns();
  renderRun(selectedRun());
  renderStationPanel(selectedRun());
}

const STATION_FIELD_META = Object.freeze({
  autoTrackRatePerMinute: ["Auto-track rate", "cases / minute"],
  timerDurationSeconds: ["Timer duration", "seconds"],
  casesPerSkid: ["Cases per skid", "cases"],
  casesPerBatch: ["Cases per dough batch", "cases"],
  traysPerBatch: ["Trays per dough batch", "trays"],
  pizzasPerCase: ["Pizzas per case", "pizzas"],
  ozPerPizza: ["Ounces per pizza", "oz"],
  batchLbs: ["Pounds per batch", "lb"],
  barrelLbs: ["Pounds per Sauce barrel", "lb"],
  casesProduced: ["Cases produced", "cases"],
  casesOnLine: ["Cases on line", "cases"],
  casesInFreezer: ["Cases in freezer", "cases"],
  traysOnLine: ["Trays on line", "trays"],
  batchesReady: ["Batches ready", "batches"],
  batchesMade: ["Batches made", "batches"],
  casesCompleted: ["Cases completed", "cases"],
  stockOnLineLbs: ["Stock on line", "lb"],
  casesPacked: ["Cases packed", "cases"],
  barrelsMade: ["Full barrels made", "barrels"],
  stockBarrels: ["Barrels on hand", "barrels"],
  stockConsumedLbs: ["Stock consumed", "lb"],
});

const STATION_METRIC_LABELS = Object.freeze({
  targetCases: "Run target",
  casesRemaining: "Cases remaining",
  workInProgress: "Work in progress",
  completionPercent: "Run completion",
  casesProduced: "Cases produced",
  batchesNeeded: "Batches needed",
  batchesRemaining: "Batches remaining",
  casesPacked: "Cases packed",
  skidsNeeded: "Skids needed",
  completedSkids: "Completed skids",
  casesOnCurrentSkid: "Cases on current skid",
  casesCompleted: "Cases completed",
  ingredientLbsNeeded: "Ingredient needed",
  totalIngredientLbs: "Total ingredient needed",
  barrelsNeeded: "Barrels needed",
  barrelsMade: "Barrels made",
  barrelsRemaining: "Barrels remaining",
  stockBarrels: "Barrels on hand",
  stockOnLineLbs: "Stock on line",
  stockConsumedLbs: "Stock consumed",
  batchesToMake: "Batches still to make",
});

function stationPendingKey(runId, stationKey) {
  return `${PENDING_STATION_PREFIX}${runId}:${stationKey}`;
}

function loadPendingStation(runId, stationKey) {
  try {
    const pending = JSON.parse(localStorage.getItem(stationPendingKey(runId, stationKey)) || "null");
    if (!isObject(pending) || pending.runId !== runId || pending.stationKey !== stationKey
      || !UUID.test(pending.commandId) || !UUID.test(pending.actorId)
      || !Number.isSafeInteger(pending.expectedRevision) || pending.expectedRevision < 0
      || !["manual", "timer_start", "timer_pause", "timer_resume", "timer_reset"].includes(pending.mode)
      || !isObject(pending.changes)) return null;
    return pending;
  } catch {
    return null;
  }
}

function savePendingStation(pending) {
  try {
    localStorage.setItem(stationPendingKey(pending.runId, pending.stationKey), JSON.stringify(pending));
    return true;
  } catch {
    showError("This device could not save the station retry identity. Refresh the run before making another edit.", "Retry protection unavailable");
    return false;
  }
}

function clearPendingStation(runId, stationKey) {
  try {
    localStorage.removeItem(stationPendingKey(runId, stationKey));
  } catch {
    showError("The server responded, but this device could not clear its saved station action. Refresh state before another edit.", "Local storage unavailable");
  }
}

function hasPendingStationCommand(runId) {
  return Object.keys(STATIONS).some((stationKey) => loadPendingStation(runId, stationKey) !== null);
}

function currentServerNowMs(run) {
  if (cachedServerClock && Number.isFinite(cachedServerClock.serverMs)) {
    return cachedServerClock.serverMs + Math.max(0, performance.now() - cachedServerClock.receivedAt);
  }
  return run?.serverNow ? Date.parse(run.serverNow) : Date.now();
}

function activeTimerElapsedMs(run, stationState) {
  const progress = stationState?.progress || {};
  const stored = Math.max(0, Number(progress.timerElapsedMs) || 0);
  if (progress.timerStatus !== "running" || !isTimestamp(progress.timerStartedAt)) return stored;
  const started = Date.parse(progress.timerStartedAt);
  const now = currentServerNowMs(run);
  if (!Number.isFinite(started) || !Number.isFinite(now)) return stored;
  let pausedMs = 0;
  for (const interval of run.pauseIntervals || []) {
    const pauseStart = Date.parse(interval.startedAt);
    const pauseEnd = interval.endedAt ? Date.parse(interval.endedAt) : now;
    if (!Number.isFinite(pauseStart) || !Number.isFinite(pauseEnd)) continue;
    pausedMs += Math.max(0, Math.min(now, pauseEnd) - Math.max(started, pauseStart));
  }
  return stored + Math.max(0, now - started - pausedMs);
}

function formatTimer(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function stationStateFor(run, stationKey) {
  return run?.stationProgress?.[stationKey] || { status: "not_started", revision: 0, inputs: {}, progress: {} };
}

function setStationSaveNote(message, state = "") {
  el.stationSaveNote.textContent = message;
  el.stationSaveNote.dataset.state = state;
}

function renderStationPanel(run) {
  if (!run || !currentStaff) {
    el.stationPanel.hidden = true;
    return;
  }
  el.stationPanel.hidden = false;
  if (!Object.hasOwn(STATIONS, selectedStationKey)) selectedStationKey = "line";
  el.stationRevision.textContent = `RUN REV ${String(run.revision).padStart(2, "0")}`;
  el.stationTabs.innerHTML = Object.entries(STATIONS).map(([key, station]) => `
    <button type="button" class="station-tab" role="tab" aria-selected="${key === selectedStationKey}"
      aria-controls="station-fields" data-station-key="${key}" data-testid="tab-station-${key}">${station.label}</button>
  `).join("");
  el.stationTabs.querySelectorAll("[data-station-key]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedStationKey = button.dataset.stationKey;
      stationConflictDraft = null;
      renderStationPanel(selectedRun());
    });
  });

  const station = STATIONS[selectedStationKey];
  const state = stationStateFor(run, selectedStationKey);
  const readOnly = !canWriteNow() || run.status === "completed";
  const draft = stationConflictDraft?.runId === run.id
    && stationConflictDraft.stationKey === selectedStationKey
    ? stationConflictDraft.changes
    : {};
  const inputs = { ...state.inputs, ...Object.fromEntries(Object.entries(draft).filter(([key]) => station.inputs.includes(key))) };
  const progress = { ...state.progress, ...Object.fromEntries(Object.entries(draft).filter(([key]) => station.progress.includes(key))) };
  el.stationLabel.textContent = station.label.toUpperCase();
  el.stationState.textContent = state.progress.timerStatus
    ? `Timer ${state.progress.timerStatus.replace("_", " ")}`
    : state.status.replace("_", " ");
  const metrics = calculateStationMetrics({ stationKey: selectedStationKey, run, state: { inputs, progress } });
  el.stationMetrics.innerHTML = Object.entries(metrics)
    .filter(([key, value]) => value !== null && value !== undefined && STATION_METRIC_LABELS[key])
    .map(([key, value]) => `<div class="station-metric"><span>${STATION_METRIC_LABELS[key]}</span><strong>${escapeHtml(formatMetric(value, key))}</strong></div>`)
    .join("");

  const makeFields = (title, group, fields) => `
    <div class="station-field-group">
      <h3>${title}</h3>
      ${fields.map((field) => {
        const [label, unit] = STATION_FIELD_META[field] || [field, ""];
        const raw = group[field];
        const fallback = station.progress.includes(field) ? 0 : (field === "autoTrackRatePerMinute" ? 0 : "");
        const value = raw === undefined || raw === null ? fallback : raw;
        const step = field === "casesPerBatch"
          ? "0.0001"
          : ["stockOnLineLbs", "stockConsumedLbs", "stockBarrels", "autoTrackRatePerMinute", "ozPerPizza", "batchLbs", "barrelLbs"].includes(field)
            ? "0.001"
            : "1";
        return `<label class="field station-field" for="station-${field}">
          <span>${label}${unit ? ` · ${unit}` : ""}</span>
          <input id="station-${field}" name="${field}" type="number" inputmode="decimal" min="0" max="1000000"
            step="${step}" value="${escapeHtml(value)}" data-station-field="${field}" ${readOnly ? "disabled" : ""} />
        </label>`;
      }).join("")}
    </div>`;
  el.stationFields.innerHTML = `
    <div class="station-field-groups">
      ${makeFields("Station setup", inputs, station.inputs)}
      ${makeFields("Recorded progress", progress, station.progress)}
    </div>
    <div class="station-pending" id="station-pending" hidden></div>`;

  const pending = loadPendingStation(run.id, selectedStationKey);
  const pendingBox = document.querySelector("#station-pending");
  if (pending) {
    pendingBox.hidden = false;
    const mine = pending.actorId === currentStaff.userId;
    pendingBox.innerHTML = `<span>${mine ? "A station update needs confirmation. Retry uses the same request ID." : "A saved update belongs to another staff account."}</span>${mine ? '<button type="button" data-retry-station="true">Retry same update</button>' : ""}`;
    pendingBox.querySelector("[data-retry-station]")?.addEventListener("click", () => { void retryStationCommand(pending); });
  }

  const canMutate = canWriteNow() && run.status !== "completed" && !stationActionInFlight
    && !hasPendingStationCommand(run.id);
  el.stationSaveButton.disabled = !canMutate;
  el.stationSaveButton.textContent = stationConflictDraft?.runId === run.id
    && stationConflictDraft.stationKey === selectedStationKey
    ? "Review and save my values"
    : "Save station values";
  if (!canWriteNow()) {
    setStationSaveNote("Read-only until the server confirms this run again.", "warning");
  } else if (stationConflictDraft?.runId === run.id && stationConflictDraft.stationKey === selectedStationKey) {
    setStationSaveNote("Another device changed the run. Your entries remain here; review them and save again.", "warning");
  } else if (pending) {
    setStationSaveNote("Confirm the saved update before making another station edit.", "warning");
  } else {
    setStationSaveNote("", "");
  }

  renderStationTimerControls(run, state, canMutate);
  updateStationTimer();
}

function formatMetric(value, key) {
  if (key === "completionPercent") return `${Number(value).toFixed(1)}%`;
  if (["ingredientLbsNeeded", "totalIngredientLbs", "stockOnLineLbs", "stockConsumedLbs"].includes(key)) return `${Number(value).toFixed(2)} lb`;
  if (key === "barrelsNeeded" || key === "stockBarrels") return `${Number(value).toFixed(2)} barrels`;
  return Number.isInteger(value) ? value.toLocaleString() : Number(value).toFixed(2);
}

function renderStationTimerControls(run, state, canMutate) {
  const timerStatus = state.progress.timerStatus || "idle";
  const duration = Number(state.inputs.timerDurationSeconds) || 0;
  const actions = [];
  if (timerStatus === "idle") actions.push(["timer_start", "Start timer"]);
  if (timerStatus === "running") actions.push(["timer_pause", "Pause timer"]);
  if (timerStatus === "paused") actions.push(["timer_resume", "Resume timer"]);
  if (timerStatus !== "idle") actions.push(["timer_reset", "Reset"]);
  el.stationTimerControls.innerHTML = actions.map(([mode, label]) => `
    <button type="button" data-timer-mode="${mode}" ${!canMutate
      || ((mode === "timer_start" || mode === "timer_resume") && (duration <= 0 || run.status !== "running"))
      ? "disabled" : ""}>${label}</button>
  `).join("");
  el.stationTimerControls.querySelectorAll("[data-timer-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      void submitStationCommand({
        runId: run.id,
        stationKey: selectedStationKey,
        mode: button.dataset.timerMode,
        changes: {},
      });
    });
  });
}

function updateStationTimer() {
  const run = selectedRun();
  if (!run || !Object.hasOwn(STATIONS, selectedStationKey)) return;
  const state = stationStateFor(run, selectedStationKey);
  const progress = state.progress || {};
  const status = progress.timerStatus || "idle";
  if (status === "idle") {
    el.stationTimerValue.textContent = "Not started";
    return;
  }
  const elapsed = activeTimerElapsedMs(run, state);
  const duration = (Number(state.inputs?.timerDurationSeconds) || 0) * 1000;
  const remaining = Math.max(0, duration - elapsed);
  el.stationTimerValue.textContent = status === "running" && duration > 0 && remaining === 0
    ? `Done · ${formatTimer(elapsed)}`
    : `${formatTimer(remaining > 0 ? remaining : elapsed)}${status === "paused" ? " · paused" : ""}`;
}

async function submitStationForm(event) {
  event.preventDefault();
  const run = selectedRun();
  if (!run || !requireWritableState()) return;
  if (run.status === "completed") {
    setStationSaveNote("Completed runs are read-only.", "warning");
    return;
  }
  const changes = {};
  const station = STATIONS[selectedStationKey];
  const current = stationStateFor(run, selectedStationKey);
  const currentValues = { ...current.inputs, ...current.progress };
  for (const input of el.stationFields.querySelectorAll("[data-station-field]")) {
    if (input.value === "") continue;
    const value = Number(input.value);
    if (!Number.isFinite(value)) {
      input.focus();
      setStationSaveNote("Enter a valid number for each station value.", "error");
      return;
    }
    const field = input.dataset.stationField;
    const knownValue = currentValues[field]
      ?? (station.progress.includes(field) || field === "autoTrackRatePerMinute" ? 0 : null);
    if (knownValue === null || value !== Number(knownValue)) changes[field] = value;
  }
  if (Object.keys(changes).length === 0) {
    setStationSaveNote("Enter at least one station value before saving.", "warning");
    return;
  }
  await submitStationCommand({
    runId: run.id,
    stationKey: selectedStationKey,
    mode: "manual",
    changes,
  });
}

async function submitStationCommand({ runId, stationKey, mode, changes }) {
  if (!requireWritableState()) return;
  if (stationActionInFlight || hasPendingStationCommand(runId)) {
    setStationSaveNote("Confirm the earlier station update before sending another one.", "warning");
    return;
  }
  const run = runs.find((item) => item.id === runId);
  if (!run) {
    setStationSaveNote("This run is no longer in the current register. Refresh before editing.", "error");
    return;
  }
  const csrf = getCsrfHeaders();
  if (!csrf) {
    setStationSaveNote("Your secure session is unavailable. Sign in again before editing.", "error");
    return;
  }
  const pending = {
    runId,
    stationKey,
    actorId: currentStaff.userId,
    commandId: crypto.randomUUID(),
    expectedRevision: run.revision,
    mode,
    changes,
  };
  if (mode !== "auto_track" && !savePendingStation(pending)) return;
  await sendStationCommand(pending);
}

async function retryStationCommand(pending) {
  if (stationActionInFlight || !currentStaff || pending.actorId !== currentStaff.userId) return;
  if (!requireWritableState()) return;
  await sendStationCommand(pending);
}

async function sendStationCommand(pending) {
  if (!currentStaff || pending.actorId !== currentStaff.userId) {
    setStationSaveNote("Sign in as the staff member who created this update before retrying.", "error");
    return;
  }
  if (!requireWritableState()) return;
  const csrf = getCsrfHeaders();
  if (!csrf) {
    setStationSaveNote("Your secure session is unavailable. Sign in again, then retry the same update.", "error");
    return;
  }
  stationActionInFlight = true;
  renderStationPanel(selectedRun());
  try {
    const response = await fetch(`${API}/${encodeURIComponent(pending.runId)}/stations/${encodeURIComponent(pending.stationKey)}/commands`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...csrf },
      body: JSON.stringify({
        commandId: pending.commandId,
        expectedRevision: pending.expectedRevision,
        mode: pending.mode,
        changes: pending.changes,
      }),
    });
    const body = await readJson(response, { allowStationConflict: true });
    if (!["accepted", "conflict", "invalid_transition", "not_due", "not_enabled"].includes(body.outcome)) {
      throw new Error("The server returned an unknown station result. Retry the same update to confirm it.");
    }
    if (body.outcome === "accepted") {
      if (!body.run) throw new Error("The server accepted the station update but did not return canonical state. Retry the same update.");
      const canonical = validateRun(body.run);
      if (canonical.id !== pending.runId) throw new Error("The server returned a different run for this station action.");
      upsertRun(canonical);
      clearPendingStation(pending.runId, pending.stationKey);
      if (pending.mode === "manual" || pending.mode.startsWith("timer_")) stationConflictDraft = null;
      setConnection(true);
      setLastCheck();
      serverStateConfirmed = true;
      clearError();
      setStationSaveNote(
        pending.mode === "auto_track" ? "Automatic progress saved by the server." : "Saved to the shared run.",
        "success",
      );
      announce(`${STATIONS[pending.stationKey].label} update saved.`);
      saveOfflineCache();
    } else if (body.outcome === "conflict") {
      const canonical = validateRun(body.currentRun);
      upsertRun(canonical);
      clearPendingStation(pending.runId, pending.stationKey);
      stationConflictDraft = pending.mode === "manual"
        ? { runId: pending.runId, stationKey: pending.stationKey, changes: pending.changes }
        : null;
      serverStateConfirmed = true;
      setConnection(true);
      setLastCheck();
      setStationSaveNote(
        pending.mode === "manual"
          ? "Another device changed the run. Your entries are kept below; review and save them again."
          : "Another device advanced the run. The current server state is shown.",
        "warning",
      );
      saveOfflineCache();
    } else {
      const canonical = validateRun(body.currentRun || body.run);
      upsertRun(canonical);
      clearPendingStation(pending.runId, pending.stationKey);
      serverStateConfirmed = true;
      setConnection(true);
      if (body.outcome === "invalid_transition") {
        setStationSaveNote("This station action is not available in the current run state.", "warning");
      }
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      clearOfflineCache();
      showSignIn("Your sign-in has expired. The saved station update remains available to retry after signing in again.");
    } else if (error instanceof ApiError && [400, 403, 404, 413].includes(error.status)) {
      if (pending.mode !== "auto_track") clearPendingStation(pending.runId, pending.stationKey);
      setConnection(true);
      setStationSaveNote(error.message, "error");
      showError(error.message, "Station update not saved");
    } else {
      serverStateConfirmed = false;
      setConnection(false);
      setStationSaveNote(
        error instanceof Error
          ? (pending.mode === "auto_track"
            ? `${error.message} Automatic progress will retry after reconnecting.`
            : `${error.message} The same update is saved for retry.`)
          : (pending.mode === "auto_track" ? "Automatic progress will retry after reconnecting." : "The update is not confirmed. Retry the saved update."),
        "error",
      );
      showError(
        pending.mode === "auto_track"
          ? "Automatic progress is temporarily unavailable and will resume after reconnection."
          : "The station update is not confirmed. Reconnect and retry the same saved action.",
        pending.mode === "auto_track" ? "Automatic tracking paused" : "Station update needs confirmation",
      );
    }
  } finally {
    stationActionInFlight = false;
    render();
  }
}

async function advanceDueStations() {
  const run = selectedRun();
  if (!run || run.status !== "running" || !canWriteNow() || stationActionInFlight) return;
  const now = currentServerNowMs(run);
  for (const stationKey of Object.keys(STATIONS)) {
    const state = stationStateFor(selectedRun(), stationKey);
    const rate = Number(state.inputs?.autoTrackRatePerMinute) || 0;
    const current = Number(state.progress?.[STATIONS[stationKey].autoTrackField]) || 0;
    const due = Date.parse(state.nextDueAt || "");
    if (rate <= 0 || current >= run.setupSnapshot.targetCases || !Number.isFinite(due) || due > now) continue;
    await submitStationCommand({
      runId: run.id,
      stationKey,
      mode: "auto_track",
      changes: {},
    });
    if (!canWriteNow() || !currentStaff) return;
  }
}

async function fetchRuns({ quiet = false } = {}) {
  if (!currentStaff) return false;
  if (navigator.onLine === false) {
    enterOfflineMode();
    return false;
  }
  if (refreshInFlight) return false;
  serverStateConfirmed = false;
  updateInventoryContext(currentStaff, false);
  updateCreateFormForAuth();
  renderRun(selectedRun());
  refreshInFlight = true;
  const requestGeneration = authGeneration;
  if (!quiet) el.refresh.disabled = true;
  try {
    const response = await fetch(API, { method: "GET", credentials: "include", headers: { Accept: "application/json" } });
    const body = await readJson(response);
    if (requestGeneration !== authGeneration || !currentStaff) return;
    if (navigator.onLine === false) {
      enterOfflineMode();
      return false;
    }
    if (!Array.isArray(body.runs)) throw new Error("The server returned an unexpected run list. Refresh again to retry.");
    const nextRuns = body.runs.map(validateRun);
    runs = mergeServerRuns(nextRuns, runs);
    if (!runs.some((run) => run.id === selectedRunId)) {
      const activeRun = runs.find((run) => run.status === "running" || run.status === "paused");
      selectedRunId = activeRun?.id || [...runs].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]?.id || null;
    }
    lastKnownRun = selectedRun();
    clearError();
    setConnection(true);
    setLastCheck();
    serverStateConfirmed = true;
    updateInventoryContext(currentStaff, canWriteNow());
    updateCreateFormForAuth();
    render();
    saveOfflineCache();
    return true;
  } catch (error) {
    if (requestGeneration !== authGeneration || !currentStaff) return false;
    if (error instanceof ApiError && error.status === 401) {
      setConnection(true);
      clearOfflineCache();
      showSignIn("Your sign-in has expired. Sign in again to reload the current server state.");
      return false;
    }
    serverStateConfirmed = false;
    updateInventoryContext(currentStaff, false);
    setConnection(false);
    saveOfflineCache();
    showError(error instanceof Error ? error.message : "Check the connection and refresh state.", "Could not load current state");
    updateCreateFormForAuth();
    if (runs.length === 0) {
      el.runContent.innerHTML = `<div class="status-row"><span class="status-pill planned">State unavailable</span></div><h2 class="run-label" id="run-label">Waiting for server state</h2><p class="control-note">Run controls stay unavailable until the canonical state loads. Check the connection, then refresh.</p>`;
      el.runsList.innerHTML = `<div class="empty-runs">Run register is unavailable. Refresh to try again.</div>`;
    } else render();
    return false;
  } finally {
    refreshInFlight = false;
    el.refresh.disabled = false;
    if (requestGeneration !== authGeneration && currentStaff) {
      queueMicrotask(() => { void fetchRuns({ quiet: true }); });
    }
  }
}

async function fetchOneRun(runId) {
  const response = await fetch(`${API}/${encodeURIComponent(runId)}`, {
    method: "GET", credentials: "include", headers: { Accept: "application/json" },
  });
  const body = await readJson(response);
  const run = validateRun(body.run);
  if (run.id !== runId) throw new Error("The server returned a different run than requested. Refresh the register.");
  const index = runs.findIndex((item) => item.id === runId);
  if (index === -1) runs.push(run);
  else runs[index] = run;
  return run;
}

async function beginCommand(run, commandType) {
  if (!currentStaff) {
    showSignIn("Sign in to load the current server state before changing a run.");
    return;
  }
  if (!requireWritableState()) return;
  if (commandInFlight || getPending(run.id)) return;
  if (!getCsrfHeaders()) {
    showError("Your secure session is unavailable. Sign in again before changing run state.", "Sign-in required");
    return;
  }
  const payload = {
    commandId: crypto.randomUUID(),
    commandType,
    expectedRevision: run.revision,
  };
  const pending = { ...payload, runId: run.id, actorId: currentStaff.userId };
  await sendCommand(pending);
}

async function retryCommand(runId) {
  if (commandInFlight) return;
  const pending = getPending(runId);
  if (!pending) {
    showError("No saved command is available to retry. Refresh the run state before acting.", "Retry unavailable");
    return;
  }
  if (pending.actorId !== currentStaff?.userId) {
    showError("This saved action belongs to a different staff account. Sign in as its original operator to retry it.", "Action belongs to another account");
    return;
  }
  if (!requireWritableState()) return;
  await sendCommand(pending);
}

async function sendCommand(pending) {
  if (!currentStaff || pending.actorId !== currentStaff.userId) {
    showError("Sign in as the staff member who created this action before retrying it.", "Action belongs to another account");
    return;
  }
  if (!requireWritableState()) return;
  const csrf = getCsrfHeaders();
  if (!csrf) {
    showError("Your secure session is unavailable. Sign in again, then retry the same saved action.", "Sign-in required");
    return;
  }
  if (!getPending(pending.runId) && !storePending(pending)) return;
  commandInFlight = true;
  render();
    let definitive = false;
    let conflictNotice = null;
  try {
    const response = await fetch(`${API}/${encodeURIComponent(pending.runId)}/commands`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...csrf },
      body: JSON.stringify({
        commandId: pending.commandId,
        commandType: pending.commandType,
        expectedRevision: pending.expectedRevision,
      }),
    });
    const body = await readJson(response, { allowCommandConflict: true });
    if (!["accepted", "conflict", "invalid_transition"].includes(body.outcome)) {
      throw new Error("The server returned an unknown command result. The same command can be retried safely.");
    }
    if (body.outcome === "accepted") {
      if (!body.run) throw new Error("The server accepted the action but did not return canonical state. Retry the same action to confirm it.");
      const run = validateRun(body.run);
      if (run.id !== pending.runId) throw new Error("The server returned a different run. Retry the same action to confirm the result.");
      upsertRun(run);
      definitive = true;
      clearPending(pending.runId);
      announce(`${commandTitle(pending.commandType)} accepted. Current state is ${run.status}.`);
    } else {
      const canonical = body.currentRun ? validateRun(body.currentRun) : await fetchOneRun(pending.runId);
      if (canonical.id !== pending.runId) throw new Error("The server returned a different run. Refresh to load the current state.");
      upsertRun(canonical);
      definitive = true;
      clearPending(pending.runId);
      conflictNotice = body.outcome === "conflict"
        ? "The run changed on another device. The latest server state is shown; review it before choosing an action."
        : `That action is not valid while the run is ${canonical.status}. The latest server state is shown.`;
    }
    selectedRunId = pending.runId;
    lastKnownRun = selectedRun();
    const refreshed = await fetchRuns({ quiet: true });
    if (refreshed && conflictNotice) {
      showError(conflictNotice, body.outcome === "conflict" ? "Run changed elsewhere" : "Action not available");
      announce(conflictNotice);
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      showSignIn("Your sign-in has expired. The saved action is retained; sign in as the same operator to confirm it.");
      return;
    }
    serverStateConfirmed = false;
    updateInventoryContext(currentStaff, false);
    setConnection(false);
    updateCreateFormForAuth();
    showError(error instanceof Error ? error.message : "The result is uncertain. Retry the same action; its command identity will be preserved.", "Action needs confirmation");
  } finally {
    if (definitive) clearPending(pending.runId);
    commandInFlight = false;
    render();
  }
}

function upsertRun(run) {
  const index = runs.findIndex((item) => item.id === run.id);
  if (index < 0) runs.push(run);
  else if (runs[index].revision <= run.revision) runs[index] = run;
}

async function createRun(event) {
  event.preventDefault();
  if (createInFlight) return;
  if (!currentStaff) {
    showSignIn("Sign in to load the current server state before preparing a run.");
    return;
  }
  if (pendingCreate && pendingCreate.actorId !== currentStaff.userId) {
    showError("This unconfirmed run request belongs to another staff account. Sign in as that person to confirm it.", "Request belongs to another account");
    return;
  }
  if (!requireWritableState()) return;
  const csrf = getCsrfHeaders();
  if (!csrf) {
    showError("Your secure session is unavailable. Sign in again before creating a run.", "Sign-in required");
    return;
  }
  const label = pendingCreate?.setupSnapshot.label ?? el.label.value.trim();
  const targetCases = pendingCreate?.setupSnapshot.targetCases ?? Number(el.target.value);
  if (!label || !Number.isSafeInteger(targetCases) || targetCases < 1) {
    showError("Enter a run label and a whole-number target greater than zero.", "Check run details");
    return;
  }
  const request = pendingCreate || {
    requestId: crypto.randomUUID(),
    actorId: currentStaff.userId,
    setupSnapshot: { label, targetCases },
  };
  if (!pendingCreate) {
    savePendingCreate(request);
    if (!pendingCreate) return;
  }
  createInFlight = true;
  el.createButton.disabled = true;
  el.createNote.textContent = pendingCreate ? "Retrying the same request with its saved identity…" : "Sending to the server…";
  try {
    const response = await fetch(API, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...csrf },
      body: JSON.stringify({ requestId: request.requestId, setupSnapshot: request.setupSnapshot }),
    });
    const body = await readJson(response);
    if (body.outcome !== "created" || typeof body.replayed !== "boolean") {
      throw new Error("The server returned an unexpected creation result. Retry the same request to confirm it.");
    }
    const run = validateRun(body.run);
    if (run.status !== "planned" || run.setupSnapshot.label !== request.setupSnapshot.label || run.setupSnapshot.targetCases !== request.setupSnapshot.targetCases) {
      throw new Error("The server returned a run that does not match this request. Retry the same request to confirm it.");
    }
    upsertRun(run);
    selectedRunId = run.id;
    lastKnownRun = run;
    clearPendingCreate();
    clearError();
    el.createForm.reset();
    el.createNote.textContent = body.replayed
      ? "Existing server-created run confirmed. Start it when production is ready."
      : "Prepared by the server. Start the run when production is ready.";
    setConnection(true);
    setLastCheck();
    announce(body.replayed ? "Previously prepared run confirmed on the server." : "Run prepared on the server.");
    await fetchRuns({ quiet: true });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      showSignIn("Your sign-in has expired. The saved run request is retained; sign in as the same operator to confirm it.");
      return;
    }
    serverStateConfirmed = false;
    updateInventoryContext(currentStaff, false);
    showError(error instanceof Error ? error.message : "Run creation could not be confirmed. Retry the same request; its identity and details are preserved.", "Run not confirmed");
    el.createNote.textContent = "Not confirmed. Retry uses the same request ID and details; do not start a different creation request.";
    setConnection(false);
  } finally {
    createInFlight = false;
    updateCreateFormForAuth();
    render();
  }
}

if (pendingCreate) {
  el.label.value = pendingCreate.setupSnapshot.label;
  el.target.value = String(pendingCreate.setupSnapshot.targetCases);
  el.label.disabled = true;
  el.target.disabled = true;
  el.createButton.textContent = "Retry same request";
  el.createNote.textContent = "A previous request needs confirmation. Retry sends the same request ID and run details; it will not retry automatically.";
}

initializeInventory();
el.refresh.addEventListener("click", () => fetchRuns());
el.createForm.addEventListener("submit", createRun);
el.stationForm.addEventListener("submit", submitStationForm);
el.authForm.addEventListener("submit", submitSignIn);
el.bootstrapForm.addEventListener("submit", submitBootstrap);
el.setupToggle.addEventListener("click", () => toggleBootstrapForm(true));
el.setupCancel.addEventListener("click", () => toggleBootstrapForm(false));
el.staffCreateForm.addEventListener("submit", submitStaffCreate);
el.staffList.addEventListener("click", handleStaffAction);
el.authRetry.addEventListener("click", checkSession);
el.signOut.addEventListener("click", signOut);
window.addEventListener("offline", enterOfflineMode);
window.addEventListener("online", () => {
  if (currentStaff) void fetchRuns({ quiet: true });
  else void checkSession();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  if (currentStaff) fetchRuns({ quiet: true });
  else checkSession();
});
window.addEventListener("focus", () => {
  if (currentStaff) fetchRuns({ quiet: true });
  else checkSession();
});
window.setInterval(() => {
  if (!document.hidden && currentStaff && navigator.onLine !== false) fetchRuns({ quiet: true });
}, POLL_INTERVAL_MS);
window.setInterval(() => {
  if (!document.hidden && currentStaff && navigator.onLine !== false) void advanceDueStations();
}, AUTO_TRACK_INTERVAL_MS);
window.setInterval(updateStationTimer, 500);
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/service-worker.js", { scope: "/" }).catch(() => {
    // The live app still works when a browser or host disables service workers.
  });
}

void checkSession();
