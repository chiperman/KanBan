import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { discoverUnitTests } from './run-unit-tests.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'kanban-unit-entry-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ['src/nested', 'scripts', 'e2e']) mkdirSync(path.join(root, directory), { recursive: true });
  writeFileSync(path.join(root, 'scripts/register-ts-alias.mjs'), '');
  return root;
}

test('自动发现嵌套离线测试，排除浏览器和非测试文件', (t) => {
  const root = fixture(t);
  for (const file of ['src/nested/new.test.ts', 'scripts/new.test.mjs', 'src/helper.ts', 'e2e/live.test.ts']) writeFileSync(path.join(root, file), '');
  assert.deepEqual(discoverUnitTests(root), ['scripts/new.test.mjs', 'src/nested/new.test.ts']);
});

test('真实入口传播通过、失败及没有测试的退出状态', (t) => {
  const root = fixture(t);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = () => spawnSync(process.execPath, [path.resolve('scripts/run-unit-tests.mjs')], { cwd: root, encoding: 'utf8', env });
  assert.notEqual(run().status, 0);
  const file = path.join(root, 'src/nested/new.test.mjs');
  writeFileSync(file, "import { test } from 'node:test'; test('ok', () => {});");
  assert.equal(run().status, 0);
  writeFileSync(file, "import { test } from 'node:test'; test('failure', () => { throw new Error('expected fixture failure'); });");
  assert.notEqual(run().status, 0);
});
