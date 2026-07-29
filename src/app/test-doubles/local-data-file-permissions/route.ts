import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { isTestEnv } from "@/server/composition";
import {
  FileDashboardDatabase,
  FileEncryptedSecretStore,
  FileOwnerCredentialStore,
  FileOwnerRecoveryCredentialStore,
  createProductionServices,
} from "@/server/production";
import {
  atomicWritePrivateFile,
  hardenLocalDataPermissions,
  readPrivateFile,
} from "@/server/local-data-permissions";

export const dynamic = "force-dynamic";

const execFile = promisify(execFileCallback);

function displayMode(mode: number): string {
  return mode.toString(8).padStart(4, "0");
}

async function modeOf(filePath: string): Promise<string> {
  return displayMode((await stat(filePath)).mode & 0o777);
}

async function observeTemporaryMode(
  directoryPath: string,
  operation: () => Promise<void>,
): Promise<string> {
  let writing = true;
  const observation = (async () => {
    while (writing) {
      const temporary = (await readdir(directoryPath)).find((name) =>
        name.endsWith(".tmp"),
      );
      if (temporary) {
        try {
          return await modeOf(path.join(directoryPath, temporary));
        } catch {
          // rename 可能先于 stat；继续轮询后续临时 inode。
        }
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return null;
  })();
  try {
    await operation();
  } finally {
    writing = false;
  }
  const observed = await observation;
  if (observed === null) throw new Error("未观测到原子写入临时文件权限");
  return observed;
}

export async function POST(request: Request) {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const action = new URL(request.url).searchParams.get("action");
  if (
    action !== "first-create" &&
    action !== "harden-existing" &&
    action !== "atomic-write" &&
    action !== "harden-failure" &&
    action !== "legacy-recovery-cleanup" &&
    action !== "legacy-recovery-save-race"
  ) {
    return Response.json({ error: "unknown action" }, { status: 400 });
  }

  const root = await mkdtemp(path.join(tmpdir(), "pad-file-permissions-"));
  const dataDirectory = path.join(root, "data");
  const previousKey = process.env.PAD_SECRET_ENCRYPTION_KEY;
  process.env.PAD_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
  try {
    if (action === "legacy-recovery-save-race") {
      const ownerRecoveryPath = path.join(dataDirectory, "owner-recovery.json");
      await atomicWritePrivateFile(ownerRecoveryPath, JSON.stringify({
        email: "legacy@example.com",
        passwordSalt: "legacy-salt",
        passwordHash: "legacy-hash",
        encryptedTotpSecret: "legacy-encrypted",
        totpIv: "legacy-iv",
        totpAuthTag: "legacy-tag",
        padding: "x".repeat(16 * 1024 * 1024),
      }));
      const store = new FileOwnerRecoveryCredentialStore(ownerRecoveryPath);
      await Promise.all([
        store.get(),
        store.save({
          version: 2,
          encryptedTotpSecret: "new-encrypted",
          totpIv: "new-iv",
          totpAuthTag: "new-tag",
          lastUsedTotpCounter: null,
        }),
      ]);
      const persisted = await store.get();
      return Response.json({
        newCredentialPreserved:
          persisted?.version === 2 &&
          persisted.encryptedTotpSecret === "new-encrypted",
      });
    }

    if (action === "legacy-recovery-cleanup") {
      const ownerRecoveryPath = path.join(dataDirectory, "owner-recovery.json");
      await atomicWritePrivateFile(ownerRecoveryPath, JSON.stringify({
        email: "legacy@example.com",
        passwordSalt: "legacy-salt",
        passwordHash: "legacy-hash",
        encryptedTotpSecret: "legacy-encrypted",
        totpIv: "legacy-iv",
        totpAuthTag: "legacy-tag",
      }));
      const configured = await new FileOwnerRecoveryCredentialStore(
        ownerRecoveryPath,
      ).get();
      return Response.json({
        configured: configured !== null,
        legacyFileExists: (await readdir(dataDirectory)).includes(
          "owner-recovery.json",
        ),
      });
    }

    if (action === "harden-failure") {
      const contents = "existing-private-data";
      await mkdir(dataDirectory);
      const existingFile = path.join(dataDirectory, "cards.json");
      await writeFile(existingFile, contents, { mode: 0o644 });
      await chmod(existingFile, 0o644);
      await execFile("/usr/bin/chflags", ["uchg", existingFile]);
      let error = "";
      try {
        createProductionServices(dataDirectory);
      } catch (startupError) {
        error = startupError instanceof Error
          ? startupError.message
          : String(startupError);
      } finally {
        await execFile("/usr/bin/chflags", ["nouchg", existingFile]);
      }
      return Response.json({
        startupRejected: error.length > 0,
        failurePath:
          error.includes(existingFile) &&
          error.toLowerCase().includes("operation not permitted")
            ? "existing-file-chmod"
            : "unexpected",
        contentsPreserved: (await readPrivateFile(existingFile)) === contents,
        error,
      });
    }

    if (action === "atomic-write") {
      const targetPath = path.join(dataDirectory, "dashboard.json");
      await atomicWritePrivateFile(targetPath, "initial");
      await chmod(dataDirectory, 0o777);
      await chmod(targetPath, 0o666);

      const temporaryMode = await observeTemporaryMode(
        dataDirectory,
        () => atomicWritePrivateFile(
          targetPath,
          "x".repeat(8 * 1024 * 1024),
        ),
      );
      await atomicWritePrivateFile(targetPath, "replacement");

      return Response.json({
        directoryMode: await modeOf(dataDirectory),
        temporaryMode,
        targetMode: await modeOf(targetPath),
        contents: await readPrivateFile(targetPath),
        temporaryFiles: (await readdir(dataDirectory)).filter((name) =>
          name.endsWith(".tmp"),
        ),
      });
    }

    if (action === "harden-existing") {
      await mkdir(dataDirectory, { mode: 0o777 });
      await chmod(dataDirectory, 0o777);
      const filePaths = [
        path.join(dataDirectory, "dashboard.sqlite"),
        path.join(dataDirectory, "dashboard.json.migration-backup"),
        path.join(dataDirectory, "cards.json"),
        path.join(dataDirectory, "dashboard.sqlite.atomic.tmp"),
      ];
      const expectedContents = filePaths.map((filePath, index) =>
        `${path.basename(filePath)}:${index}`,
      );
      await Promise.all(
        filePaths.map(async (filePath, index) => {
          await writeFile(filePath, expectedContents[index], { mode: 0o666 });
          await chmod(filePath, 0o666);
        }),
      );

      hardenLocalDataPermissions(dataDirectory);

      return Response.json({
        directoryMode: await modeOf(dataDirectory),
        fileModes: await Promise.all(
          filePaths.map(modeOf),
        ),
        contentsPreserved:
          JSON.stringify(await Promise.all(filePaths.map(readPrivateFile))) ===
          JSON.stringify(expectedContents),
      });
    }

    hardenLocalDataPermissions(dataDirectory);
    const dashboardPath = path.join(dataDirectory, "dashboard.json");
    const secretsPath = path.join(dataDirectory, "secrets.json");
    const ownerCredentialPath = path.join(dataDirectory, "owner-credential.json");
    const ownerRecoveryPath = path.join(dataDirectory, "owner-recovery.json");

    await new FileDashboardDatabase(
      dashboardPath,
      path.join(dataDirectory, "cards.json"),
    ).replaceAssetCards([]);
    await new FileEncryptedSecretStore(secretsPath).put("probe-secret");
    await new FileOwnerCredentialStore(ownerCredentialPath).save({
      id: "owner-credential",
      publicKey: "public-key",
      counter: 0,
    });
    await new FileOwnerRecoveryCredentialStore(ownerRecoveryPath).save({
      version: 2,
      encryptedTotpSecret: "encrypted",
      totpIv: "iv",
      totpAuthTag: "tag",
      lastUsedTotpCounter: null,
    });

    return Response.json({
      directoryMode: await modeOf(dataDirectory),
      dashboardMode: await modeOf(dashboardPath),
      secretsMode: await modeOf(secretsPath),
      ownerCredentialMode: await modeOf(ownerCredentialPath),
      ownerRecoveryMode: await modeOf(ownerRecoveryPath),
    });
  } finally {
    if (previousKey === undefined) delete process.env.PAD_SECRET_ENCRYPTION_KEY;
    else process.env.PAD_SECRET_ENCRYPTION_KEY = previousKey;
    await rm(root, { recursive: true, force: true });
  }
}
