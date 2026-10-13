import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { withTestDirectory } from "@/server/testing/temporary-directory";

async function assertRemoved(root: string) {
  await assert.rejects(access(root), { code: "ENOENT" });
}

test("临时目录在操作完成后递归清理并保留返回值", async () => {
  let directory = "";
  const result = { ok: true };
  assert.equal(await withTestDirectory("pad-helper-success-", async (root) => {
    directory = root;
    assert.ok(path.basename(root).startsWith("pad-helper-success-"));
    await mkdir(path.join(root, "nested"));
    await writeFile(path.join(root, "nested", "fixture.txt"), "fixture");
    return result;
  }), result);
  await assertRemoved(directory);
});

test("临时目录在同步和异步异常时清理且保留原异常", async () => {
  for (const asynchronous of [false, true]) {
    let directory = "";
    const failure = new Error("fixture failed");
    await assert.rejects(withTestDirectory("pad-helper-failure-", (root) => {
      directory = root;
      if (asynchronous) return writeFile(path.join(root, "fixture.txt"), "fixture")
        .then(() => { throw failure; });
      throw failure;
    }), (error) => error === failure);
    await assertRemoved(directory);
  }
});

test("并发临时目录彼此隔离，提前结束的操作不清理仍在使用的目录", async () => {
  let first = "";
  let second = "";
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const secondRun = withTestDirectory("pad-helper-parallel-", async (root) => {
    second = root;
    started();
    await pending;
  });
  try {
    await ready;
    await withTestDirectory("pad-helper-parallel-", async (root) => {
      first = root;
      assert.notEqual(first, second);
      await access(second);
    });
    await assertRemoved(first);
    await access(second);
  } finally {
    release();
    await secondRun;
  }
  await assertRemoved(second);
});
