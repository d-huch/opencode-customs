import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Page, type Route } from "@playwright/test"
import { installSseTransport } from "../utils/sse-transport"
import { currentSession } from "../utils/mock-server"

const serverA = "http://127.0.0.1:4096"
const serverB = "http://127.0.0.1:4097"
const directoryA = "C:/server-a"
const directoryB = "/home/server-b"
const sessionA = session("ses_server_a", directoryA, "Server A session")
const createdSessionA = session("ses_server_a_created", directoryA, "Created Server A session")
const personalityDraftID = "draft_personality_selection"
const childSessionA = { ...session("ses_server_a_child", directoryA, "Server A child session"), parentID: sessionA.id }
const sessionB = session("ses_server_b", directoryB, "Server B session")

test("session settings use the remote server context", async ({ page }) => {
  const permissionRequests: string[] = []
  await mockServers(page, permissionRequests)
  await configureServers(page)

  await page.goto(`/server/${base64Encode(serverB)}/session/${sessionB.id}`)
  await expect(page.getByText(sessionB.title).first()).toBeVisible()
  await page.keyboard.press("Control+,")

  const dialog = page.locator(".settings-v2-dialog")
  const autoAccept = dialog.locator('[data-action="settings-auto-accept-permissions"]')
  const input = autoAccept.getByRole("switch")
  await expect(autoAccept).toBeVisible()
  await expect(input).toBeEnabled()
  permissionRequests.length = 0
  await autoAccept.locator('[data-slot="switch-control"]').click()
  await expect(input).toBeChecked()
  await expect
    .poll(() =>
      permissionRequests.some((request) => {
        const url = new URL(request)
        return url.origin === serverB && url.searchParams.get("directory") === directoryB
      }),
    )
    .toBe(true)
  expect(permissionRequests.every((request) => new URL(request).origin === serverB)).toBe(true)

  await dialog.getByRole("tab", { name: "Models" }).click()
  await expect(dialog.getByRole("switch", { name: "Server B Model" })).toBeEnabled()
  await expect(dialog.getByRole("switch", { name: "Server A Model" })).toHaveCount(0)
})

test("Research Browser settings stay unavailable for remote servers", async ({ page }) => {
  await mockServers(page, [])
  await configureServers(page)

  await page.goto(`/server/${base64Encode(serverB)}/session/${sessionB.id}`)
  await expect(page.getByText(sessionB.title).first()).toBeVisible()
  await page.keyboard.press("Control+,")

  const dialog = page.locator(".settings-v2-dialog")
  await dialog.getByRole("tab", { name: "Web search" }).click()
  await expect(dialog.getByRole("heading", { name: "Web search" })).toBeVisible()
  await expect(dialog.getByText("Unavailable", { exact: true })).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Open browser" })).toBeDisabled()
  await expect(dialog.getByRole("button", { name: "Clear profile data" })).toBeDisabled()
})

