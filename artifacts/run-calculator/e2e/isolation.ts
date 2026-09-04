import { Client } from "pg";
import type {
  APIRequestContext,
  APIResponse,
} from "@playwright/test";

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
export type E2ECapability = (typeof DEFAULT_MANAGER_CAPABILITIES)[number];

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

export interface AuthorizedFixtureCleanupOptions {
  profileKeys?: Iterable<string>;
  syncDates?: Iterable<string>;
}

/**
 * Destructive browser fixtures are only safe against a local database, a
 * database whose name explicitly identifies it as disposable, or an
 * explicitly approved CI/test mode.  REPLIT_DEV_DOMAIN alone is not a safety
 * signal: a development browser can still be pointed at a shared database.
 */
export function requireIsolatedTestDatabase(operation: string): string {
  const url = process.env.DATABASE_URL ?? "";
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
    await db.query("DELETE FROM users WHERE username = $1", [username]);
  }
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
      await db.query(
        `INSERT INTO roles (name, capabilities, builtin)
         VALUES ($1, $2::jsonb, false)`,
        [roleName, JSON.stringify([...options.capabilities])],
      );
      await db.query(
        `INSERT INTO user_roles (user_id, role)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET role = $2, updated_at = NOW()`,
        [auth.user.userId, roleName],
      );
      await db.query("UPDATE users SET onboarding_seen = $2 WHERE id = $1", [
        auth.user.userId,
        options.onboardingSeen ?? true,
      ]);
    });

    return {
      token: auth.token,
      userId: auth.user.userId,
      username,
      cookieHeader: { Cookie: `rc_auth=${auth.token}` },
    };
  }

  async seedBrandProfile(
    account: Pick<AuthorizedTestAccount, "token">,
    profile: BrandProfileFixture,
  ): Promise<string> {
    await this.start();
    const key = profile.key
      ?? `${profile.brand.toLowerCase()}__${profile.flavor.toLowerCase()}`;
    const response = await this.request.post(`${this.apiBase}/api/brand-profiles`, {
      headers: { Cookie: `rc_auth=${account.token}` },
      data: {
        items: [{
          ...profile,
          key,
          crustValues: profile.crustValues ?? {},
          updatedAt: profile.updatedAt ?? Date.now(),
        }],
      },
    });
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
    const response = await this.request.put(
      `${this.apiBase}/api/sync/today?today=${date}&epoch=${epoch}`,
      {
        headers,
        data: { senderId: fixture.senderId, payload: fixture.payload },
      },
    );
    if (!response.ok()) {
      throw new Error(`Fixture today sync seed failed: ${await responseFailure(response)}`);
    }
    this.syncDates.add(date);
    return date;
  }

  async removeBrandProfiles(
    keys: Iterable<string> = this.profileKeys,
    scope = "live",
  ): Promise<void> {
    const selected = [...keys];
    if (selected.length === 0) return;
    await this.withDatabase("remove browser fixture profiles", async (db) => {
      await db.query(
        "DELETE FROM brand_profiles WHERE key = ANY($1::text[]) AND scope = $2",
        [selected, scope],
      );
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
      await db.query(
        "DELETE FROM daily_sync WHERE date = ANY($1::text[]) AND scope = $2",
        [selected, scope],
      );
    });
    selected.forEach((date) => this.syncDates.delete(date));
  }

  async cleanup(options: AuthorizedFixtureCleanupOptions = {}): Promise<void> {
    for (const key of options.profileKeys ?? []) this.profileKeys.add(key);
    for (const date of options.syncDates ?? []) this.syncDates.add(date);
    const errors: unknown[] = [];
    await this.removeBrandProfiles().catch((error) => errors.push(error));
    await this.removeTodaySync().catch((error) => errors.push(error));
    await this.withDatabase("cleanup authorized browser fixtures", async (db) => {
      await cleanupTestUsers(db, this.usernames);
      if (this.roleNames.size > 0) {
        await db.query("DELETE FROM roles WHERE name = ANY($1::text[])", [
          [...this.roleNames],
        ]);
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
