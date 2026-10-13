import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const directory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(directory, "__source-sync-state-contract__.ts");

// Node 会擦除类型；用真实编译器验证契约，避免把运行通过误当成类型兼容。
const fixture = `
import type * as Root from "../ports";
import type * as Legacy from "./synchronization";
import type * as State from "./source-sync-state";

type Equal<Left, Right> =
  (<T>() => T extends Left ? 1 : 2) extends
  (<T>() => T extends Right ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

type Mode = "all" | "prices" | "holdings";
type Scope = "all" | "evm" | "non-evm";
type Diagnostic = {
  stage: "credentials" | "request" | "response" | "refresh" | "persist";
  category: "network" | "timeout" | "rate-limit" | "server" | "authentication" |
    "permission" | "restricted" | "cancelled" | "invalid-response" | "unknown";
  httpStatus: number | null;
  code: string | null;
  durationMs: number;
  retryable: boolean;
};
type Attempt = {
  attemptedAt: string;
  mode: Mode;
  attempt: number;
  outcome: "success" | "failure";
  durationMs: number;
  diagnostic: Diagnostic | null;
};
type SyncState = {
  status: "current" | "expired";
  lastSuccessfulAt: string;
  lastAttemptAt: string;
  error: string | null;
  diagnostic?: Diagnostic | null;
  recentAttempts?: Attempt[];
  failedMode?: Mode | null;
};
type Intent =
  | { reason: "manual-global" }
  | { reason: "manual-source"; sourceId: string }
  | { reason: "page-entry" | "foreground" | "interval" };
type Request = { intent: Intent; sourceIds?: string[] };
type Report = {
  successCount: number;
  failureCount: number;
  supersededCount?: number;
  skipped?: "not-due" | "in-progress" | "no-sources";
  attemptedAt?: string;
};

type Contracts = [
  Expect<Equal<State.AssetSourceSyncState, SyncState>>,
  Expect<Equal<State.AssetSyncDiagnostic, Diagnostic>>,
  Expect<Equal<State.AssetSyncAttempt, Attempt>>,
  Expect<Equal<State.AssetRefreshMode, Mode>>,
  Expect<Equal<State.AssetRefreshScope, Scope>>,
  Expect<Equal<State.AssetRefreshIntent, Intent>>,
  Expect<Equal<State.AssetRefreshRequest, Request>>,
  Expect<Equal<State.AssetRefreshReport, Report>>,
  Expect<Equal<Root.AssetSourceSummary["sync"], State.AssetSourceSyncState>>,
  Expect<Equal<Parameters<Legacy.AssetSynchronization["request"]>, [Request]>>,
  Expect<Equal<ReturnType<Legacy.AssetSynchronization["request"]>, Promise<Report>>>,
  Expect<Equal<Parameters<Legacy.AssetSynchronization["refresh"]>, [Mode, Scope?, string?]>>,
  Expect<Equal<ReturnType<Legacy.AssetSynchronization["refresh"]>, Promise<Report>>>,
  Expect<Equal<Parameters<Legacy.AssetSourceRefresher["refresh"]>[0]["mode"], Mode>>
];

const oldState: Root.AssetSourceSyncState = {
  status: "current", lastSuccessfulAt: "2026-10-13T00:00:00.000Z",
  lastAttemptAt: "2026-10-13T00:00:00.000Z", error: null,
};
const explicitNulls: Legacy.AssetSourceSyncState = {
  ...oldState, diagnostic: null, recentAttempts: [], failedMode: null,
};

function callers(synchronization: Root.AssetSynchronization) {
  void synchronization.request({ intent: { reason: "manual-global" } });
  void synchronization.request({ intent: { reason: "manual-source", sourceId: "source-1" }, sourceIds: ["source-1", "source-2"] });
  void synchronization.request({ intent: { reason: "interval" } });
  void synchronization.refresh("prices");
  void synchronization.refresh("holdings", "non-evm", "source-1");
  // @ts-expect-error 单来源意图必须带来源身份。
  void synchronization.request({ intent: { reason: "manual-source" } });
  // @ts-expect-error 不允许把任意字符串放宽为刷新模式。
  void synchronization.refresh("balance");
}
`;

