import { Client } from "pg";
import type {
  APIRequestContext,
  APIResponse,
} from "@playwright/test";
import { requireLocalFixtureApiOrigin } from "./isolatedApiOrigin";

/** Fresh test-owned seeds only; never use this to replay a rejected edit. */
export async function freshMasterDataSeedHeaders(
  request: APIRequestContext,
  collectionUrl: string,
  headers: Record<string, string> = {},
): Promise<Record<string, string>> {
  requireIsolatedTestDatabase("Fresh master-data seed");
  const target = new URL(
    collectionUrl,
    collectionUrl.startsWith("/") ? requireLocalFixtureApiOrigin("Fresh master-data seed") : undefined,
  );
  requireLocalFixtureApiOrigin("Fresh master-data seed", target.origin);
  if (target.username || target.password || target.hash || !target.pathname.startsWith("/api/")) {
    throw new Error("Fresh master-data seeds require a credential-free local API collection URL.");
  }
  const response = await request.get(target.href, { headers });
  if (!response.ok()) {
    throw new Error(`Fixture canonical master-data read failed: ${await responseFailure(response)}`);
  }
  const epoch = response.headers()["x-master-data-epoch"];
  if (epoch === undefined || !/^\d+$/.test(epoch)) {
    throw new Error("Fixture canonical master-data read did not return a valid epoch; seed was not submitted.");
  }
  return { ...headers, "X-Master-Data-Epoch": epoch };
}

export const DEFAULT_MANAGER_CAPABILITIES = [
  "manage-staff",
  "manage-inventory",
  "edit-production-rules",
  "approve-password-resets",
  "review-incidents",
  "use-ai-tools",
  "manage-factory-settings",
  "manage-profiles",
] as const;
export type E2ECapability =
  | (typeof DEFAULT_MANAGER_CAPABILITIES)[number]
  | "record-qc"
  | "manage-qc";

type JsonRecord = Record<string, unknown>;
type PlaywrightRequestFactory = {
  request: {
    newContext(): Promise<APIRequestContext>;
  };
};

export interface AuthorizedTestAccount {
  token: string;
  userId: string;
  username: string;
  cookieHeader: { Cookie: string };
}

export interface BrandProfileFixture {
  key?: string;
  brand: string;
  flavor: string;
  values: JsonRecord;
  crustValues?: JsonRecord;
  updatedAt?: number;
}

export interface TodaySyncFixture {
  token: string;
  senderId: string;
  payload: JsonRecord;
  date?: string;
}

export interface ScheduledSyncFixture {
  token: string;
  date: string;
  today: string;
  payload: JsonRecord;
}

export interface AuthorizedFixtureCleanupOptions {
  profileKeys?: Iterable<string>;
  syncDates?: Iterable<string>;
  cheeseRecipeIds?: Iterable<string>;
  doughRecipeIds?: Iterable<string>;
  sauceRecipeIds?: Iterable<string>;
  mixIds?: Iterable<string>;
}

export interface CheeseRecipeFixture {
  id: string;
  name: string;
  brand?: string;
  flavors?: string[];
  shredderSetting?: string;
  cellulose?: string;
  notes?: string;
  components?: Array<{
    ingredient: string;
    lbs: number;
    ozPerPizza?: number;
    sharePct?: number;
  }>;
  enabled?: boolean;
}

export interface NamedRecipeFixture {
  id: string;
  name: string;
  notes?: string;
  components?: Array<{
    ingredient: string;
    lbs: number;
  }>;
  enabled?: boolean;
  brand?: string;
  flavors?: string[];
  doughballWeightOz?: number;
  doughballsPerTray?: number;
}

export interface MixFixture {
  id: string;
  name: string;
  brand?: string;
  flavor?: string;
  batchSize?: number;
  daysEarly?: number;
  notes?: string;
  amountAlreadyMade?: number;
  components?: Array<{
    ingredient: string;
    perPizza: number;
    perBatchLbs?: number;
  }>;
  enabled?: boolean;
  isPrep?: boolean;
}

/**
 * Destructive browser fixtures are only safe against a local database, a
 * database whose name explicitly identifies it as disposable, or an
 * explicitly approved CI/test mode. Production markers always win, even when
 * the URL otherwise looks disposable. REPLIT_DEV_DOMAIN alone is not a safety
 * signal: a development browser can still be pointed at a shared database.
 */
