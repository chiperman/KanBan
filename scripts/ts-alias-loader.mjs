import { pathToFileURL } from "node:url";

const sourceRoot = pathToFileURL(`${process.cwd()}/src/`);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return nextResolve(
      new URL(`${specifier.slice(2)}.ts`, sourceRoot).href,
      context,
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
    return nextResolve(
      new URL(`${specifier}.ts`, context.parentURL).href,
      context,
    );
  }
  return nextResolve(specifier, context);
}
