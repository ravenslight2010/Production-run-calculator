// Test-process-only networking fence; product routes/authorization are unchanged.
const net = require("node:net");
const http = require("node:http");
const assert = require("node:assert/strict");
assert.match(process.env.STAGING_RUN_ID ?? "", /^[a-f0-9]{32}$/);
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (port, ...rest) {
  assert.equal(Number(port), Number(process.env.PORT));
  return listen.call(this, { port: Number(port), host: "127.0.0.1" }, ...rest);
};
const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, ...args) {
  if (event === "request") args[1].setHeader("X-Isolated-Staging-Run", process.env.STAGING_RUN_ID);
  return emit.call(this, event, ...args);
};
