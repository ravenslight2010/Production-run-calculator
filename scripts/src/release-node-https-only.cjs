"use strict";

const http = require("node:http");
const originalGet = http.get;
const originalRequest = http.request;

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

http.request = function guardedHttpRequest(...args) {
  assertHttps(args);
  return originalRequest.apply(this, args);
};

http.get = function guardedHttpGet(...args) {
  assertHttps(args);
  return originalGet.apply(this, args);
};
