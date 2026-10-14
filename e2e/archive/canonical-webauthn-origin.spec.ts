import { expect, test } from "@playwright/test";

import { TEST_SERVER_PORT } from "../../playwright.config";

test("127.0.0.1 的 Passkey 页面重定向到同端口的 localhost", async () => {
  for (const pathname of ["/", "/setup"]) {
    const response = await fetch(
      `http://127.0.0.1:${TEST_SERVER_PORT}${pathname}?source=passkey`,
      {
        redirect: "manual",
      },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `http://localhost:${TEST_SERVER_PORT}${pathname}?source=passkey`,
    );
  }
});
