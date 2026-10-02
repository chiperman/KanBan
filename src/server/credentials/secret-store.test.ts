import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { FileEncryptedSecretStore } from "./secret-store";

const key = Buffer.alloc(32, 7).toString("base64");
const workerSource = `
import { FileEncryptedSecretStore } from ${JSON.stringify(pathToFileURL(path.join(process.cwd(), "src/server/credentials/secret-store.ts")).href)};
const store = new FileEncryptedSecretStore(process.env.AUDIT_SECRET_PATH);
const send = value => process.send(value);
if (process.env.AUDIT_MODE === "stage") {
  const reference = await store.stage("synthetic-credential");
  send({type:"staged",reference});
  process.on("message", async message => {
    if (message === "commit") { await store.commit(reference); send({type:"committed"}); }
    if (message === "exit") process.exit(0);
  });
} else if (process.env.AUDIT_MODE === "recover") {
  const load = store.load.bind(store);
  store.load = async () => {
    const values = await load();
    send({type:"loaded"});
    await new Promise(resolve => process.once("message",resolve));
    return values;
  };
  await store.recover(new Set([process.env.AUDIT_REFERENCE]));
  send({type:"done"});
  process.disconnect();
} else {
  await store.replace(process.env.AUDIT_REFERENCE,"synthetic-new");
  send({type:"done"});
  process.disconnect();
}
`;

async function message(child: ChildProcess) {
  return Promise.race([
    once(child, "message"),
    once(child, "exit").then(([code]) => { throw new Error(`worker exited before response: ${code}`); }),
  ]);
}

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "kanban-secret-concurrency-"));
  const file = path.join(directory, "secrets.json");
  const worker = path.join(directory, "worker.mjs");
  await writeFile(worker, workerSource);
  const children: ChildProcess[] = [];
  function start(mode: string, reference = "") {
    const child = fork(worker, [], {
      execArgv: ["--experimental-transform-types", "--import", "./scripts/register-ts-alias.mjs"],
      env: { ...process.env, PAD_SECRET_ENCRYPTION_KEY: key, AUDIT_SECRET_PATH: file, AUDIT_MODE: mode, AUDIT_REFERENCE: reference },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    children.push(child);
    return child;
  }
  return { file, start, async dispose() {
    await Promise.all(children.map(async child => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }));
    await rm(directory, { recursive: true, force: true });
  } };
}

test("跨进程恢复不能覆盖已成功轮换的凭证", { timeout: 10_000 }, async () => {
  process.env.PAD_SECRET_ENCRYPTION_KEY = key;
  const f = await fixture();
  try {
    const store = new FileEncryptedSecretStore(f.file);
    const reference = await store.put("synthetic-old");
    const orphan = await store.stage("synthetic-legacy-orphan");
    const contents = JSON.parse(await readFile(f.file, "utf8"));
    delete contents[orphan].pendingOwnerPid;
    await writeFile(f.file, JSON.stringify(contents));
    const recovering = f.start("recover", reference);
    assert.equal((await message(recovering))[0].type, "loaded");
    const replacing = f.start("replace", reference);
    const replacementDone = message(replacing);
    // Unlocked code finishes the write while recovery holds its old read. Locked
    // code must wait, so release recovery after the bounded contention window.
    await Promise.race([replacementDone, new Promise(resolve => setTimeout(resolve, 250))]);
    const recoveryDone = message(recovering);
    recovering.send("continue");
    await Promise.all([replacementDone, recoveryDone]);
    assert.equal(await store.get(reference), "synthetic-new");
  } finally { await f.dispose(); }
});

test("持锁进程崩溃后其他进程可以继续写入", { timeout: 10_000 }, async () => {
  process.env.PAD_SECRET_ENCRYPTION_KEY = key;
  const f = await fixture();
  try {
    const store = new FileEncryptedSecretStore(f.file);
    const reference = await store.put("synthetic-old");
    const recovering = f.start("recover", reference);
    await message(recovering);
    const exited = once(recovering, "exit");
    recovering.kill("SIGKILL");
    await exited;
    const replacing = f.start("replace", reference);
    await message(replacing);
    assert.equal(await store.get(reference), "synthetic-new");
  } finally { await f.dispose(); }
});

test("同进程第二实例等待时不会释放第一实例对其他进程的锁", { timeout: 10_000 }, async () => {
  process.env.PAD_SECRET_ENCRYPTION_KEY = key;
  const f = await fixture();
  let release = () => undefined as void;
  try {
    const first = new FileEncryptedSecretStore(f.file);
    const second = new FileEncryptedSecretStore(f.file);
    const reference = await first.put("synthetic-old");
    const otherReference = await first.put("synthetic-other-old");
    const orphan = await first.stage("synthetic-legacy-orphan");
    const contents = JSON.parse(await readFile(f.file, "utf8"));
    delete contents[orphan].pendingOwnerPid;
    await writeFile(f.file, JSON.stringify(contents));
    const internals = first as unknown as { load(): Promise<Record<string, unknown>> };
    const originalLoad = internals.load.bind(first);
    const loaded = Promise.withResolvers<void>();
    const continueRead = Promise.withResolvers<void>();
    release = continueRead.resolve;
    internals.load = async () => {
      const values = await originalLoad();
      loaded.resolve();
      await continueRead.promise;
      return values;
    };
    const recovering = first.recover(new Set([reference, otherReference]));
    await loaded.promise;
    const replacing = second.replace(otherReference, "synthetic-other-new");
    const child = f.start("replace", reference);
    const childDone = message(child);
    await Promise.race([childDone, new Promise(resolve => setTimeout(resolve, 250))]);
    release();
    await Promise.all([recovering, replacing, childDone]);
    assert.equal(await first.get(reference), "synthetic-new");
    assert.equal(await first.get(otherReference), "synthetic-other-new");
  } finally { release(); await f.dispose(); }
});

test("另一进程恢复保留活跃 pending，崩溃后按业务引用提交或清理", { timeout: 10_000 }, async () => {
  process.env.PAD_SECRET_ENCRYPTION_KEY = key;
  const f = await fixture();
  try {
    const store = new FileEncryptedSecretStore(f.file);
    const active = f.start("stage");
    const [{ reference }] = await message(active);
    await store.recover(new Set());
    const committed = message(active);
    active.send("commit");
    assert.equal((await committed)[0].type, "committed");
    assert.equal(await store.get(reference), "synthetic-credential");
    for (const referenced of [false, true]) {
      const crashed = f.start("stage");
      const [{ reference: pending }] = await message(crashed);
      const exited = once(crashed, "exit");
      crashed.kill("SIGKILL");
      await exited;
      await store.recover(new Set(referenced ? [pending] : []));
      assert.equal(await store.get(pending), referenced ? "synthetic-credential" : null);
    }
  } finally { await f.dispose(); }
});
