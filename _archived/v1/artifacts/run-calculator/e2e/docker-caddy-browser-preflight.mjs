import { chromium, webkit } from "@playwright/test";
import { resolveChromiumExecutable } from "./chromium.ts";
import { webkitLaunchOptions } from "./webkit-runtime.ts";

const engines = [
  ["chromium", chromium, () => ({ executablePath: resolveChromiumExecutable() })],
  ["webkit", webkit, () => webkitLaunchOptions() ?? {}],
];

const available = [];
const blocked = [];

for (const [name, engine, getOptions] of engines) {
  let browser;
  try {
    browser = await engine.launch({ headless: true, ...getOptions() });
    available.push(name);
    console.log(`READY browser: ${name}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
    blocked.push({ name, reason });
    console.log(`BLOCKED browser: ${name} — ${reason}`);
  } finally {
    await browser?.close().catch(() => {});
  }
}

console.log(`AVAILABLE_ENGINES=${available.join(",")}`);
console.log(`BLOCKED_ENGINES=${blocked.map(({ name }) => name).join(",")}`);
