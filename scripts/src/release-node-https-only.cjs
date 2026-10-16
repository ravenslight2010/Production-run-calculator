"use strict";

const http = require("node:http");
const net = require("node:net");
const originalGet = http.get;
const originalRequest = http.request;
const originalSocketConnect = net.Socket.prototype.connect;
const originalSocketWrite = net.Socket.prototype.write;
const loopbackSockets = new WeakSet();

const httpTransportError = () => {
  const error = new Error(
    "Release runner blocks cleartext HTTP package downloads; use HTTPS.",
  );
  error.code = "ERR_RELEASE_RUNNER_HTTP_BLOCKED";
  return error;
};

const requestProtocol = (args) => {
  const first = args[0];
  if (typeof first === "string" || first instanceof URL) {
    return new URL(first).protocol;
  }
  if (first && typeof first === "object" && first.protocol) {
    return first.protocol;
  }
  const second = args[1];
  if (second && typeof second === "object" && second.protocol) {
    return second.protocol;
  }
  return "http:";
};

const isLoopbackHttpsProxyConnect = (args) => {
  const first = args[0];
  const second = args[1];
  const requestUrl =
    typeof first === "string" || first instanceof URL
      ? new URL(first)
      : undefined;
  const options =
    first && typeof first === "object" && !(first instanceof URL)
      ? first
      : second && typeof second === "object"
        ? second
        : undefined;
  if (!options || options.method?.toUpperCase() !== "CONNECT") return false;

  const proxyHost = options.hostname ?? options.host ?? requestUrl?.hostname;
  const target = options.path;
  const proxyPort = Number(options.port ?? requestUrl?.port);
  return (
    proxyHost === "127.0.0.1" &&
    Number.isInteger(proxyPort) &&
    proxyPort > 0 &&
    proxyPort <= 65535 &&
    typeof target === "string" &&
    /^(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+):443$/i.test(target)
  );
};

function normalizeHost(host) {
  if (typeof host !== "string") return "";
  const unwrapped = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (["127.0.0.1", "localhost", "::1"].includes(unwrapped)) return unwrapped;
  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return unwrapped;
  }
}

const isLoopbackHttpRequest = (args) => {
  if (requestProtocol(args) !== "http:") return false;
  const first = args[0];
  const second = args[1];
  const requestUrl =
    typeof first === "string" || first instanceof URL
      ? new URL(first)
      : undefined;
  const options =
    first && typeof first === "object" && !(first instanceof URL)
      ? first
      : second && typeof second === "object"
        ? second
        : undefined;
  if (options?.method?.toUpperCase() === "CONNECT") return false;
  const requestHost =
    options?.hostname ?? options?.host ?? requestUrl?.hostname;
  return ["127.0.0.1", "localhost", "::1"].includes(normalizeHost(requestHost));
};

const assertHttps = (args) => {
  if (
    requestProtocol(args) !== "https:" &&
    !isLoopbackHttpsProxyConnect(args) &&
    !isLoopbackHttpRequest(args)
  ) {
    throw httpTransportError();
  }
};

const cleartextHttpRequest = (chunk) => {
  let prefix;
  if (typeof chunk === "string") {
    prefix = chunk.slice(0, 256);
  } else if (Buffer.isBuffer(chunk)) {
    prefix = chunk.toString("ascii", 0, 256);
  } else if (ArrayBuffer.isView(chunk)) {
    prefix = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
      .toString("ascii", 0, 256);
  } else {
    return false;
  }

  if (/^CONNECT\s+\S+:443\s+HTTP\/1\.[01]\r?\n/i.test(prefix)) {
    return false;
  }
  return /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|TRACE|PRI)\s/i.test(
    prefix,
  );
};

http.request = function guardedHttpRequest(...args) {
  assertHttps(args);
  return originalRequest.apply(this, args);
};

http.get = function guardedHttpGet(...args) {
  assertHttps(args);
  return originalGet.apply(this, args);
};

const isLoopbackSocketConnect = (args) => {
  const first = args[0];
  const connectOptions =
    first && typeof first === "object"
      ? first
      : typeof args[1] === "string"
        ? { host: args[1] }
        : {};
  const host =
    connectOptions.host ?? connectOptions.hostname ?? "localhost";
  return ["127.0.0.1", "localhost", "::1"].includes(normalizeHost(host));
};

net.Socket.prototype.connect = function guardedSocketConnect(...args) {
  if (isLoopbackSocketConnect(args)) loopbackSockets.add(this);
  return originalSocketConnect.apply(this, args);
};

// Node clients that use Undici directly can bypass node:http. Check the
// outgoing request line as a final protocol boundary; TLS writes are binary
// handshake records, while accepted server sockets are responses, not
// outbound downloads.
net.Socket.prototype.write = function guardedSocketWrite(chunk, ...args) {
  if (
    !this.encrypted &&
    !this.server &&
    !loopbackSockets.has(this) &&
    cleartextHttpRequest(chunk)
  ) {
    throw httpTransportError();
  }
  return originalSocketWrite.call(this, chunk, ...args);
};
