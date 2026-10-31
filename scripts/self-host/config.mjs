import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function validateSetup({ site, timeZone, manager }) {
  // A single private DNS hostname, never a URL, port, shell fragment or wildcard.
  if (typeof site !== "string" || site.length > 253 || !site.includes(".") ||
      !site.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)))
    throw new Error("Choose a LAN DNS hostname such as runcalc.factory.lan");
  new Intl.DateTimeFormat("en-US", { timeZone }).format();
  if (!timeZone || !/^[A-Za-z0-9_+\/-]+$/.test(timeZone)) throw new Error("Choose the facility IANA timezone");
  if (typeof manager !== "string" || !/^[A-Za-z0-9_-]{3,64}$/.test(manager))
    throw new Error("Manager username must be 3-64 letters, digits, underscores or hyphens");
}

export function createEnvironment(options, secret = () => randomBytes(32).toString("hex")) {
  validateSetup(options);
  const password = secret();
  return [
    "# Private bootstrap credentials. Keep this file out of Git and backups shared with staff.",
    "POSTGRES_DB=runcalc", "POSTGRES_USER=runcalc_user", `POSTGRES_PASSWORD=${password}`,
    `DATABASE_URL=postgresql://runcalc_user:${password}@db:5432/runcalc`,
    `AUTH_TOKEN_SECRET=${secret()}`, "NODE_ENV=production", "PORT=5000", `TZ=${options.timeZone}`,
    `SITE_ADDRESS=${options.site}`, `STAFF_SIGNUP_CODE=${secret()}`,
    `INITIAL_MANAGER_USERNAME=${options.manager}`, `INITIAL_MANAGER_ACCESS_CODE=${secret()}`,
    "REPLIT_DOMAINS=", "LOCAL_AI_BASE_URL=http://ollama:11434/v1",
    "LOCAL_AI_API_KEY=ollama", "LOCAL_MODEL_FULL=qwen3:4b", "LOCAL_MODEL_CHEAP=qwen3:4b",
    "LOCAL_AI_FALLBACK_TO_GEMINI=false", "LOCAL_AI_STRICT_READINESS=false", "",
  ].join("\n");
}

export async function initialize(directory, options) {
  const content = createEnvironment(options);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // Exclusive create: never replace credentials of an existing installation.
  await writeFile(resolve(directory, "self-host.env"), content, { flag: "wx", mode: 0o600 });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [directory, site, timeZone, manager] = process.argv.slice(2);
  if (!directory) throw new Error("Usage: node config.mjs DIRECTORY HOSTNAME IANA_TIMEZONE MANAGER");
  await initialize(directory, { site, timeZone, manager });
  console.log("Created private self-host.env; no credentials printed.");
}