export function requireIsolatedTestDatabase(operation: string): string {
  const url = process.env.DATABASE_URL ?? "";
  const productionEnvironment =
    process.env.REPLIT_DEPLOYMENT === "1"
    || [process.env.NODE_ENV, process.env.APP_ENV]
      .some((value) => /^(production|prod)$/i.test(value ?? ""));
  if (productionEnvironment) {
    throw new Error(
      `${operation} refused to run destructive database setup in production.`,
    );
  }
  let host = "";
  let database = "";
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    // The diagnostic below includes the required remediation.
  }

  const localHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const disposableName = /(?:^|[-_])(e2e|test|tests|tmp|temporary)(?:[-_]|$)/i.test(
    database,
  );
  const approvedMode =
    process.env.E2E_TEST_DB === "1" &&
    process.env.E2E_APPROVED_DESTRUCTIVE_MODE === "1";

  if (!url || !(localHost || disposableName || approvedMode)) {
    throw new Error(
      `${operation} refused to run destructive database setup. ` +
        "Use a local database, a database name containing an explicit " +
        "e2e/test/tmp marker, or set E2E_TEST_DB=1 and " +
        "E2E_APPROVED_DESTRUCTIVE_MODE=1 in an approved test environment. " +
        "REPLIT_DEV_DOMAIN alone is not sufficient; this protects shared and " +
        "production databases from live-day deletion.",
    );
  }
  return url;
}

/**
 * The recipe-refresh suite changes shared recipe master data in addition to
 * clearing disposable live-day rows. Require the connection itself to name a
 * disposable database; approved-mode flags alone are intentionally not enough.
 */
export function requireDedicatedTestDatabase(operation: string): string {
  const url = requireIsolatedTestDatabase(operation);
  let database = "";
  try {
    const parsed = new URL(url);
    database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    // requireIsolatedTestDatabase already emitted the actionable URL error.
  }

  if (!/(?:^|[-_])(e2e|test|tests|tmp|temporary)(?:[-_]|$)/i.test(database)) {
    throw new Error(
      `${operation} requires a dedicated disposable database. ` +
        "Use a database name containing an explicit e2e, test, tmp, or " +
        "temporary marker; approved test-mode flags alone are not sufficient.",
    );
  }
  return url;
}

export function uniqueTestId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export async function cleanupTestUsers(
  db: Client,
  usernames: Iterable<string>,
): Promise<void> {
  for (const username of usernames) {
    // The SQL text is constant and pg sends username separately as bind $1.
    // nosemgrep: javascript.express.db.pg-express.pg-express
    await db.query("DELETE FROM users WHERE username = $1", [username]);
  }
}

export async function cleanupBrandProfiles(
  db: Client,
  keys: readonly string[],
  scope: string,
): Promise<void> {
  await db.query(
    "DELETE FROM brand_profiles WHERE key = ANY($1::text[]) AND scope = $2",
    [keys, scope],
  );
}

export async function cleanupDailySync(
  db: Client,
  dates: readonly string[],
  scope: string,
): Promise<void> {
  await db.query(
    "DELETE FROM daily_sync WHERE date = ANY($1::text[]) AND scope = $2",
    [dates, scope],
  );
}

export async function cleanupCheeseRecipes(
  db: Client,
  ids: readonly string[],
): Promise<void> {
  await db.query(
    "DELETE FROM cheese_recipes WHERE id = ANY($1::text[])",
    [ids],
  );
}

export async function cleanupNamedRecipes(
  db: Client,
  kind: "dough" | "sauce",
  ids: readonly string[],
): Promise<void> {
  const NAMED_RECIPE_SQL_IDENTIFIER_ALLOWLIST = {
    dough: "dough_recipes",
    sauce: "sauce_recipes",
  } as const;
  const table = NAMED_RECIPE_SQL_IDENTIFIER_ALLOWLIST[kind];
  if (!table) {
    throw new Error(`Unsupported named recipe fixture kind: ${String(kind)}`);
  }
  await db.query(
    `DELETE FROM ${table} WHERE id = ANY($1::text[]) AND scope = $2`,
    [ids, "live"],
  );
}

