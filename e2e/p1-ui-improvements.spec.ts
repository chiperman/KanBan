import { expect, test, type Page } from "@playwright/test"

async function loginAsOwner(page: Page): Promise<void> {
  const client = await page.context().newCDPSession(page)
  await client.send("WebAuthn.enable")
  await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  })
  await page.goto("/setup")
  await page.getByRole("button", { name: "创建所有者 Passkey" }).click()
  await expect(page.getByRole("status")).toContainText("已完成预置")
  await page.goto("/")
  await page.getByRole("button", { name: "使用 Passkey 登录" }).click()
  await expect(page.getByTestId("view-mode")).toContainText("所有者视图")
}

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

test("看板时间、来源状态和普通卡片遵守 Vibe 视觉层级", async ({ page }) => {
  await loginAsOwner(page)

  await expect(page.getByText("EXTERNAL ACCESS / READ ONLY")).toHaveCount(0)
  await expect(page.getByTestId("local-time")).toBeVisible()
  await expect(page.getByTestId("local-time")).not.toContainText("LOCAL")
  await expect(page.getByTestId("local-time")).toHaveCSS("font-size", "12px")
  await expect(page.getByTestId("asset-refresh-status")).toHaveAttribute(
    "data-vibe-tone",
    "success"
  )

  const commandAction = page.getByRole("button", { name: "打开快捷命令" })
  const lockAction = page.getByRole("button", {
    name: "立即锁定（退出登录）",
  })
  for (const action of [commandAction, lockAction]) {
    await expect(action).toHaveAttribute("data-vibe-component", "button")
    await expect(action).toHaveAttribute("data-vibe-variant", "outline")
    await expect(action).toHaveCSS("height", "44px")
    await expect(action).toHaveCSS("border-radius", "6px")
    await expect(action).toHaveCSS("font-size", "11px")
  }
  await expect(lockAction).toHaveCSS("width", "44px")
  const lockIcon = lockAction.locator('[data-vibe-dot="lock"]')
  await expect(lockIcon).toHaveCount(1)
  await expect(lockIcon).toHaveCSS("width", "24px")
  await expect(lockIcon.locator("> .is-lit")).toHaveCount(57)
  await expect(lockAction).toHaveText("")
  const settingsLink = page.getByRole("link", { name: "本机设置" })
  await expect(settingsLink).toHaveAttribute("data-vibe-component", "link")
  await expect(settingsLink).toHaveAttribute("data-vibe-variant", "outline")
  await expect(settingsLink).toHaveCSS("height", "44px")
  await expect(settingsLink).toHaveCSS("width", "44px")
  await expect(settingsLink).toHaveCSS("border-radius", "6px")
  await expect(settingsLink).toHaveCSS("font-size", "11px")
  await expect(settingsLink).toHaveCSS("text-decoration-line", "none")
  const settingsIcon = settingsLink.locator('[data-vibe-dot="gear"]')
  await expect(settingsIcon).toHaveCount(1)
  await expect(settingsIcon).toHaveCSS("width", "24px")
  await expect(settingsIcon.locator("> .is-lit")).toHaveCount(48)
  await expect(settingsLink).toHaveText("")
  const utilityChildren = page.locator(".header-utility-actions").locator(":scope > *")
  await expect(utilityChildren.nth(0)).toHaveClass(/command-menu-trigger/)
  await expect(utilityChildren.nth(1).locator("a")).toHaveAttribute("aria-label", "本机设置")
  await expect(page.getByRole("button", { name: "配置备用登录" })).toHaveCount(0)

  const themeToggle = page.getByRole("button", { name: /^当前主题：/ })
  await expect(themeToggle).toHaveCSS("width", "44px")
  await expect(themeToggle).toHaveCSS("height", "44px")
  await expect(themeToggle).toHaveCSS("border-radius", "6px")
  const systemThemeIcon = themeToggle.locator('[data-vibe-dot="computer"]')
  await expect(systemThemeIcon).toHaveCount(1)
  await expect(systemThemeIcon.locator("> .is-lit")).toHaveCount(30)

  const settingsTooltip = page.getByRole("tooltip", {
    name: "设置",
  })
  await expect(settingsTooltip).toBeHidden()
  await settingsLink.hover()
  await expect(settingsTooltip).toBeVisible()

  const lockTooltip = page.getByRole("tooltip", {
    name: "立即锁定敏感内容",
  })
  await lockAction.focus()
  await expect(lockTooltip).toBeVisible()

  await themeToggle.hover()
  await expect(
    page.getByRole("tooltip", {
      name: /当前：跟随系统；点击切换为浅色/,
    })
  ).toBeVisible()

  const overviewCard = page.getByTestId("total-overview-card")
  const overviewSpacing = await overviewCard.evaluate((element) => {
    const computed = getComputedStyle(element)
    return {
      padding: [
        computed.paddingTop,
        computed.paddingRight,
        computed.paddingBottom,
        computed.paddingLeft,
      ],
      labelBorders: [
        getComputedStyle(element, "::before").borderTopWidth,
        getComputedStyle(element, "::before").borderRightWidth,
        getComputedStyle(element, "::before").borderBottomWidth,
        getComputedStyle(element, "::before").borderLeftWidth,
      ],
      labelContent: getComputedStyle(element, "::before").content,
      labelLeft: getComputedStyle(element, "::before").left,
      fieldRight: getComputedStyle(element, "::after").right,
    }
  })
  expect(overviewSpacing).toEqual({
    padding: ["48px", "24px", "32px", "24px"],
    labelBorders: ["0px", "0px", "0px", "0px"],
    labelContent: '"01 / NET ASSET // CONSOLIDATED VIEW"',
    labelLeft: "40px",
    fieldRight: "24px",
  })
  await expect(overviewCard.locator(".card-corner-mark")).toHaveCount(2)
  await expect(
    overviewCard.locator(".card-corner-mark-top-right, .card-corner-mark-bottom-right")
  ).toHaveCount(0)
  const overviewCornerStyles = await overviewCard
    .locator(".card-corner-marks")
    .evaluate((element) => {
      const topLeft = getComputedStyle(element.querySelector(".card-corner-mark-top-left")!)
      const bottomLeft = getComputedStyle(element.querySelector(".card-corner-mark-bottom-left")!)
      const topRight = getComputedStyle(element, "::before")
      const bottomRight = getComputedStyle(element, "::after")
      const borderWidths = (style: CSSStyleDeclaration) => [
        style.borderTopWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
        style.borderLeftWidth,
      ]

      return {
        topLeft: borderWidths(topLeft),
        topRight: {
          content: topRight.content,
          borders: borderWidths(topRight),
        },
        bottomRight: {
          content: bottomRight.content,
          borders: borderWidths(bottomRight),
        },
        bottomLeft: borderWidths(bottomLeft),
      }
    })
  expect(overviewCornerStyles).toEqual({
    topLeft: ["1px", "0px", "0px", "1px"],
    topRight: {
      content: '""',
      borders: ["1px", "1px", "0px", "0px"],
    },
    bottomRight: {
      content: '""',
      borders: ["0px", "1px", "1px", "0px"],
    },
    bottomLeft: ["0px", "0px", "1px", "1px"],
  })

  const overviewBox = await overviewCard.boundingBox()
  const totalStatusBox = await overviewCard.locator(".total-status").boundingBox()
  expect(overviewBox).not.toBeNull()
  expect(totalStatusBox).not.toBeNull()
  expect(
    Math.abs(
      overviewBox!.x +
        overviewBox!.width -
        Number.parseFloat(overviewSpacing.padding[1]) -
        (totalStatusBox!.x + totalStatusBox!.width)
    )
  ).toBeLessThanOrEqual(1)

  const sourceCard = page.getByTestId("longbridge-card")
  await expect(sourceCard.locator(".source-live-state")).toHaveCSS("font-size", "10px")
  await expect(sourceCard.locator(".source-live-state")).toHaveAttribute(
    "data-vibe-component",
    "status-tag"
  )
  await expect(sourceCard.locator(".source-live-state")).toHaveAttribute(
    "data-vibe-tone",
    "success"
  )
  await expect(sourceCard.locator(".source-live-state")).toHaveText("LB / CURRENT")
  const cardDecoration = await sourceCard.evaluate((element) => {
    const decoration = getComputedStyle(element, "::after")
    return {
      backgroundImage: decoration.backgroundImage,
      content: decoration.content,
    }
  })
  expect(cardDecoration.content).not.toBe("none")
  expect(cardDecoration.backgroundImage).toContain("radial-gradient")
  await expect(sourceCard.locator(".source-meter-caption")).toHaveCSS("font-size", "12px")

  const cardBorders = await sourceCard.locator("..").evaluate((element) => {
    const computed = getComputedStyle(element)
    return {
      top: computed.borderTopWidth,
      right: computed.borderRightWidth,
    }
  })
  expect(cardBorders).toEqual({ top: "0px", right: "0px" })
  const sourceCardShell = sourceCard.locator("..")
  await expect(sourceCardShell.locator(".card-corner-mark")).toHaveCount(2)
  await expect(
    sourceCardShell.locator(".card-corner-mark-top-right, .card-corner-mark-bottom-right")
  ).toHaveCount(0)
  await expect(sourceCard.locator("..")).toHaveAttribute("data-vibe-surface", "data-card")
  const binanceCardShell = page.getByTestId("binance-card").locator("..")
  const [sourceCardBox, binanceCardBox] = await Promise.all([
    sourceCardShell.boundingBox(),
    binanceCardShell.boundingBox(),
  ])
  expect(sourceCardBox).not.toBeNull()
  expect(binanceCardBox).not.toBeNull()
  expect(Math.abs(sourceCardBox!.y - binanceCardBox!.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(sourceCardBox!.height - binanceCardBox!.height)).toBeLessThanOrEqual(1)

  const resizeHandle = sourceCard.locator("..").getByRole("button", { name: /调整.*宽度/ })
  await expect(resizeHandle).toHaveCSS("border-radius", "6px")
  await resizeHandle.hover()
  expect(
    await resizeHandle.evaluate((element) => {
      const before = getComputedStyle(element, "::before")
      const after = getComputedStyle(element, "::after")
      return {
        beforeBackground: before.backgroundColor,
        afterBackground: after.backgroundColor,
      }
    })
  ).toEqual({
    beforeBackground: "rgba(0, 0, 0, 0)",
    afterBackground: "rgba(0, 0, 0, 0)",
  })

  const dragHandle = sourceCardShell.getByRole("button", {
    name: /拖动.*调整排序/,
  })
  await dragHandle.hover()
  const dragLines = await dragHandle.evaluate((element) => {
    const handle = getComputedStyle(element, "::before")
    const displayProbe = document.createElement("span")
    displayProbe.style.color = "var(--display)"
    document.body.append(displayProbe)
    const display = getComputedStyle(displayProbe).color
    displayProbe.remove()
    return {
      background: handle.backgroundColor,
      display,
      shadows: handle.boxShadow,
    }
  })
  expect(dragLines.background).toBe(dragLines.display)
  expect(dragLines.shadows).toContain(dragLines.display)
  expect(dragLines.shadows).toContain("0px 4px")
  expect(dragLines.shadows).toContain("0px 8px")

  const currencyTrigger = page.getByRole("button", { name: "计价货币" })
  await expect(currencyTrigger).toHaveClass(/vibe-select__trigger/)
  await expect(currencyTrigger).toHaveCSS("height", "44px")
  await currencyTrigger.click()
  const currencyMenu = page.getByRole("listbox", { name: "计价货币" })
  await expect(currencyMenu.locator("..")).toHaveAttribute("data-vibe-variant", "compact")
  await expect(currencyMenu).toHaveCSS("box-shadow", "none")
  const selectedCurrency = currencyMenu.getByRole("option", { name: "USD" })
  await expect(selectedCurrency).toHaveCSS("border-radius", "6px")
  await expect(selectedCurrency.locator(".vibe-select__selected-mark")).toHaveCSS("width", "6px")
})

test("中等宽度控制区保持横排，手机端才改为纵向堆叠", async ({ page }) => {
  await page.setViewportSize({ width: 848, height: 1036 })
  await loginAsOwner(page)

  const controlDeck = page.locator(".dashboard-control-deck")
  const mediumLayout = await controlDeck.evaluate((element) => {
    const toolbar = element.querySelector(".owner-toolbar")?.getBoundingClientRect()
    const refresh = element.querySelector(".asset-refresh-controls")?.getBoundingClientRect()
    const deck = element.getBoundingClientRect()
    return toolbar && refresh
      ? {
          deckHeight: deck.height,
          refreshLeft: refresh.left,
          refreshTop: refresh.top,
          toolbarLeft: toolbar.left,
          toolbarTop: toolbar.top,
        }
      : null
  })
  expect(mediumLayout).not.toBeNull()
  expect(Math.abs(mediumLayout!.toolbarTop - mediumLayout!.refreshTop)).toBeLessThanOrEqual(1)
  expect(mediumLayout!.refreshLeft).toBeGreaterThan(mediumLayout!.toolbarLeft)
  expect(mediumLayout!.deckHeight).toBeLessThanOrEqual(110)

  await page.setViewportSize({ width: 390, height: 844 })
  const mobileLayout = await controlDeck.evaluate((element) => {
    const toolbar = element.querySelector(".owner-toolbar")?.getBoundingClientRect()
    const refresh = element.querySelector(".asset-refresh-controls")?.getBoundingClientRect()
    return toolbar && refresh
      ? {
          refreshTop: refresh.top,
          toolbarBottom: toolbar.bottom,
        }
      : null
  })
  expect(mobileLayout).not.toBeNull()
  expect(mobileLayout!.refreshTop).toBeGreaterThan(mobileLayout!.toolbarBottom)
})

test("空状态说明在 Light 和 Dark 下保持正文级对比度", async ({ page, request }) => {
  await request.post("/test-doubles/reset")
  await page.emulateMedia({ colorScheme: "light" })
  await loginAsOwner(page)
  await page.evaluate(() => localStorage.setItem("pad-theme", "system"))

  async function contrastRatio() {
    return page.locator(".empty-hint").evaluate((element) => {
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
