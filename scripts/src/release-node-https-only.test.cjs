"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const { once } = require("node:events");
const { test } = require("node:test");

require("./release-node-https-only.cjs");

test("allows loopback HTTP and HTTPS proxy CONNECT but rejects external HTTP", async (t) => {
  const proxy = http.createServer((_request, response) => {
    response.end("local response");
  });
  proxy.on("connect", (_request, socket) => {
    socket.end("HTTP/1.1 200 Connection Established\r\n\r\n");
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  t.after(() => proxy.close());

  const { port } = proxy.address();
  const localStatus = await new Promise((resolve, reject) => {
    const request = http.get(
      new URL(`http://127.0.0.1:${port}/ready`),
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
      },
    );
    request.once("error", reject);
  });
  assert.equal(localStatus, 200);

  const responseCode = await new Promise((resolve, reject) => {
    const request = http.request(
      new URL(`http://127.0.0.1:${port}`),
      { method: "CONNECT", path: "playwright.download.example:443" },
    );
    request.once("connect", (response, socket) => {
      socket.destroy();
      resolve(response.statusCode);
    });
    request.once("error", reject);
    request.end();
  });
  assert.equal(responseCode, 200);

  assert.throws(
    () => http.get("http://example.com/"),
    { code: "ERR_RELEASE_RUNNER_HTTP_BLOCKED" },
  );
  assert.throws(
    () => http.request({
      hostname: "127.0.0.1",
      port,
      method: "CONNECT",
      path: "example.com:80",
    }),
    { code: "ERR_RELEASE_RUNNER_HTTP_BLOCKED" },
  );
  assert.throws(
    () => http.request({
      hostname: "example.com",
      port,
      method: "CONNECT",
      path: "example.com:443",
    }),
    { code: "ERR_RELEASE_RUNNER_HTTP_BLOCKED" },
  );

  const rawSocket = net.connect(port, "127.0.0.1");
  await once(rawSocket, "connect");
  const rawResponse = new Promise((resolve) => {
    rawSocket.once("data", (chunk) => resolve(chunk.toString("ascii")));
  });
  rawSocket.write(
    `GET /raw HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`,
  );
  assert.match(await rawResponse, /^HTTP\/1\.1 200 OK/);
  rawSocket.destroy();

  const unconnectedSocket = new net.Socket();
  assert.throws(
    () => unconnectedSocket.write("GET / HTTP/1.1\r\nHost: example.com\r\n\r\n"),
    { code: "ERR_RELEASE_RUNNER_HTTP_BLOCKED" },
  );
  unconnectedSocket.destroy();
});
