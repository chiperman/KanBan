import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function withTestDirectory<T>(
  prefix: string,
  run: (root: string) => T | Promise<T>,
): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
