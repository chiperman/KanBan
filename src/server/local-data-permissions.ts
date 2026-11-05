import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

export const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

function permissionError(targetPath: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(
    `本地数据权限硬化失败，拒绝继续使用不安全路径 ${targetPath}: ${detail}`,
    { cause: error },
  );
}

function hardenExistingEntrySync(entryPath: string): void {
  let entry;
  try {
    entry = lstatSync(entryPath);
  } catch (error) {
    throw permissionError(entryPath, error);
  }

  if (entry.isSymbolicLink()) {
    throw permissionError(entryPath, new Error("数据目录内不允许符号链接"));
  }

  if (entry.isDirectory()) {
    let children: string[];
    try {
      chmodSync(entryPath, PRIVATE_DIRECTORY_MODE);
      children = readdirSync(entryPath);
    } catch (error) {
      throw permissionError(entryPath, error);
    }
    for (const child of children) {
      hardenExistingEntrySync(path.join(entryPath, child));
    }
    return;
  }
  if (entry.isFile()) {
    try {
      chmodSync(entryPath, PRIVATE_FILE_MODE);
    } catch (error) {
      throw permissionError(entryPath, error);
    }
  }
}

/** 启动边界：收紧已有数据目录、SQLite/JSON、备份和临时文件。 */
export function hardenLocalDataPermissions(dataDirectory: string): void {
  try {
    mkdirSync(dataDirectory, {
      recursive: true,
      mode: PRIVATE_DIRECTORY_MODE,
    });
  } catch (error) {
    throw permissionError(dataDirectory, error);
  }
  hardenExistingEntrySync(dataDirectory);
}

export async function ensurePrivateDirectory(
  directoryPath: string,
): Promise<void> {
  try {
    await mkdir(directoryPath, {
      recursive: true,
      mode: PRIVATE_DIRECTORY_MODE,
    });
    await chmod(directoryPath, PRIVATE_DIRECTORY_MODE);
  } catch (error) {
    throw permissionError(directoryPath, error);
  }
}

export async function readPrivateFile(filePath: string): Promise<string> {
  try {
    await chmod(filePath, PRIVATE_FILE_MODE);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      throw error;
    }
    throw permissionError(filePath, error);
  }
  return readFile(filePath, "utf8");
}

/** 写入边界：临时文件与 rename 后目标均强制为 0600。 */
export async function atomicWritePrivateFile(
  filePath: string,
  contents: string,
): Promise<void> {
  await ensurePrivateDirectory(path.dirname(filePath));
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, contents, {
      encoding: "utf8",
      mode: PRIVATE_FILE_MODE,
      flag: "wx",
    });
    await chmod(temporaryPath, PRIVATE_FILE_MODE);
    await rename(temporaryPath, filePath);
    await chmod(filePath, PRIVATE_FILE_MODE);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw permissionError(filePath, error);
  }
}
