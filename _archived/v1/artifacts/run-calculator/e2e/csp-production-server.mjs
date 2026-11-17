import http from "node:http";
import https from "node:https";
import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";

const apiPort = Number(process.env.PORT);
const tlsPort = Number(process.env.CSP_TLS_PORT);
if (!Number.isInteger(apiPort) || !Number.isInteger(tlsPort)) {
  throw new Error("The disposable CSP server requires API and TLS ports.");
}

const certificateDirectory = process.env.CSP_TLS_ASSET_DIRECTORY;
const keyPath = process.env.CSP_TLS_KEY_PATH;
const certificatePath = process.env.CSP_TLS_CERT_PATH;
if (!certificateDirectory || !keyPath || !certificatePath) {
  throw new Error("The disposable CSP server requires its isolated TLS certificate files.");
}

const proxyServer = https.createServer(
  {
    key: await readFile(keyPath),
    cert: await readFile(certificatePath),
  },
  (request, response) => {
    const headers = { ...request.headers };
    delete headers.connection;
    delete headers["proxy-connection"];
    headers.host = request.headers.host ?? `127.0.0.1:${tlsPort}`;
    headers["x-forwarded-host"] = headers.host;
    headers["x-forwarded-proto"] = "https";
    headers["x-forwarded-port"] = String(tlsPort);

    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port: apiPort,
        method: request.method,
        path: request.url,
        headers,
      },
      (upstreamResponse) => {
        const responseHeaders = { ...upstreamResponse.headers };
        delete responseHeaders.connection;
        response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders);
        upstreamResponse.pipe(response);
      },
    );

    upstream.on("error", () => {
      if (!response.headersSent) {
        response.writeHead(502, { "content-type": "text/plain" });
      }
      response.end("Disposable API server is unavailable.");
    });
    request.on("aborted", () => upstream.destroy());
    response.on("close", () => {
      if (!response.writableEnded) upstream.destroy();
    });
    request.pipe(upstream);
  },
);

let apiProcess;
let stopRequested = false;
const requestStop = () => {
  stopRequested = true;
  proxyServer.close();
  proxyServer.closeAllConnections();
  if (apiProcess && apiProcess.exitCode === null) {
    apiProcess.kill("SIGTERM");
    const forceStop = setTimeout(() => {
      if (apiProcess?.exitCode === null) apiProcess.kill("SIGKILL");
    }, 5_000);
    forceStop.unref();
  }
};
process.once("SIGINT", requestStop);
process.once("SIGTERM", requestStop);

try {
  await new Promise((resolve, reject) => {
    proxyServer.once("error", reject);
    proxyServer.listen(tlsPort, "127.0.0.1", resolve);
  });

  apiProcess = spawn(
    process.execPath,
    ["--enable-source-maps", "artifacts/api-server/dist/index.mjs"],
    { cwd: process.cwd(), env: process.env, stdio: "inherit" },
  );
  apiProcess.on("error", (error) => {
    console.error("Could not start the disposable Express application.", error);
    process.exitCode = 1;
  });

  const result = await new Promise((resolve) => {
    apiProcess.once("close", (code, signal) => resolve({ code, signal }));
  });
  if (!stopRequested) {
    console.error("The disposable Express application exited unexpectedly.", result);
    process.exitCode = typeof result.code === "number" && result.code !== 0
      ? result.code
      : 1;
  }
} finally {
  if (proxyServer.listening) {
    proxyServer.close();
    proxyServer.closeAllConnections();
  }
  await rm(certificateDirectory, { recursive: true, force: true });
}
