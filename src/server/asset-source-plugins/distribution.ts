import type {
  InstalledPluginStatus,
  PluginManagementStatus,
} from "@/domain/plugin-management";
import officialCatalog from "../../../plugins/official.json" with { type: "json" };
import { bundledPluginPackages } from "./registry";
import { OFFICIAL_PLUGIN_REPOSITORY, officialPluginRepositoryUrl } from "./official";

/** Read-only status for integrations shipped with this application build. */
export class PluginDistribution {
  readonly repository = OFFICIAL_PLUGIN_REPOSITORY;

  constructor(readonly root: string) {}

  private entries(): InstalledPluginStatus[] {
    const packages = new Map<string, ReturnType<typeof bundledPluginPackages>[number]>(
      bundledPluginPackages(this.root).map(pkg => [pkg.manifest.id, pkg]),
    );
    return officialCatalog.plugins.map(listed => {
      const bundled = packages.get(listed.id);
      if (!bundled) {
        return {
          id: listed.id,
          label: listed.label,
          summary: listed.summary,
          publisher: listed.publisher,
          homepage: listed.homepage,
          repository: OFFICIAL_PLUGIN_REPOSITORY,
          version: "未构建",
          assetSource: listed.assetSource,
          enabled: false,
          healthy: false,
          retainedVersions: [],
        };
      }
      const { manifest, available } = bundled;
      const healthy = available() && manifest.capabilities.includes("assets.read") === listed.assetSource;
      return {
        id: manifest.id,
        label: listed.label,
        version: manifest.version,
        summary: listed.summary,
        publisher: listed.publisher,
        homepage: listed.homepage ?? officialPluginRepositoryUrl(),
        repository: OFFICIAL_PLUGIN_REPOSITORY,
        assetSource: listed.assetSource,
        enabled: healthy,
        healthy,
        retainedVersions: [],
      };
    });
  }

  status(): PluginManagementStatus {
    return {
      repository: this.repository,
      installed: this.entries(),
    };
  }
}
