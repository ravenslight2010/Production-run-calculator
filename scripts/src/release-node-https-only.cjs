"use strict";

const http = require("node:http");
const net = require("node:net");
const originalGet = http.get;
const originalRequest = http.request;
const originalSocketWrite = net.Socket.prototype.write;

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

const assertHttps = (args) => {
  if (requestProtocol(args) !== "https:") {
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

// Node clients that use Undici directly can bypass node:http. Check the
// outgoing request line as a final protocol boundary; TLS writes are binary
// handshake records, while accepted server sockets are responses, not
// outbound downloads.
net.Socket.prototype.write = function guardedSocketWrite(chunk, ...args) {
  if (!this.encrypted && !this.server && cleartextHttpRequest(chunk)) {
    throw httpTransportError();
  }
  return originalSocketWrite.call(this, chunk, ...args);
};
