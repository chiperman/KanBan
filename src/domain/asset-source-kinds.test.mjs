import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const directory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(directory, "__source-kind-contract__.ts");
const fixture = `
import { isPersistedAssetSourceKind, type AssetSourceKind } from "./asset-source-kinds";
import type * as Ports from "../server/ports";
import type { AssetSourceView } from "../ui/asset-source-card/types";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type SupportedKind = "longbridge" | "binance" | "okx" | "bitget" | "bit" |
  "evm-watch-ethereum" | "evm-watch-bsc" | "manual" | \`plugin:\${string}\`;
type Contracts = [
  Expect<Equal<AssetSourceKind, SupportedKind>>,
  Expect<Equal<Ports.AssetSourceKind, AssetSourceKind>>,
  Expect<Equal<Ports.AssetSourceSummary["kind"], AssetSourceKind>>,
  Expect<Equal<AssetSourceView["kind"], AssetSourceKind>>
];

function accept(source: Ports.AssetSourceSummary, view: AssetSourceView, raw: unknown, text: string) {
  view.kind = source.kind;
  source.kind = view.kind;
  if (isPersistedAssetSourceKind(raw)) {
    source.kind = raw;
    view.kind = raw;
  }
  // @ts-expect-error 未校验字符串不能成为业务来源类型。
  source.kind = text;
  // @ts-expect-error 前端来源不能放宽为任意字符串。
  view.kind = text;
  // @ts-expect-error 测试专用类型不能进入业务联合类型。
  source.kind = "fixture";
  // @ts-expect-error 未受支持的链不能冒充观察钱包。
  view.kind = "evm-watch-solana";
}
`;

test("来源实体、前端模型和端口统一使用内置或命名空间来源类型，并要求先校验外部值", () => {
  const options = {
    target: ts.ScriptTarget.ES2022,
    lib: ["lib.dom.d.ts", "lib.dom.iterable.d.ts", "lib.esnext.d.ts"],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true, skipLibCheck: true, noEmit: true, types: [],
    paths: { "@/*": [path.resolve(directory, "..", "*")] },
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, ...rest) =>
    fileName === fixturePath
      ? ts.createSourceFile(fileName, fixture, languageVersion, true)
      : getSourceFile(fileName, languageVersion, ...rest);
  const program = ts.createProgram([fixturePath], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnostics(diagnostics, {
    getCurrentDirectory: () => directory,
    getCanonicalFileName: (file) => file,
    getNewLine: () => "\n",
  }));
});
