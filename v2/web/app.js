import { canWriteRunState } from "./write-gate.mjs";

const API = "/api/v2/runs";
const AUTH_API = "/api/v2/auth";
const POLL_INTERVAL_MS = 15000;
const PENDING_PREFIX = "fieldline:v2:pending-command:";
const PENDING_CREATE_KEY = "fieldline:v2:pending-create";
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

async function readJson(response, { allowCommandConflict = false } = {}) {
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("The server response could not be read. Refresh and try again.");
  }
  const knownCommandConflict = allowCommandConflict && response.status === 409
    && ["conflict", "invalid_transition"].includes(body?.outcome);
  if (!response.ok && !knownCommandConflict) {
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
  setConnection(false);
  updateCreateFormForAuth();
  renderRun(selectedRun());
  if (currentStaff) {
    showError("This device is offline. V2 is read-only until a fresh server check succeeds.", "Offline — read-only");
  }
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
  if (currentStaff) clearUserScopedState();
  currentStaff = null;
  staffGeneration += 1;
  staffDirectory = null;
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
      showSignIn();
      return;
    }
    const body = await readJson(response);
    showAuthenticated(body.staff);
  } catch (error) {
    setConnection(false);
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
  if (!currentStaff || authInFlight || signOutInFlight || createInFlight || commandInFlight) return;
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
    showSignIn("You are signed out. Sign in again to load current server state.");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
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
}

async function fetchRuns({ quiet = false } = {}) {
  if (!currentStaff) return false;
  if (navigator.onLine === false) {
    enterOfflineMode();
    return false;
  }
  if (refreshInFlight) return false;
  serverStateConfirmed = false;
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
    updateCreateFormForAuth();
    render();
    return true;
  } catch (error) {
    if (requestGeneration !== authGeneration || !currentStaff) return false;
    if (error instanceof ApiError && error.status === 401) {
      setConnection(true);
      showSignIn("Your sign-in has expired. Sign in again to reload the current server state.");
      return false;
    }
    serverStateConfirmed = false;
    setConnection(false);
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
  else runs[index] = run;
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

el.refresh.addEventListener("click", () => fetchRuns());
el.createForm.addEventListener("submit", createRun);
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

void checkSession();
