import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const sourceRoot = pathToFileURL(`${process.cwd()}/src/`);

function resolveTsModule(specifier, base, context, nextResolve) {
  if (existsSync(new URL(`${specifier}/index.ts`, base))) {
    return nextResolve(new URL(`${specifier}/index.ts`, base).href, context);
  }
  return nextResolve(new URL(`${specifier}.ts`, base).href, context);
}

export async function resolve(specifier, context, nextResolve) {
  // Standalone production CLIs load session-auth outside Next's bundler.
  if (specifier === "next/headers") {
    return nextResolve("next/headers.js", context);
  }
  if (specifier.startsWith("@/")) {
    return resolveTsModule(
      specifier.slice(2),
      sourceRoot,
      context,
      nextResolve,
    );
  }
  if (
    specifier.startsWith(".") &&
    !specifier.endsWith(".js") &&
    !specifier.endsWith(".mjs") &&
    !specifier.endsWith(".json") &&
    !specifier.endsWith(".node") &&
    !specifier.endsWith(".ts") &&
    !specifier.endsWith(".tsx")
  ) {
    return resolveTsModule(specifier, context.parentURL, context, nextResolve);
  }
  return nextResolve(specifier, context);
}