test("personalization is a separate draft-based settings tab", async ({ page }) => {
  await mockServers(page, [])
  await configureServers(
    page,
    [{ type: "draft", draftID: personalityDraftID, server: serverA, directory: directoryA }],
    {
      version: 1,
      defaultPresetID: "saved",
      presets: [personalityPreset("saved", "Saved preset", "Saved assistant")],
    },
  )

  await page.goto("/")
  await page.getByRole("button", { name: "Settings" }).first().click()

  const dialog = page.locator(".settings-v2-dialog")
  await expect(dialog).toBeVisible()
  await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0).toBeGreaterThan(1_100)
  await expect(dialog.locator('[data-action="settings-agent-personalization"]')).toHaveCount(0)
  await dialog.getByRole("tab", { name: "Personalization" }).click()

  const assistantName = dialog.locator('[data-action="settings-personalization-assistant-name"]')
  const cancel = dialog.locator('[data-action="settings-personalization-cancel"]')
  const save = dialog.locator('[data-action="settings-personalization-save"]')
  await expect(assistantName).toHaveValue("Saved assistant")
  await expect(cancel).toBeDisabled()
  await expect(save).toBeDisabled()

  await assistantName.fill("Draft assistant")
  await expect(cancel).toBeEnabled()
  await expect(save).toBeEnabled()
  expect(await storedPersonalization(page)).toMatchObject({
    defaultPresetID: "saved",
    presets: [{ assistantName: "Saved assistant" }],
  })

  await cancel.click()
  await expect(assistantName).toHaveValue("Saved assistant")
  await expect(cancel).toBeDisabled()
  await expect(save).toBeDisabled()

  await assistantName.fill("Closing draft")
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await page.getByRole("button", { name: "Settings" }).first().click()
  await dialog.getByRole("tab", { name: "Personalization" }).click()
  await expect(assistantName).toHaveValue("Saved assistant")

  await assistantName.fill("Jarvis")
  await save.click()
  await expect(save).toBeDisabled()
  await expect
    .poll(() => storedPersonalization(page))
    .toMatchObject({
      defaultPresetID: "saved",
      presets: [{ assistantName: "Jarvis" }],
    })
  await page.keyboard.press("Escape")

  await page.goto(`/new-session?draftId=${personalityDraftID}`)
  const draftPersonality = page.getByTitle("Choose personality")
  await expect(draftPersonality).toContainText("Saved preset")
  await draftPersonality.click()
  await page.getByRole("menuitemradio", { name: "No personality" }).click()
  await expect(draftPersonality).toContainText("No personality")
  await page.locator('[data-component="prompt-input"][contenteditable="true"]').fill("Create a session")
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(new RegExp(`/session/${createdSessionA.id}$`))
  await expect(page.getByTitle("Choose personality")).toContainText("No personality")

  await page.goto(`/server/${base64Encode(serverA)}/session/${sessionA.id}`)
  await expect(page.getByText(sessionA.title).first()).toBeVisible()
  await expect(page.getByTitle("Choose personality")).toBeVisible()
})

for (const locale of [
  {
    id: "en",
    degraded: "The dialogue model is not configured.",
    primary: "Natural · Automatic · silent",
    goals: "Goals",
    inbox: "Jarvis Inbox",
    settings: "Settings",
  },
  {
    id: "uk",
    degraded: "Діалогову модель не налаштовано.",
    primary: "Природний · Автоматично · без голосу",
    goals: "Цілі",
    inbox: "Inbox Jarvis",
    settings: "Налаштування",
  },
] as const) {
  test(`Jarvis settings keep standard spacing and localized runtime state in ${locale.id}`, async ({ page }) => {
    await page.addInitScript((id) => {
      localStorage.setItem("opencode.global.dat:language", JSON.stringify({ locale: id }))
    }, locale.id)
    await mockServers(page, [])
    await configureServers(page, [], {
      version: 2,
      defaultPresetID: "jarvis-primary",
      presets: [personalityPreset("jarvis-primary", "Jarvis", "Jarvis")],
    })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto("/")
    await page.getByRole("button", { name: locale.settings, exact: true }).click()

    const dialog = page.locator(".settings-v2-dialog")
    await dialog.getByRole("tab", { name: "Jarvis", exact: true }).click()
    const header = dialog.locator(".settings-v2-tab-header[data-component='settings-jarvis-v2']")
    const body = dialog.locator(".settings-v2-tab-body.settings-v2-jarvis")
    const sections = body.locator(":scope > .settings-v2-section")
    await expect(header).toBeVisible()
    await expect(body).toBeVisible()
    await expect(dialog).toContainText(locale.degraded)
    await expect(dialog.getByText(locale.primary, { exact: true })).toBeVisible()
    await expect(
      dialog.getByText(
        "Dialogue model is not configured. · Planner model is not configured; multi-step goals will be suspended.",
      ),
    ).toHaveCount(0)

    const wide = await body.evaluate((element) => {
      const style = getComputedStyle(element)
      const children = [...element.querySelectorAll<HTMLElement>(":scope > .settings-v2-section")].filter(
        (child) => child.offsetParent !== null,
      )
      return {
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
        gap: style.rowGap,
        overflow: element.scrollWidth - element.clientWidth,
        sectionGaps: children.slice(1).map((child, index) => {
          const previous = children[index]!.getBoundingClientRect()
          return Math.round(child.getBoundingClientRect().top - previous.bottom)
        }),
      }
    })
    expect(wide).toMatchObject({ paddingLeft: "40px", paddingRight: "40px", gap: "36px", overflow: 0 })
    expect(wide.sectionGaps.every((gap) => gap >= 35)).toBe(true)
    expect(await header.evaluate((element) => getComputedStyle(element).position)).toBe("sticky")

    await dialog.getByRole("tablist", { name: locale.id === "uk" ? "Центр керування Jarvis" : "Jarvis Control Center" })
      .getByRole("tab", { name: locale.goals, exact: true })
      .click()
    await dialog.getByRole("heading", { name: locale.inbox, exact: true }).scrollIntoViewIfNeeded()
    await expect(dialog.getByRole("heading", { name: locale.goals, exact: true })).toHaveCount(1)
    await expect(dialog.getByRole("heading", { name: locale.inbox, exact: true })).toBeVisible()

    await page.setViewportSize({ width: 620, height: 700 })
    await expect
      .poll(() =>
        body.evaluate((element) => ({
          paddingLeft: getComputedStyle(element).paddingLeft,
          paddingRight: getComputedStyle(element).paddingRight,
          overflow: element.scrollWidth - element.clientWidth,
        })),
      )
      .toEqual({ paddingLeft: "20px", paddingRight: "20px", overflow: 0 })

    if (locale.id === "en") {
      await dialog.getByRole("tab", { name: "Companion", exact: true }).click()
      await expect(dialog.getByRole("heading", { name: "Daily Companion", exact: true })).toBeVisible()
      await expect(dialog.getByText("Google account", { exact: true })).toBeVisible()
      await expect(dialog.getByRole("button", { name: "Create briefing", exact: true })).toBeDisabled()

      await dialog.getByRole("tablist", { name: "Jarvis Control Center" }).getByRole("tab", { name: "Models", exact: true }).click()
      await dialog.locator('[data-action="settings-jarvis-model-dialogue"]').click()
      await expect(page.locator('[data-option-key="action:manage"]')).toBeVisible()
      await page.locator('[data-option-key="action:manage"]').click()
      await expect(dialog.locator('[data-slot="tabs-v2-trigger"][data-value="models"]')).toHaveAttribute(
        "aria-selected",
        "true",
      )
      await expect(page.getByText("Local context must be used within a context provider")).toHaveCount(0)
    }
  })
}

