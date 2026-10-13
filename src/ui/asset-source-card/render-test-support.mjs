import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = process.cwd();
const modules = new Map();

// Node's type stripping does not support TSX; compile this test's local view graph.
export function loadView(file) {
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const localRequire = (specifier) => {
    const target = specifier.startsWith("@/")
      ? path.join(root, "src", specifier.slice(2))
      : specifier.startsWith(".")
        ? path.resolve(path.dirname(file), specifier)
        : null;
    if (target) {
      const local = [target, `${target}.ts`, `${target}.tsx`].find(
        (candidate) => statSync(candidate, { throwIfNoEntry: false })?.isFile(),
      );
      if (local) return loadView(local);
    }
    return require(specifier);
  };
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  new Function("require", "module", "exports", output)(localRequire, module, module.exports);
  return module.exports;
}
