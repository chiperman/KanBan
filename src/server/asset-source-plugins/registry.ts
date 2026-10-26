import path from "node:path";
import { isPersistedAssetSourceKind } from "@/domain/asset-source-kinds";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { assertPluginManifest, type InstalledPluginManifest } from "./manifest";

export interface PluginRegistration { version: string; enabled: boolean; release?: string; repository?: string; source?: 'github'; revision?: string }
export type PluginRegistry = Record<string, PluginRegistration>;
export const pluginDirectoryName = (id: string) => encodeURIComponent(id);
export function pluginRoot(dataDir: string): string { return path.join(dataDir, "source-plugins"); }

export function readPluginRegistry(root: string): PluginRegistry {
  const file = path.join(root, "registry.json");
  if (!existsSync(file)) return {};
  const value: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("插件注册表无效");
  for (const [id, entry] of Object.entries(value)) {
    const e = entry as PluginRegistration;
    if ((!isPersistedAssetSourceKind(id) || id === "manual") || id.length > 128 || !e ||
        typeof e.enabled !== "boolean" || typeof e.version !== "string" || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(e.version) ||
        (e.repository !== undefined && (typeof e.repository !== 'string' || e.repository.length > 200 || !/^[a-zA-Z0-9][\w.-]*\/[a-zA-Z0-9][\w.-]*$/.test(e.repository))) ||
        (e.source !== undefined && (e.source !== 'github' || !e.repository))) throw new Error("插件注册表无效");
  }
  return value as PluginRegistry;
}

export function readInstalledManifest(directory: string): InstalledPluginManifest {
  const manifest: unknown = JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8"));
  assertPluginManifest(manifest);
  const base = realpathSync(directory) + path.sep;
  if (!realpathSync(path.join(directory, manifest.entry)).startsWith(base)) throw new Error("插件入口越出安装目录");
  return manifest;
}

export function installedPluginPackages(root: string) {
  let registry: PluginRegistry;
  try { registry = readPluginRegistry(root); } catch { return []; }
  return Object.entries(registry).flatMap(([id, registration]) => {
    try {
      const directory = path.join(root, pluginDirectoryName(id), registration.version);
      const manifest = readInstalledManifest(directory);
      if (manifest.id !== id || manifest.version !== registration.version) return [];
      return [{ directory, manifest, available: () => {
        try {
          const current = readPluginRegistry(root)[id];
          return current?.enabled === true && current.version === manifest.version && current.revision === registration.revision && existsSync(path.join(directory, manifest.entry));
        } catch { return false; }
      } }];
    } catch { return []; }
  });
}

/** Each process observes atomic registry changes without rebuilding database/auth/onboarding state. */
export function pluginPackageLoader(root: string): () => ReturnType<typeof installedPluginPackages> {
  let fingerprint: string | undefined, packages: ReturnType<typeof installedPluginPackages> = [];
  return () => {
    let next: string;
    try { next = readFileSync(path.join(root, 'registry.json'), 'utf8'); } catch { next = ''; }
    if (fingerprint !== next) {
      const previous = new Map(packages.map(p => [p.manifest.id, p]));
      const oldRegistry = fingerprint ? JSON.parse(fingerprint) as PluginRegistry : {};
      let newRegistry: PluginRegistry = {}; try { newRegistry = JSON.parse(next || '{}'); } catch { /* Invalid registry disables all. */ }
      packages = installedPluginPackages(root).map(p => {
        const old = previous.get(p.manifest.id);
        return old && JSON.stringify(oldRegistry[p.manifest.id]) === JSON.stringify(newRegistry[p.manifest.id]) ? old : p;
      });
      // A malformed registry must not prevent recovery after a corrected file is published.
      fingerprint = JSON.stringify(newRegistry);
      if (next) { try { JSON.parse(next); fingerprint = next; } catch { fingerprint = undefined; } }
    }
    return packages;
  };
}