test("auto-accept responds for an unfocused server session", async ({ page }) => {
  const permissionRequests: string[] = []
  const permissionResponses: PermissionResponse[] = []
  const transport = await installSseTransport<{ directory: string; payload: Record<string, unknown> }>(page, {
    server: serverA,
    retry: 20,
  })
  await mockServers(page, permissionRequests, permissionResponses)
  await configureServers(page, [
    { type: "session", server: serverA, sessionId: sessionA.id },
    { type: "session", server: serverB, sessionId: sessionB.id },
  ])

  const hrefB = `/server/${base64Encode(serverB)}/session/${sessionB.id}`
  await page.goto(`/server/${base64Encode(serverA)}/session/${sessionA.id}`)
  await expect(page.getByText(sessionA.title).first()).toBeVisible()
  await page.keyboard.press("Control+,")
  const autoAccept = page.locator(".settings-v2-dialog").locator('[data-action="settings-auto-accept-permissions"]')
  await autoAccept.locator('[data-slot="switch-control"]').click()
  await expect(autoAccept.getByRole("switch")).toBeChecked()
  await expect
    .poll(() =>
      permissionRequests.some((request) => {
        const url = new URL(request)
        return url.origin === serverA && url.searchParams.get("directory") === directoryA
      }),
    )
    .toBe(true)
  await page.keyboard.press("Escape")

  await page.locator(`[data-titlebar-tab-slot]:has(a[href="${hrefB}"])`).click()
  await expect(page).toHaveURL(new RegExp(`${hrefB.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`))
  await expect(page.getByText(sessionB.title).first()).toBeVisible()
  await transport.waitForConnection()

  await transport.send({
    directory: directoryA,
    payload: {
      id: "event-permission-background-a",
      type: "permission.asked",
      properties: {
        id: "permission-background-a",
        sessionID: sessionA.id,
        permission: "bash",
        patterns: ["git status"],
        metadata: {},
        always: [],
      },
    },
  })

  await expect
    .poll(() => permissionResponses)
    .toEqual([
      {
        origin: serverA,
        directory: directoryA,
        sessionID: sessionA.id,
        permissionID: "permission-background-a",
        body: { response: "once" },
      },
    ])

  await transport.send({
    directory: directoryA,
    payload: {
      id: "event-permission-background-a-child",
      type: "permission.asked",
      properties: {
        id: "permission-background-a-child",
        sessionID: childSessionA.id,
        permission: "bash",
        patterns: ["git diff"],
        metadata: {},
        always: [],
      },
    },
  })

  await expect
    .poll(() => permissionResponses)
    .toEqual([
      {
        origin: serverA,
        directory: directoryA,
        sessionID: sessionA.id,
        permissionID: "permission-background-a",
        body: { response: "once" },
      },
      {
        origin: serverA,
        directory: directoryA,
        sessionID: childSessionA.id,
        permissionID: "permission-background-a-child",
        body: { response: "once" },
      },
    ])
})

