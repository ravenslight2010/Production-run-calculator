import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";
const SAFE_ERROR_TYPE = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const SAFE_ERROR_CODE = /^[A-Za-z0-9_-]{1,32}$/;

export function serializeErrorForLog(error: unknown): { type: string; code?: string } {
  if (!(error instanceof Error)) return { type: "NonError" };

  const type = SAFE_ERROR_TYPE.test(error.name) ? error.name : "Error";
  const code = (error as Error & { code?: unknown }).code;
  return {
    type,
    ...(typeof code === "string" && SAFE_ERROR_CODE.test(code) ? { code } : {}),
  };
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  serializers: {
    err: serializeErrorForLog,
  },
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
