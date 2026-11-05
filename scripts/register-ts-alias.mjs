import { checkToolchain } from "./check-toolchain.mjs";
checkToolchain();
import { register } from "node:module";

register("./ts-alias-loader.mjs", import.meta.url);