type PermissionResponse = {
  origin: string
  directory?: string
  sessionID: string
  permissionID: string
  body: unknown
}

async function configureServers(
  page: Page,
  tabs: Array<
    | { type: "session"; server: string; sessionId: string }
    | { type: "draft"; draftID: string; server: string; directory: string }
  > = [],
  personalization?: Record<string, unknown>,
) {
  await page.addInitScript(
    ({ serverB, tabs, personalization }) => {
      localStorage.setItem(
        "settings.v3",
        JSON.stringify({ general: { newLayoutDesigns: true }, ...(personalization ? { personalization } : {}) }),
      )
      localStorage.setItem("opencode.global.dat:server", JSON.stringify({ list: [serverB] }))
      localStorage.setItem("opencode.window.browser.dat:tabs", JSON.stringify(tabs))
    },
    { serverB, tabs, personalization },
  )
}

async function storedPersonalization(page: Page) {
  return page.evaluate(() => {
    const value: unknown = JSON.parse(localStorage.getItem("settings.v3") ?? "{}")
    if (!value || typeof value !== "object" || !("personalization" in value)) return {}
    const personalization = value.personalization
    if (!personalization || typeof personalization !== "object") return {}
    return {
      defaultPresetID: "defaultPresetID" in personalization ? personalization.defaultPresetID : undefined,
      presets: "presets" in personalization ? personalization.presets : undefined,
    }
  })
}

function personalityPreset(id: string, name: string, assistantName: string) {
  return {
    id,
    name,
    assistantName,
    userName: "",
    addressAs: "",
    language: "auto",
    archetype: "natural",
    tone: "natural",
    detail: "balanced",
    proactivity: "balanced",
    humor: "subtle",
    catchphrases: "",
    customInstructions: "",
    voice: null,
    createdAt: 1,
    updatedAt: 1,
  }
}

