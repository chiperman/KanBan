import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Only repository-owned, offline Node tests belong to this entry point.
export function discoverUnitTests(root = process.cwd()) {
  function walk(directory) {
    return readdirSync(path.join(root, directory), { withFileTypes: true })
      .flatMap((entry) => {
        const relative = path.join(directory, entry.name);
        if (entry.isDirectory()) return walk(relative);
        return entry.isFile() && /\.test\.(ts|mjs)$/.test(entry.name) ? [relative] : [];
      });
  }
  return ['scripts', 'src'].flatMap(walk).sort();
}

export function runUnitTests(root = process.cwd()) {
  const files = discoverUnitTests(root);
  if (!files.length) throw new Error('未发现离线单元测试');
  const child = spawnSync(process.execPath, [
    '--experimental-transform-types', '--import', './scripts/register-ts-alias.mjs',
    '--test', ...files,
  ], { cwd: root, stdio: 'inherit' });
  if (child.error) throw child.error;
  return child.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runUnitTests();
}