const options = {
  target: ts.ScriptTarget.ES2022,
  lib: ["lib.dom.d.ts", "lib.dom.iterable.d.ts", "lib.esnext.d.ts"],
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  types: [],
  paths: { "@/*": [path.resolve(directory, "../..", "*")] },
};
const host = ts.createCompilerHost(options);
const getSourceFile = host.getSourceFile.bind(host);
host.getSourceFile = (fileName, languageVersion, ...rest) =>
  fileName === fixturePath
    ? ts.createSourceFile(fileName, fixture, languageVersion, true)
    : getSourceFile(fileName, languageVersion, ...rest);
const program = ts.createProgram([fixturePath], options, host);
const checker = program.getTypeChecker();

function sourceFile(relative) {
  const file = program.getSourceFile(path.resolve(directory, relative));
  assert.ok(file, `未加载模块：${relative}`);
  return file;
}

function exportedSymbols(relative) {
  const symbol = checker.getSymbolAtLocation(sourceFile(relative));
  assert.ok(symbol, `未找到模块符号：${relative}`);
  return new Map(checker.getExportsOfModule(symbol).map((entry) => [
    entry.name,
    entry.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(entry) : entry,
  ]));
}

test("同步共享类型保留原有字段、可选性、空值和联合类型，旧调用继续通过严格编译", () => {
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnostics(diagnostics, {
    getCurrentDirectory: () => directory,
    getCanonicalFileName: (file) => file,
    getNewLine: () => "\n",
  }));
});

test("稳定入口与旧同步端口重导出同一份共享类型，不重复定义或遗漏原执行端口", () => {
  const names = [
    "AssetRefreshIntent", "AssetRefreshMode", "AssetRefreshReport",
    "AssetRefreshRequest", "AssetRefreshScope", "AssetSourceSyncState",
    "AssetSyncAttempt", "AssetSyncDiagnostic",
  ];
  const canonical = exportedSymbols("source-sync-state.ts");
  const legacy = exportedSymbols("synchronization.ts");
  const root = exportedSymbols("../ports.ts");
  assert.deepEqual([...canonical.keys()].sort(), names);
  assert.deepEqual([...legacy.keys()].sort(), [
    ...names, "AssetSynchronization", "AssetFullRefreshState",
    "AssetSourceRefresher", "AssetSourceRefreshResult",
  ].sort());
  for (const [name, symbol] of legacy) {
    assert.equal(root.get(name), symbol, `稳定入口必须保留 ${name}`);
  }
  for (const name of names) {
    assert.equal(legacy.get(name), canonical.get(name), `${name} 只能有一个类型定义`);
  }
});

test("同步状态模块只声明共享值类型，不依赖来源实体或引入运行时代码", () => {
  const file = sourceFile("source-sync-state.ts");
  assert.ok(file.statements.every((statement) =>
    ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)
  ));
  assert.deepEqual(ts.preProcessFile(file.text).importedFiles, []);
});

test("来源实体与同步执行端口的类型依赖图不再存在循环", () => {
  const visited = new Set();
  function visit(file, chain = []) {
    assert.ok(!chain.includes(file.fileName), `循环依赖：${[...chain, file.fileName].map((name) => path.basename(name)).join(" -> ")}`);
    if (visited.has(file.fileName)) return;
    for (const { fileName: specifier } of ts.preProcessFile(file.text).importedFiles) {
      const resolved = ts.resolveModuleName(specifier, file.fileName, options, host).resolvedModule;
      assert.ok(resolved, `无法解析 ${file.fileName} 中的 ${specifier}`);
      const dependency = program.getSourceFile(resolved.resolvedFileName);
      assert.ok(dependency);
      visit(dependency, [...chain, file.fileName]);
    }
    visited.add(file.fileName);
  }
  visit(sourceFile("sources.ts"));
  visit(sourceFile("synchronization.ts"));
});
