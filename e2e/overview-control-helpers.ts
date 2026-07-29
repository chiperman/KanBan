import type { Locator, Page } from "@playwright/test";

export async function chooseOverviewOption(
  root: Locator | Page,
  label: string,
  option: string,
): Promise<void> {
  await root.getByRole("button", { name: label }).click();
  await root.getByRole("option", { name: option, exact: true }).click();
}
