import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";

import { resolveNodeNetworkEnvironment } from "./local-network-environment.mjs";

test("不可达的本机环境代理会回退到系统网络", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  await new Promise((resolve) => server.close(resolve));

  const result = await resolveNodeNetworkEnvironment({
    HTTPS_PROXY: `http://127.0.0.1:${address.port}`,
    NODE_USE_ENV_PROXY: "1",
  });

  assert.equal(result.env.NODE_USE_ENV_PROXY, "0");
  assert.equal(result.env.HTTPS_PROXY, "");
  assert.deepEqual(result.unavailableLocalProxies, [
    `127.0.0.1:${address.port}`,
  ]);
});

test("可达的本机环境代理保持启用", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  try {
    const result = await resolveNodeNetworkEnvironment({
      HTTPS_PROXY: `http://127.0.0.1:${address.port}`,
      NODE_USE_ENV_PROXY: "1",
    });

    assert.equal(result.env.NODE_USE_ENV_PROXY, "1");
    assert.equal(result.env.HTTPS_PROXY, `http://127.0.0.1:${address.port}`);
    assert.deepEqual(result.unavailableLocalProxies, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("远程环境代理不在启动时探测或绕过", async () => {
  const result = await resolveNodeNetworkEnvironment({
    HTTPS_PROXY: "http://192.0.2.1:7890",
    NODE_USE_ENV_PROXY: "1",
  });

  assert.equal(result.env.NODE_USE_ENV_PROXY, "1");
  assert.deepEqual(result.unavailableLocalProxies, []);
});

test("失效本机代理不会覆盖可用远程代理", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  await new Promise((resolve) => server.close(resolve));

  const result = await resolveNodeNetworkEnvironment({
    HTTPS_PROXY: `http://127.0.0.1:${address.port}`,
    ALL_PROXY: "http://192.0.2.1:7890",
    NODE_USE_ENV_PROXY: "1",
  });

  assert.equal(result.env.HTTPS_PROXY, "");
  assert.equal(result.env.ALL_PROXY, "http://192.0.2.1:7890");
  assert.equal(result.env.NODE_USE_ENV_PROXY, "1");
});
