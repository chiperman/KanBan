import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { FileOwnerCredentialStore } from "./owner-store";

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "kanban-owner-store-"));
  return {
    directory,
    file: path.join(directory, "owner-credential.json"),
    store: new FileOwnerCredentialStore(
      path.join(directory, "owner-credential.json"),
    ),
  };
}

test("凭证可保存、读取并附带绑定时间", async () => {
  const { directory, store } = await fixture();
  try {
    assert.equal(await store.get(), null);
    await store.save({
      id: "credential-1",
      publicKey: "public-key",
      counter: 0,
      createdAt: "2026-10-20T00:00:00.000Z",
    });
    assert.deepEqual(await store.get(), {
      id: "credential-1",
      publicKey: "public-key",
      counter: 0,
      createdAt: "2026-10-20T00:00:00.000Z",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("旧凭证缺少绑定时间仍然有效", async () => {
  const { directory, file, store } = await fixture();
  try {
    await writeFile(
      file,
      JSON.stringify({ id: "legacy", publicKey: "old-key", counter: 3 }),
    );
    assert.deepEqual(await store.get(), {
      id: "legacy",
      publicKey: "old-key",
      counter: 3,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("移除凭证后回到未预置状态，重复移除不报错", async () => {
  const { directory, store } = await fixture();
  try {
    await store.save({ id: "credential-1", publicKey: "key", counter: 0 });
    await store.remove();
    assert.equal(await store.get(), null);
    await store.remove();
    assert.equal(await store.get(), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("凭证文件格式无效时拒绝读取", async () => {
  const { directory, file, store } = await fixture();
  try {
    await writeFile(file, JSON.stringify({ id: "credential-1" }));
    await assert.rejects(() => store.get(), /凭证文件格式无效/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
