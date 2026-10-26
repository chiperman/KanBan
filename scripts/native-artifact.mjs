export { sourceFingerprint, writeArtifactManifest, checkNativeArtifact } from "../plugins/longbridge/native-artifact.mjs";
import { checkNativeArtifact } from "../plugins/longbridge/native-artifact.mjs";
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) checkNativeArtifact();
