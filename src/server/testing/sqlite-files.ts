import { readFile } from "node:fs/promises";

export async function readSqliteFiles(databasePath: string): Promise<string> {
  const database = await readFile(/* turbopackIgnore: true */ databasePath);
  // Committed writes may still live in WAL; audit sidecars before closing SQLite.
  const sidecars = await Promise.all(["-wal", "-shm"].map(async (suffix) => {
    try {
      return await readFile(/* turbopackIgnore: true */ `${databasePath}${suffix}`);
    } catch (error: unknown) {
      if (
        typeof error === "object" && error !== null &&
        "code" in error && error.code === "ENOENT"
      ) {
        return Buffer.alloc(0);
      }
      throw error;
    }
  }));
  return [database, ...sidecars].map((file) => file.toString("latin1")).join("\0");
}
