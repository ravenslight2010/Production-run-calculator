import type {
  Browser,
  BrowserContext,
  Page,
  Route,
  TestInfo,
} from "@playwright/test";

export type DeviceName = "device-a" | "device-b";

export type DeviceDefinition = {
  name: DeviceName;
  viewport: { width: number; height: number };
  isMobile?: boolean;
  deviceScaleFactor?: number;
};

export type SyncPayload = {
  dayState: {
    date: string;
    runs: Array<Record<string, unknown>>;
    currentIndex?: number;
    [key: string]: unknown;
  };
  runValues: Record<string, Record<string, unknown>>;
  runValuesUpdatedAt?: Record<string, number>;
  [key: string]: unknown;
};

type DiagnosticEntry = {
  device: DeviceName;
  kind: "request" | "response" | "console" | "pageerror" | "marker";
  detail: string;
};

const DEFAULT_DEVICES: DeviceDefinition[] = [
  { name: "device-a", viewport: { width: 1280, height: 900 } },
  { name: "device-b", viewport: { width: 390, height: 844 }, isMobile: true },
];

function baseURL(): string {
  return process.env.PLAYWRIGHT_BASE_URL ??
    (process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : "http://127.0.0.1:5173");
}

function syncPath(url: string): boolean {
  return new URL(url).pathname.startsWith("/api/sync/");
}

/**
 * A reusable two-device browser fixture.
 *
 * Authentication is performed once, then the cookie state is cloned into two
 * new contexts. The contexts intentionally do not share localStorage, pages,
 * routes, or connectivity state. Tests should coordinate through observable
 * requests, server snapshots, and localStorage values rather than sleeps.
 */
export class MultiDeviceSession {
  readonly pages: Record<DeviceName, Page>;
  readonly contexts: Record<DeviceName, BrowserContext>;
  private readonly entries: DiagnosticEntry[] = [];

  private constructor(
    contexts: Record<DeviceName, BrowserContext>,
    pages: Record<DeviceName, Page>,
  ) {
    this.contexts = contexts;
    this.pages = pages;
  }

  static async create(
    browser: Browser,
    authenticate: (page: Page) => Promise<void>,
    devices: DeviceDefinition[] = DEFAULT_DEVICES,
  ): Promise<MultiDeviceSession> {
    if (devices.length !== 2) {
      throw new Error(`multi-device fixture requires exactly two devices, got ${devices.length}`);
    }
    const [first, second] = devices;
    if (first.name === second.name) {
      throw new Error("multi-device fixture device names must be unique");
    }

    const bootstrapContext = await browser.newContext({
      baseURL: baseURL(),
      viewport: first.viewport,
      isMobile: first.isMobile,
      deviceScaleFactor: first.deviceScaleFactor,
    });
    const bootstrapPage = await bootstrapContext.newPage();
    await authenticate(bootstrapPage);
    const storageState = await bootstrapContext.storageState();
    await bootstrapContext.close();

    const contexts = {} as Record<DeviceName, BrowserContext>;
    const pages = {} as Record<DeviceName, Page>;
    const session = new MultiDeviceSession(contexts, pages);

    for (const definition of devices) {
      const context = await browser.newContext({
        baseURL: baseURL(),
        storageState,
        viewport: definition.viewport,
        isMobile: definition.isMobile,
        deviceScaleFactor: definition.deviceScaleFactor,
      });
      const page = await context.newPage();
      contexts[definition.name] = context;
      pages[definition.name] = page;
      session.installDiagnostics(definition.name, page);
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
      session.mark(definition.name, "ready");
    }

    return session;
  }

  page(device: DeviceName): Page {
    return this.pages[device];
  }

  async close(): Promise<void> {
    await Promise.all(
      (Object.values(this.contexts) as BrowserContext[]).map((context) =>
        context.close().catch(() => {}),
      ),
    );
  }

  mark(device: DeviceName, detail: string): void {
    this.entries.push({ device, kind: "marker", detail });
  }

  async setOffline(device: DeviceName, offline: boolean): Promise<void> {
    await this.contexts[device].setOffline(offline);
    this.mark(device, offline ? "network offline" : "network online");
  }

  /**
   * Hold the first sync PUT from one device until release() is called.
   * This creates a deterministic simultaneous-action boundary without relying
   * on a wall-clock race. Later requests continue normally.
   */
  async holdFirstSyncWrite(device: DeviceName): Promise<{
    observed: Promise<void>;
    release: () => Promise<void>;
  }> {
    const page = this.page(device);
    let held = false;
    let observedResolve!: () => void;
    let releaseResolve!: () => void;
    let released = false;
    const observed = new Promise<void>((resolve) => {
      observedResolve = resolve;
    });
    const releasedGate = new Promise<void>((resolve) => {
      releaseResolve = resolve;
    });

    const handler = async (route: Route): Promise<void> => {
      const request = route.request();
      if (!held && request.method() === "PUT" && syncPath(request.url())) {
        held = true;
        this.mark(device, `held ${request.method()} ${new URL(request.url()).pathname}`);
        observedResolve();
        await releasedGate;
      }
      await route.continue();
    };
    await page.route("**/api/sync/**", handler);

    return {
      observed,
      release: async () => {
        if (released) return;
        released = true;
        releaseResolve();
        this.mark(device, "released held sync write");
      },
    };
  }