export async function cleanupMixes(
  db: Client,
  ids: readonly string[],
): Promise<void> {
  await db.query(
    "DELETE FROM mixes WHERE id = ANY($1::text[]) AND scope = $2",
    [ids, "live"],
  );
}

export async function cleanupFixtureRoles(
  db: Client,
  roleNames: readonly string[],
): Promise<void> {
  await db.query("DELETE FROM roles WHERE name = ANY($1::text[])", [roleNames]);
}

export async function authorizeFixtureAccount(
  db: Client,
  roleName: string,
  userId: string,
  capabilities: readonly E2ECapability[],
  onboardingSeen: boolean,
): Promise<void> {
  await db.query(
    `INSERT INTO roles (name, capabilities, builtin)
     VALUES ($1, $2::jsonb, false)`,
    [roleName, JSON.stringify([...capabilities])],
  );
  await db.query(
    `INSERT INTO user_roles (user_id, role)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET role = $2, updated_at = NOW()`,
    [userId, roleName],
  );
  await db.query("UPDATE users SET onboarding_seen = $2 WHERE id = $1", [
    userId,
    onboardingSeen,
  ]);
}

async function responseFailure(response: APIResponse): Promise<string> {
  return `${response.status()} ${await response.text().catch(() => "")}`.trim();
}

/**
 * API-first browser fixture lifecycle for isolated operational checks.
 *
 * Each account receives its own temporary role so explicit test capabilities
 * never mutate the factory-wide manager definition. Every destructive DB
 * operation is guarded independently rather than trusting the constructor.
 */
export class AuthorizedBrowserFixtures {
  private static readonly LIVE_FIXTURE_LOCK = [0x4532_4546, 0x4c49_5645] as const;

  private readonly usernames = new Set<string>();
  private readonly roleNames = new Set<string>();
  private readonly profileKeys = new Set<string>();
  private readonly syncDates = new Set<string>();
  private readonly cheeseRecipeIds = new Set<string>();
  private readonly doughRecipeIds = new Set<string>();
  private readonly sauceRecipeIds = new Set<string>();
  private readonly mixIds = new Set<string>();
  private lockClient: Client | undefined;
  private startPromise: Promise<void> | undefined;

  private constructor(
    private readonly request: APIRequestContext,
    private readonly apiBase: string,
    private readonly signupCode: string,
  ) {}

  static async create(
    playwright: PlaywrightRequestFactory,
    apiBase: string,
    signupCode: string,
  ): Promise<AuthorizedBrowserFixtures> {
    const request = await playwright.request.newContext();
    const fixtures = new AuthorizedBrowserFixtures(request, apiBase, signupCode);
    try {
      await fixtures.start();
      return fixtures;
    } catch (error) {
      await request.dispose().catch(() => {});
      throw error;
    }
  }

