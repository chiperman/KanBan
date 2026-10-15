import { expect, test } from "@playwright/test"

import { loginAsOwner } from "../owner-auth-helpers"

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset")
  const seeded = await request.post("/test-doubles/release-acceptance", {
    data: { action: "seed" },
  })
  expect(seeded.ok()).toBeTruthy()
})

test("盈亏颜色设置首屏不会先显示错误的默认选项", async ({ browser, page }) => {
  await loginAsOwner(page)
  await page.evaluate(() => {
    window.localStorage.setItem("profit-color-scheme", "green-up")
    document.cookie = "profit-color-scheme=; Path=/; Max-Age=0"
  })

  const storageState = await page.context().storageState()
  const noScriptContext = await browser.newContext({
    javaScriptEnabled: false,
    storageState,
  })
  const noScriptPage = await noScriptContext.newPage()
  await noScriptPage.goto("/settings")
  const pendingSettings = noScriptPage.locator(".settings-choice-group")
  await expect(pendingSettings).toHaveAttribute("data-ready", "false")
  await expect(pendingSettings).toHaveCSS("visibility", "hidden")
  await noScriptContext.close()

  await page.goto("/settings")
  const settings = page.getByRole("group", { name: "盈亏颜色" })
  await expect(settings).toHaveAttribute("data-ready", "true")
  await expect(page.getByRole("radio", { name: /绿涨红跌/ })).toBeChecked()
  await expect
    .poll(async () => {
      const cookies = await page.context().cookies()
      return cookies.find(({ name }) => name === "profit-color-scheme")?.value
    })
    .toBe("green-up")
})

test("总览指标、来源状态与工作台操作遵守 Vibe 视觉层级", async ({ page }) => {
  await loginAsOwner(page)
  await expect(page.getByTestId("overview-current-total")).toContainText("142,548.00 USD")
  await expect(page.getByTestId("overview-confidence")).toContainText("总额完整")
  await expect(page.getByTestId("overview-source-summary")).toBeVisible()
  await expect(page.locator(".daily-overview__source-list > li")).toHaveCount(6)
  await expect(page.getByRole("button", { name: "配置 TOTP 登录" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "添加资产来源" })).toHaveCount(0)
  for (const action of [
    page.getByRole("button", { name: "打开快捷命令" }),
    page.getByRole("button", { name: "立即锁定（退出登录）" }),
    page.getByRole("button", { name: /^当前主题：/ }),
  ]) {
    await expect(action).toHaveAttribute("type", "button")
    const box = await action.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(40)
    expect(box!.width).toBeGreaterThanOrEqual(40)
    await expect(action.locator("svg.vibe-icon")).toHaveAttribute("aria-hidden", "true")
  }
  await expect(page.getByRole("button", { name: "打开快捷命令" })).toHaveAttribute("data-vibe-component", "button")
  await expect(page.getByRole("button", { name: "立即锁定（退出登录）" })).toHaveAttribute("data-vibe-component", "button")
  await expect(page.getByRole("link", { name: "设置与安全", exact: true })).toHaveAttribute("href", "/settings")
  const currency = page.getByRole("button", { name: "计价货币" })
  await expect(currency).toHaveAttribute("aria-haspopup", "listbox")
  await currency.click()
  await expect(page.getByRole("option", { name: "USD", exact: true })).toHaveAttribute("aria-selected", "true")
  await page.getByRole("option", { name: "CNY", exact: true }).click()
  await expect(page.getByTestId("overview-current-total")).toContainText("1,026,345.60 CNY")
  await page.getByRole("link", { name: "查看 长桥账户 的资产明细" }).click()
  const sourceState = page.getByTestId("longbridge-card").locator(".source-live-state")
  await expect(sourceState).toHaveText("LB / CURRENT")
  await expect(sourceState).toHaveAttribute("data-vibe-tone", "success")
})

test("中等宽度操作保持横排，手机端操作区不溢出", async ({ page }) => {
  await page.setViewportSize({ width: 848, height: 1036 })
  await loginAsOwner(page)

  const header = page.getByTestId("workbench-page-header")
  async function layout() {
    return header.evaluate(element => {
      const actions = Array.from(element.querySelectorAll(".workbench-page-header__actions button"))
        .map(action => action.getBoundingClientRect())
      return actions.map(({ left, right, top }) => ({ left, right, top }))
    })
  }
  const medium = await layout()
  expect(medium.length).toBeGreaterThanOrEqual(2)
  expect(Math.abs(medium[0].top - medium[1].top)).toBeLessThanOrEqual(1)
  await page.setViewportSize({ width: 390, height: 844 })
  const mobile = await layout()
  for (const action of mobile) {
    expect(action.left).toBeGreaterThanOrEqual(0)
    expect(action.right).toBeLessThanOrEqual(390)
  }
})

test("空状态说明在 Light 和 Dark 下保持正文级对比度", async ({ page, request }) => {
  await request.post("/test-doubles/reset")
  await page.emulateMedia({ colorScheme: "light" })
  await loginAsOwner(page)
  await page.evaluate(() => localStorage.setItem("pad-theme", "system"))

  async function contrastRatio() {
    return page.getByTestId("overview-source-summary").locator(".empty-title").evaluate((element) => {
      function luminance(color: string) {
        const channels = color.match(/\d+/g)?.slice(0, 3).map(Number) ?? []
        const [red, green, blue] = channels.map((channel) => {
          const value = channel / 255
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue
      }
      const foreground = luminance(getComputedStyle(element).color)
      const background = luminance(getComputedStyle(document.body).backgroundColor)
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
    })
  }

  await page.reload()
  expect(await contrastRatio()).toBeGreaterThanOrEqual(4.5)
  await page.emulateMedia({ colorScheme: "dark" })
  await page.reload()
  expect(await contrastRatio()).toBeGreaterThanOrEqual(4.5)
})
