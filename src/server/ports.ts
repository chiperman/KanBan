/**
 * 系统边界端口的稳定入口。
 *
 * 子领域接口分别位于 ports/ 下；适配器和调用方继续从此处导入，
 * 以保持组合根与测试替身的 seam 不变。
 */
export * from "./ports/core";
export * from "./ports/cards";
export * from "./ports/assets";
export * from "./ports/sources";
export * from "./ports/source-details";
export * from "./ports/source-sync-state";
export * from "./ports/synchronization";
export * from "./ports/history";
export * from "./ports/settlement";
export * from "./ports/market-data";
export * from "./ports/investment";
export * from "./ports/auth";
export * from "./ports/secrets";
