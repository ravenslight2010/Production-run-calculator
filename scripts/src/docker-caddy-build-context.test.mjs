import test from "node:test";
import assert from "node:assert/strict";
import { dockerCaddyBuildContext } from "./docker-caddy-build-context.mjs";

test("default local and CI builds do not request host networking or Bake privileges", () => {
  for (const environment of [{}, { CI: "true" }, { GITHUB_ACTIONS: "true", COMPOSE_BAKE: "true" }]) {
    assert.equal(dockerCaddyBuildContext("/tmp/project", environment), 'context: "/tmp/project"');
  }
});

test("only an explicit local host-network workaround is accepted", () => {
  assert.equal(dockerCaddyBuildContext("/tmp/project", { DOCKER_CADDY_BUILD_NETWORK: "host" }),
    'context: "/tmp/project"\n      network: host');
  for (const environment of [{ CI: "true" }, { CI: "1" }, { GITHUB_ACTIONS: "true" }]) {
    assert.throws(() => dockerCaddyBuildContext("/tmp/project", {
      ...environment, DOCKER_CADDY_BUILD_NETWORK: "host",
    }), /not permitted in CI/);
  }
});

test("unknown build networks fail closed without echoing the supplied value", () => {
  assert.throws(() => dockerCaddyBuildContext("/tmp/project", {
    DOCKER_CADDY_BUILD_NETWORK: "private-untrusted-value",
  }), error => /must be default or host/.test(error.message)
    && !error.message.includes("private-untrusted-value"));
});

test("Compose context safely quotes spaces, quotes and Windows path separators", () => {
  for (const directory of ["/tmp/project space", '/tmp/a"quote', "C:\\Factory\\Run Calculator"]) {
    assert.equal(dockerCaddyBuildContext(directory, {}), `context: ${JSON.stringify(directory)}`);
  }
});