  /**
   * Deliberately drop all sync traffic for one context. This complements
   * BrowserContext.setOffline(): an already-open EventSource can otherwise
   * remain connected in some headless/browser versions.
   */
  async blockSyncTraffic(device: DeviceName): Promise<{
    release: () => Promise<void>;
  }> {
    const page = this.page(device);
    const handler = async (route: Route): Promise<void> => {
      const request = route.request();
      if (syncPath(request.url())) {
        this.mark(device, `dropped ${request.method()} ${new URL(request.url()).pathname}`);
        await route.abort("internetdisconnected");
        return;
      }
      await route.continue();
    };
    await page.route("**/api/sync/**", handler);
    let released = false;
    return {
      release: async () => {
        if (released) return;
        released = true;
        await page.unroute("**/api/sync/**", handler).catch(() => {});
        this.mark(device, "released blocked sync traffic");
      },
    };
  }

  async putToday(device: DeviceName, date: string, payload: SyncPayload): Promise<Record<string, unknown>> {
    const epochResponse = await this.page(device).request.get("/api/sync/reset-epoch");
    const epochBody = await epochResponse.json() as { epoch?: number };
    const epoch = typeof epochBody.epoch === "number" ? epochBody.epoch : 0;
    const response = await this.page(device).request.put(
      `/api/sync/today?today=${date}&epoch=${epoch}`,
      {
        data: {
          senderId: `multi-device-${device}`,
          payload,
        },
      },
    );
    const body = await response.json() as Record<string, unknown>;
    if (!response.ok()) {
      throw new Error(
        `[${device}] canonical fixture PUT failed: ${response.status()} ${JSON.stringify(body)}`,
      );
    }
    this.mark(device, `canonical PUT ${response.status()}`);
    return body;
  }

  async getToday(device: DeviceName, date: string): Promise<Record<string, unknown>> {
    const response = await this.page(device).request.get(
      `/api/sync/today?today=${date}`,
      { headers: { "cache-control": "no-cache" } },
    );
    const body = await response.json() as Record<string, unknown>;
    if (!response.ok()) {
      throw new Error(`[${device}] canonical GET failed: ${response.status()}`);
    }
    return body;
  }

  async localRunValue(
    device: DeviceName,
    runId: string,
    field: string,
  ): Promise<unknown> {
    return this.page(device).evaluate(
      ({ runId: id, field: key }) => {
        const raw = localStorage.getItem(`run-calc-run-${id}`);
        if (!raw) return undefined;
        return (JSON.parse(raw) as Record<string, unknown>)[key];
      },
      { runId, field },
    );
  }

  async localRunExists(device: DeviceName, runId: string): Promise<boolean> {
    const page = this.page(device);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await page.evaluate((id) => {
          const raw = localStorage.getItem("run-calc-day");
          const runs = (JSON.parse(raw ?? "{}") as { runs?: Array<{ id?: string }> }).runs ?? [];
          return runs.some((run) => run.id === id);
        }, runId);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !/execution context was destroyed|navigation/i.test(error.message)
        ) {
          throw error;
        }
        await page.waitForLoadState("domcontentloaded").catch(() => {});
      }
    }
    throw new Error(`[${device}] page kept navigating while reading local run state`);
  }

  async attachDiagnostics(testInfo: TestInfo): Promise<void> {
    await testInfo.attach("multi-device-diagnostics.json", {
      body: JSON.stringify(this.entries.slice(-250), null, 2),
      contentType: "application/json",
    });
    for (const device of ["device-a", "device-b"] as const) {
      const path = testInfo.outputPath(`${device}-failure.png`);
      await this.page(device).screenshot({ path, fullPage: true }).catch(() => {});
      await testInfo.attach(`${device}-failure.png`, { path, contentType: "image/png" }).catch(() => {});
    }
  }

  async withDiagnostics<T>(testInfo: TestInfo, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      await this.attachDiagnostics(testInfo);
      if (error instanceof Error) {
        error.message = `[multi-device convergence failure; inspect device-a/device-b evidence] ${error.message}`;
      }
      throw error;
    }
  }

  private installDiagnostics(device: DeviceName, page: Page): void {
    page.on("request", (request) => {
      if (syncPath(request.url())) {
        this.entries.push({
          device,
          kind: "request",
          detail: `${request.method()} ${new URL(request.url()).pathname}`,
        });
      }
    });
    page.on("response", (response) => {
      if (syncPath(response.url())) {
        this.entries.push({
          device,
          kind: "response",
          detail: `${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`,
        });
      }
    });
    page.on("console", (message) => {
      if (message.type() === "warning" || message.type() === "error") {
        this.entries.push({ device, kind: "console", detail: `${message.type()}: ${message.text()}` });
      }
    });
    page.on("pageerror", (error) => {
      this.entries.push({ device, kind: "pageerror", detail: error.message });
    });
  }
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function uniqueRunId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}