  /**
   * Serialize fixture lifecycles that share the single live daily-sync row.
   * PostgreSQL releases this session lock automatically if a test process dies.
   */
  start(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = this.acquireLiveFixtureLock();
    }
    return this.startPromise;
  }

  private async acquireLiveFixtureLock(): Promise<void> {
    const url = requireIsolatedTestDatabase("start authorized browser fixtures");
    const db = new Client({ connectionString: url });
    try {
      await db.connect();
      await db.query("SELECT pg_advisory_lock($1, $2)", [
        AuthorizedBrowserFixtures.LIVE_FIXTURE_LOCK[0],
        AuthorizedBrowserFixtures.LIVE_FIXTURE_LOCK[1],
      ]);
      this.lockClient = db;
    } catch (error) {
      await db.end().catch(() => {});
      throw error;
    }
  }

  private async releaseLiveFixtureLock(): Promise<void> {
    const db = this.lockClient;
    this.lockClient = undefined;
    if (!db) return;
    try {
      await db.query("SELECT pg_advisory_unlock($1, $2)", [
        AuthorizedBrowserFixtures.LIVE_FIXTURE_LOCK[0],
        AuthorizedBrowserFixtures.LIVE_FIXTURE_LOCK[1],
      ]);
    } finally {
      await db.end().catch(() => {});
    }
  }

  private async withDatabase<T>(
    operation: string,
    callback: (db: Client) => Promise<T>,
  ): Promise<T> {
    await this.start();
    const url = requireIsolatedTestDatabase(operation);
    const db = new Client({ connectionString: url });
    try {
      await db.connect();
      return await callback(db);
    } finally {
      await db.end().catch(() => {});
    }
  }

  async createAccount(options: {
    username?: string;
    password: string;
    capabilities: readonly E2ECapability[];
    onboardingSeen?: boolean;
  }): Promise<AuthorizedTestAccount> {
    requireIsolatedTestDatabase("create authorized browser fixture account");
    await this.start();
    const username = options.username ?? uniqueTestId("e2e_user");
    const signUp = await this.request.post(`${this.apiBase}/api/auth/sign-up`, {
      data: {
        username,
        password: options.password,
        accessCode: this.signupCode,
      },
    });
    if (!signUp.ok()) {
      throw new Error(`Fixture sign-up failed: ${await responseFailure(signUp)}`);
    }
    const auth = await signUp.json() as {
      token: string;
      user: { userId: string };
    };
    this.usernames.add(username);
    const roleName = uniqueTestId("e2e-role");
    this.roleNames.add(roleName);

    await this.withDatabase("authorize browser fixture account", async (db) => {
      await authorizeFixtureAccount(
        db,
        roleName,
        auth.user.userId,
        options.capabilities,
        options.onboardingSeen ?? true,
      );
    });

    return {
      token: auth.token,
      userId: auth.user.userId,
      username,
      cookieHeader: { Cookie: `rc_auth=${auth.token}` },
    };
  }

  async assignManagerRole(
    account: Pick<AuthorizedTestAccount, "userId" | "token">,
  ): Promise<void> {
    requireIsolatedTestDatabase("assign manager role to browser fixture account");
    await this.withDatabase("assign manager role to browser fixture account", async (db) => {
      const managerRole = await db.query(
        "SELECT 1 FROM roles WHERE name = 'manager' LIMIT 1",
      );
      if (managerRole.rowCount !== 1) {
        throw new Error("The isolated database does not contain the built-in manager role.");
      }
      await db.query(
        "UPDATE roles SET capabilities = $1::jsonb, updated_at = NOW() WHERE name = 'manager'",
        [JSON.stringify(DEFAULT_MANAGER_CAPABILITIES)],
      );
      const updated = await db.query(
        "UPDATE user_roles SET role = 'manager', updated_at = NOW() WHERE user_id = $1 RETURNING user_id",
        [account.userId],
      );
      if (updated.rowCount !== 1) {
        throw new Error("The fixture account has no assigned role to promote.");
      }
      const persistedRole = await db.query<{ role: string }>(
        "SELECT role FROM user_roles WHERE user_id = $1",
        [account.userId],
      );
      if (persistedRole.rows[0]?.role !== "manager") {
        throw new Error("The isolated database did not retain the manager role assignment.");
      }
    });
    const identityResponse = await this.request.get(`${this.apiBase}/api/me`, {
      headers: { Cookie: `rc_auth=${account.token}` },
      failOnStatusCode: true,
    });
    const identity = await identityResponse.json() as {
      userId?: string;
      role?: string;
    };
    if (identity.userId !== account.userId || identity.role !== "manager") {
      throw new Error(
        "The API did not observe the fixture account's manager role after assignment.",
      );
    }
  }

  /**
   * Fresh, test-owned seeds read the canonical collection first. If the server
   * rejects this unique seed only because the shared epoch changed between the
   * read and write, refresh once and retry explicitly; other rejections fail.
   */
  private async masterDataSeedHeaders(
    token: string,
    collection: string,
  ): Promise<Record<string, string>> {
    return freshMasterDataSeedHeaders(this.request, `${this.apiBase}/api/${collection}`, {
      Cookie: `rc_auth=${token}`,
    });
  }

  async seedBrandProfile(
    account: Pick<AuthorizedTestAccount, "token">,
    profile: BrandProfileFixture,
  ): Promise<string> {
    await this.start();
    const key = profile.key
      ?? `${profile.brand.toLowerCase()}__${profile.flavor.toLowerCase()}`;
    const seedProfile = (headers: Record<string, string>) =>
      this.request.post(`${this.apiBase}/api/brand-profiles`, {
        headers,
        data: {
          items: [{
            ...profile,
            key,
            crustValues: profile.crustValues ?? {},
            updatedAt: profile.updatedAt ?? Date.now(),
          }],
        },
      });
    let response = await seedProfile(
      await this.masterDataSeedHeaders(account.token, "brand-profiles"),
    );
    if (response.status() === 409) {
      const responseBody = await response.text();
      let responseError: unknown;
      try {
        responseError = (JSON.parse(responseBody) as { error?: unknown }).error;
      } catch {
        responseError = undefined;
      }
      if (
        responseError
        === "Shared data changed after this edit was prepared. Refresh canonical records and review the pending edit before retrying; it has not been applied."
      ) {
        console.warn(
          "Fresh profile fixture seed conflicted on the shared-data epoch; refreshing and retrying once.",
        );
        response = await seedProfile(
          await this.masterDataSeedHeaders(account.token, "brand-profiles"),
        );
      } else {
        throw new Error(
          `Fixture profile seed failed: HTTP 409 ${responseBody.slice(0, 1_000)}`,
        );
      }
    }
    if (!response.ok()) {
      throw new Error(`Fixture profile seed failed: ${await responseFailure(response)}`);
    }
    this.profileKeys.add(key);
    return key;
  }

  async seedTodaySync(fixture: TodaySyncFixture): Promise<string> {
    await this.start();
    const date = fixture.date ?? new Date().toISOString().slice(0, 10);
    const headers = { Cookie: `rc_auth=${fixture.token}` };
    const epochResponse = await this.request.get(
      `${this.apiBase}/api/sync/reset-epoch`,
      { headers },
    );
    if (!epochResponse.ok()) {
      throw new Error(`Fixture reset epoch failed: ${await responseFailure(epochResponse)}`);
    }
    const { epoch = 0 } = await epochResponse.json() as { epoch?: number };
    const snapshotResponse = await this.request.get(
      `${this.apiBase}/api/sync/today?today=${date}`,
      { headers },
    );
    if (!snapshotResponse.ok()) {
      throw new Error(`Fixture base snapshot fetch failed: ${await responseFailure(snapshotResponse)}`);
    }
    const baseSnapshotId = snapshotResponse.headers()["x-sync-snapshot"];
    if (!baseSnapshotId && fixture.payload.completeness === "complete") {
      throw new Error("Fixture base snapshot fetch omitted X-Sync-Snapshot.");
    }
    const payload = fixture.payload.completeness === "complete"
      ? { ...fixture.payload, baseSnapshotId }
      : fixture.payload;
    const response = await this.request.put(
      `${this.apiBase}/api/sync/today?today=${date}&epoch=${epoch}`,
      {
        headers,
        data: { senderId: fixture.senderId, payload },
      },
    );
    if (!response.ok()) {
      throw new Error(`Fixture today sync seed failed: ${await responseFailure(response)}`);
    }
    const syncHeaders = response.headers();
    const convergence = syncHeaders["x-sync-convergence"];
    if (convergence !== "written") {
      throw new Error(
        "Fixture today sync seed was not persisted " +
        `(response=${syncHeaders["x-sync-response"] ?? "missing"}, convergence=${convergence ?? "missing"}).`,
      );
    }
    this.syncDates.add(date);
    return date;
  }

  /**
   * Initial canonical state for journeys that need an already-started run or
   * existing counters. Setup-only sync intentionally rejects these fields.
   * Call before mounting the calculator. This is not a command implementation
   * or a fallback after a rejected application write.
   */
  async seedCanonicalTodaySnapshot(fixture: TodaySyncFixture): Promise<string> {
    const connectionString = requireIsolatedTestDatabase("seed canonical browser snapshot");
    await this.start();
    const date = fixture.date ?? new Date().toISOString().slice(0, 10);
    const dayState = fixture.payload.dayState as JsonRecord | undefined;
    if (!dayState || !Array.isArray(dayState.runs) || "operationalProjection" in fixture.payload) {
      throw new Error("Canonical browser fixture requires a daily run snapshot, without a persisted projection.");
    }
    const response = await this.request.get(`${this.apiBase}/api/sync/today?today=${date}`, {
      headers: { Cookie: `rc_auth=${fixture.token}` },
    });
    if (!response.ok()) {
      throw new Error(`Canonical browser fixture authorization failed: ${await responseFailure(response)}`);
    }
    const db = new Client({ connectionString });
    try {
      await db.connect();
      await db.query(
        `INSERT INTO daily_sync (date, scope, data, canonical_revision, updated_at)
         VALUES ($1, 'live', $2::jsonb, 1, NOW())
         ON CONFLICT (date, scope) DO UPDATE
           SET data = $2::jsonb,
               canonical_revision = daily_sync.canonical_revision + 1,
               updated_at = NOW()`,
        [date, JSON.stringify({
          ...fixture.payload,
          syncVersion: 1,
          completeness: "complete",
          dayState: { ...dayState, date },
        })],
      );
    } finally {
      await db.end().catch(() => {});
    }
    this.syncDates.add(date);
    return date;
  }

  async seedScheduledSync(fixture: ScheduledSyncFixture): Promise<string> {
    await this.start();
    const headers = { Cookie: `rc_auth=${fixture.token}` };
    const epochResponse = await this.request.get(
      `${this.apiBase}/api/sync/reset-epoch`,
      { headers },
    );
    if (!epochResponse.ok()) {
      throw new Error(`Fixture reset epoch failed: ${await responseFailure(epochResponse)}`);
    }
    const { epoch = 0 } = await epochResponse.json() as { epoch?: number };
    const response = await this.request.put(
      `${this.apiBase}/api/sync/${fixture.date}?today=${fixture.today}&epoch=${epoch}`,
      {
        headers,
        data: { payload: fixture.payload },
      },
    );
    if (!response.ok()) {
      throw new Error(
        `Fixture scheduled sync seed failed: ${await responseFailure(response)}`,
      );
    }
    this.syncDates.add(fixture.date);
    return fixture.date;
  }

  async seedCheeseRecipe(
    account: Pick<AuthorizedTestAccount, "token">,
    recipe: CheeseRecipeFixture,
  ): Promise<string> {
    await this.start();
    const response = await this.request.post(`${this.apiBase}/api/cheese-recipes`, {
      headers: await this.masterDataSeedHeaders(account.token, "cheese-recipes"),
      data: {
        items: [{
          brand: "",
          flavors: [],
          shredderSetting: "",
          cellulose: "",
          notes: "",
          components: [],
          enabled: true,
          ...recipe,
        }],
      },
    });
    if (!response.ok()) {
      throw new Error(`Fixture cheese recipe seed failed: ${await responseFailure(response)}`);
    }
    this.cheeseRecipeIds.add(recipe.id);
    return recipe.id;
  }

  async seedNamedRecipe(
    kind: "dough" | "sauce",
    account: Pick<AuthorizedTestAccount, "token">,
    recipe: NamedRecipeFixture,
  ): Promise<string> {
    await this.start();
    const response = await this.request.post(
      `${this.apiBase}/api/${kind}-recipes`,
      {
        headers: await this.masterDataSeedHeaders(account.token, `${kind}-recipes`),
        data: {
          items: [{
            notes: "",
            components: [],
            enabled: true,
            brand: "",
            flavors: [],
            ...recipe,
          }],
        },
      },
    );
    if (!response.ok()) {
      throw new Error(
        `Fixture ${kind} recipe seed failed: ${await responseFailure(response)}`,
      );
    }
    (kind === "dough" ? this.doughRecipeIds : this.sauceRecipeIds).add(recipe.id);
    return recipe.id;
  }

  async seedMix(
    account: Pick<AuthorizedTestAccount, "token">,
    mix: MixFixture,
  ): Promise<string> {
    await this.start();
    const response = await this.request.post(`${this.apiBase}/api/mixes`, {
      headers: await this.masterDataSeedHeaders(account.token, "mixes"),
      data: {
        items: [{
          brand: "",
          flavor: "",
          batchSize: 0,
          daysEarly: 0,
          notes: "",
          amountAlreadyMade: 0,
          components: [],
          enabled: true,
          isPrep: false,
          ...mix,
        }],
      },
    });
    if (!response.ok()) {
      throw new Error(`Fixture mix seed failed: ${await responseFailure(response)}`);
    }
    this.mixIds.add(mix.id);
    return mix.id;
  }

  async removeBrandProfiles(
    keys: Iterable<string> = this.profileKeys,
    scope = "live",
  ): Promise<void> {
    const selected = [...keys];
    if (selected.length === 0) return;
    await this.withDatabase("remove browser fixture profiles", async (db) => {
      await cleanupBrandProfiles(db, selected, scope);
    });
    selected.forEach((key) => this.profileKeys.delete(key));
  }

  async removeTodaySync(
    dates: Iterable<string> = this.syncDates,
    scope = "live",
  ): Promise<void> {
    const selected = [...dates];
    if (selected.length === 0) return;
    await this.withDatabase("remove browser fixture sync snapshots", async (db) => {
      await cleanupDailySync(db, selected, scope);
    });
    selected.forEach((date) => this.syncDates.delete(date));
  }

  async removeCheeseRecipes(ids: Iterable<string> = this.cheeseRecipeIds): Promise<void> {
    const selected = [...ids];
    if (selected.length === 0) return;
    await this.withDatabase("remove browser fixture cheese recipes", async (db) => {
      await cleanupCheeseRecipes(db, selected);
    });
    selected.forEach((id) => this.cheeseRecipeIds.delete(id));
  }

  async removeNamedRecipes(
    kind: "dough" | "sauce",
    ids: Iterable<string>,
  ): Promise<void> {
    const selected = [...ids];
    if (selected.length === 0) return;
    await this.withDatabase(`remove browser fixture ${kind} recipes`, async (db) => {
      await cleanupNamedRecipes(db, kind, selected);
    });
    (kind === "dough" ? this.doughRecipeIds : this.sauceRecipeIds).forEach((id) => {
      if (selected.includes(id)) {
        (kind === "dough" ? this.doughRecipeIds : this.sauceRecipeIds).delete(id);
      }
    });
  }

  async removeDoughRecipes(
    ids: Iterable<string> = this.doughRecipeIds,
  ): Promise<void> {
    await this.removeNamedRecipes("dough", ids);
  }

  async removeSauceRecipes(
    ids: Iterable<string> = this.sauceRecipeIds,
  ): Promise<void> {
    await this.removeNamedRecipes("sauce", ids);
  }

  async removeMixes(ids: Iterable<string> = this.mixIds): Promise<void> {
    const selected = [...ids];
    if (selected.length === 0) return;
    await this.withDatabase("remove browser fixture mixes", async (db) => {
      await cleanupMixes(db, selected);
    });
    selected.forEach((id) => this.mixIds.delete(id));
  }

  async cleanup(options: AuthorizedFixtureCleanupOptions = {}): Promise<void> {
    for (const key of options.profileKeys ?? []) this.profileKeys.add(key);
    for (const date of options.syncDates ?? []) this.syncDates.add(date);
    for (const id of options.cheeseRecipeIds ?? []) this.cheeseRecipeIds.add(id);
    for (const id of options.doughRecipeIds ?? []) this.doughRecipeIds.add(id);
    for (const id of options.sauceRecipeIds ?? []) this.sauceRecipeIds.add(id);
    for (const id of options.mixIds ?? []) this.mixIds.add(id);
    const errors: unknown[] = [];
    await this.removeBrandProfiles().catch((error) => errors.push(error));
    await this.removeTodaySync().catch((error) => errors.push(error));
    await this.removeCheeseRecipes().catch((error) => errors.push(error));
    await this.removeDoughRecipes().catch((error) => errors.push(error));
    await this.removeSauceRecipes().catch((error) => errors.push(error));
    await this.removeMixes().catch((error) => errors.push(error));
    await this.withDatabase("cleanup authorized browser fixtures", async (db) => {
      await cleanupTestUsers(db, this.usernames);
      if (this.roleNames.size > 0) {
        await cleanupFixtureRoles(db, [...this.roleNames]);
      }
    }).catch((error) => errors.push(error));
    await this.releaseLiveFixtureLock().catch((error) => errors.push(error));
    await this.request.dispose().catch((error) => errors.push(error));
    if (errors.length > 0) {
      throw new AggregateError(errors, "Authorized browser fixture cleanup failed");
    }
    this.usernames.clear();
    this.roleNames.clear();
  }
}