async function mockServers(page: Page, permissionRequests: string[], permissionResponses: PermissionResponse[] = []) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== serverA && url.origin !== serverB) return route.fallback()
    const remote = url.origin === serverB
    const directory = remote ? directoryB : directoryA
    const sessions = remote ? [sessionB] : [sessionA, childSessionA, createdSessionA]
    const requestDirectory = url.searchParams.get("directory")
    const response = url.pathname.match(/^\/session\/([^/]+)\/permissions\/([^/]+)$/)
    if (route.request().method() === "POST" && response) {
      permissionResponses.push({
        origin: url.origin,
        directory: requestDirectory ?? undefined,
        sessionID: response[1]!,
        permissionID: response[2]!,
        body: route.request().postDataJSON(),
      })
      return json(route, true)
    }
    if (requestDirectory && requestDirectory !== directory) return json(route, { name: "InvalidDirectory" }, 500)
    if (url.pathname === "/global/event" || url.pathname === "/event" || url.pathname === "/api/event")
      return sse(route)
    if (url.pathname === "/global/health") return json(route, { healthy: true })
    if (url.pathname === "/session/status") return json(route, {})
    if (url.pathname === "/session" && route.request().method() === "POST") return json(route, createdSessionA)
    if (url.pathname === "/session") return json(route, sessions)
    if (url.pathname === "/api/provider" || url.pathname === "/api/agent")
      return json(route, { data: [] })
    if (url.pathname === "/api/model")
      return json(route, {
        data: [
          {
            id: "qwen-test",
            providerID: "lmstudio",
            name: "Qwen Test",
            family: "qwen",
            capabilities: { input: ["text"], output: ["text"], toolcall: true, temperature: true, attachment: false },
            cost: [{ input: 0, output: 0 }],
            limit: { context: 32_000, output: 4_096 },
          },
        ],
      })
    if (url.pathname === "/api/model/default") return json(route, { data: null })
    if (url.pathname === "/api/jarvis/status") return json(route, jarvisStatus())
    if (url.pathname === "/api/jarvis/control") return json(route, jarvisControlStatus())
    if (url.pathname === "/api/jarvis/goals" || url.pathname === "/api/jarvis/inbox") return json(route, [])
    if (url.pathname === "/api/jarvis/memory/search") return json(route, [])
    if (url.pathname === "/api/jarvis/memory/uses" || url.pathname === "/api/jarvis/replays") return json(route, [])
    if (url.pathname === "/api/jarvis/companion/status") return json(route, companionStatus())
    if (url.pathname === "/api/jarvis/companion/briefings" || url.pathname === "/api/jarvis/companion/actions") return json(route, [])
    if (url.pathname === "/api/jarvis/companion/actions/audit") return json(route, [])
    if (url.pathname === "/api/jarvis/profiles" && route.request().method() === "PUT") return json(route, [])
    if (["/api/command", "/api/reference", "/api/permission/request", "/api/question/request"].includes(url.pathname))
      return json(route, { location: { directory }, data: [] })
    if (url.pathname === "/api/mcp") return json(route, { location: { directory }, data: [] })
    if (url.pathname === "/api/mcp/resource")
      return json(route, { location: { directory }, data: { resources: [], templates: [] } })
    if (url.pathname === "/api/project") {
      return json(route, [
        {
          id: remote ? sessionB.projectID : "project-server-a",
          worktree: directory,
          vcs: "git",
          time: { created: 1, updated: 1 },
          sandboxes: [],
        },
      ])
    }
    if (url.pathname === "/api/project/current")
      return json(route, { id: remote ? sessionB.projectID : "project-server-a", directory })
    if (url.pathname === "/api/session") return json(route, { data: sessions.map(currentSession), cursor: {} })
    if (url.pathname === "/api/session/active") return json(route, { data: {} })
    const currentSessionInfo = sessions.find((session) => url.pathname === `/api/session/${session.id}`)
    if (currentSessionInfo) return json(route, { data: currentSession(currentSessionInfo) })
    if (sessions.some((session) => url.pathname === `/api/session/${session.id}/message`))
      return json(route, { data: [], cursor: {} })
    const current = sessions.find((session) => url.pathname === `/session/${session.id}`)
    if (current) return json(route, current)
    if (/^\/session\/[^/]+$/.test(url.pathname)) return json(route, { name: "NotFoundError" }, 404)
    if (/^\/session\/[^/]+\/message$/.test(url.pathname)) return json(route, [])
    if (/^\/session\/[^/]+\/prompt_async$/.test(url.pathname)) return json(route, true)
    if (/^\/session\/[^/]+\/(children|todo|diff)$/.test(url.pathname)) return json(route, [])
    if (url.pathname === "/permission") {
      permissionRequests.push(url.toString())
      return json(route, [])
    }
    if (["/skill", "/command", "/lsp", "/formatter", "/question", "/vcs/diff", "/pty/shells"].includes(url.pathname))
      return json(route, [])
    if (["/global/config", "/config", "/provider/auth", "/mcp"].includes(url.pathname)) return json(route, {})
    if (url.pathname === "/provider") return json(route, provider(remote ? "server-b" : "server-a"))
    if (url.pathname === "/agent") return json(route, [{ name: "build", mode: "primary" }])
    if (url.pathname === "/project" || url.pathname === "/project/current") {
      const project = {
        id: remote ? sessionB.projectID : "project-server-a",
        worktree: directory,
        vcs: "git",
        time: { created: 1, updated: 1 },
        sandboxes: [],
      }
      return json(route, url.pathname === "/project" ? [project] : project)
    }
    if (url.pathname === "/path")
      return json(route, {
        state: directory,
        config: directory,
        worktree: directory,
        directory,
        home: directory,
      })
    if (url.pathname === "/api/path")
      return json(route, { state: directory, config: directory, worktree: directory, directory, home: directory })
    if (url.pathname === "/vcs") return json(route, { branch: "main", default_branch: "main" })
    if (url.pathname === "/api/vcs")
      return json(route, { location: { directory }, data: { branch: "main", defaultBranch: "main" } })
    if (url.pathname === "/api/pty/shells") return json(route, { location: { directory }, data: [] })
    return json(route, {})
  })
}

