import { clearAllSessions } from "@/server/auth/session";
import { configureTestServices, getServices } from "@/server/composition";
import { createTestServices, type TestServices } from "./fakes";

export function initializeTestServices(): void {
  configureTestServices(createTestServices);
}

export function getTestServices(): TestServices {
  initializeTestServices();
  return getServices() as TestServices;
}

/** 重建全部测试替身，并清空会话。 */
export function resetTestServices(): void {
  configureTestServices(createTestServices, true);
  clearAllSessions();
}