function session(id: string, directory: string, title: string) {
  return {
    id,
    slug: id,
    projectID: `project-${id}`,
    directory,
    title,
    version: "dev",
    time: { created: 1, updated: 1 },
  }
}

function provider(id: string) {
  const name = id === "server-b" ? "Server B" : "Server A"
  return {
    all: [
      {
        id,
        name: `${name} Provider`,
        models: {
          [id]: {
            id,
            name: `${name} Model`,
            family: id,
            release_date: "2026-01-01",
            limit: { context: 200_000 },
          },
        },
      },
    ],
    connected: [id],
    default: { providerID: id, modelID: id },
  }
}

function jarvisStatus() {
  return {
    state: "degraded",
    primaryProfile: {
      id: "jarvis-primary",
      revision: 1,
      name: "Jarvis",
      language: "auto",
      archetype: "natural",
      tone: "natural",
      detail: "balanced",
      humor: "subtle",
      proactivity: "balanced",
      instructions: "",
      catchphrases: [],
      primary: true,
      updatedAt: 1,
    },
    config: {
      primaryProfileID: "jarvis-primary",
      models: {},
      plannerTimeoutMs: 8_000,
      plannerIdleUnloadMs: 600_000,
      plannerEscalationMinWords: 18,
      initiative: {
        enabled: true,
        quietStart: "22:00",
        quietEnd: "08:00",
        reflectionLimit: 2,
        eventLimit: 6,
        topicCooldownMinutes: 30,
      },
      updatedAt: 1,
    },
    activeGoals: 0,
    suspendedGoals: 0,
    pendingInbox: 0,
    memoryRecords: 0,
    degradedReasons: [
      "Dialogue model is not configured.",
      "Planner model is not configured; multi-step goals will be suspended.",
    ],
    modelRoles: [
      { role: "dialogue", status: "unconfigured", verified: false },
      { role: "planner", status: "unconfigured", verified: false },
      { role: "embedding", status: "unconfigured", verified: false },
    ],
    planner: { state: "offline", managed: false, activeRequests: 0 },
    embeddings: { state: "blocked", remaining: 0, processed: 0 },
  }
}

function companionStatus() {
  return {
    config: {
      enabled: false,
      schedule: "08:30",
      timezone: "Europe/Kyiv",
      catchUpUntil: "18:00",
      sources: { gmail: true, calendar: true, drive: true, goals: true, promises: true, inbox: true },
      updatedAt: 1,
    },
    google: {
      available: false,
      phase: "unavailable",
      scopes: [],
      writeScopes: [],
      checkedAt: 1,
      error: "Google Companion is available only in the native Desktop app.",
    },
    catchUpAvailable: false,
    bridgeAvailable: false,
    error: "Google Companion is available only in the native Desktop app.",
  }
}

function jarvisControlStatus() {
  return {
    runtime: jarvisStatus(),
    presence: { surface: "desktop", state: "completed", updatedAt: 1 },
    media: { state: "idle", queuedSentences: 0, activeJobs: 0, acknowledgedCancellation: true, updatedAt: 1 },
    replayCount: 0,
    recentMemoryUses: 0,
    recommendations: [],
  }
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(body),
  })
}

function sse(route: Route) {
  return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": ok\n\n" })
}
