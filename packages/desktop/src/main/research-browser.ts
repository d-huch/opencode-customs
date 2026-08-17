import { randomBytes } from "node:crypto"
import { lookup } from "node:dns/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { isIP } from "node:net"
import { Readability } from "@mozilla/readability"
import { parseHTML } from "linkedom"
import { app, BrowserWindow, session, type Session } from "electron"
import type { ResearchBrowserStatus } from "../preload/types"
import { getStore } from "./store"
import { nativeT } from "./native-translations"
import { searchExtractionScript, type ResearchEngine, type SearchResult } from "./research-browser-dom"
import { blockedResearchHostname, privateResearchAddress, safeResearchProtocol } from "./research-browser-security"

type Engine = ResearchEngine
type Visibility = "background" | "always" | "hidden"
type TimeRange = "day" | "week" | "month" | "year"

type Settings = {
  enabled: boolean
  engine: Engine
  visibility: Visibility
  authenticatedPages: boolean
  privateNetwork: boolean
  externalFallback: boolean
}

type SearchInput = {
  queries: string[]
  depth: "quick" | "deep"
  language?: string
  timeRange?: TimeRange
  maxResults: number
}

type ReadInput = { url: string; allowAuthenticated: boolean }

const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  engine: "duckduckgo",
  visibility: "background",
  authenticatedPages: true,
  privateNetwork: false,
  externalFallback: false,
}

const MAX_REQUEST_BYTES = 64 * 1024
const MAX_RENDERED_HTML = 5 * 1024 * 1024
const MAX_RENDERED_TEXT = 250_000
const SEARCH_TIMEOUT = 20_000
const CHALLENGE_TIMEOUT = 120_000
const PARTITION = "persist:opencode-research"

export type ResearchBrowserController = Awaited<ReturnType<typeof startResearchBrowser>>

export async function startResearchBrowser() {
  const token = randomBytes(32).toString("base64url")
  const state: ResearchBrowserStatus = {
    available: true,
    phase: "idle",
    engine: DEFAULT_SETTINGS.engine,
    visible: false,
  }
  const browserSession = session.fromPartition(PARTITION, { cache: true })
  let window: BrowserWindow | undefined
  let queue = Promise.resolve<unknown>(undefined)
  const readQueues = [
    Promise.resolve<unknown>(undefined),
    Promise.resolve<unknown>(undefined),
    Promise.resolve<unknown>(undefined),
  ]
  const readIndex = { current: 0 }

  browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  browserSession.setPermissionCheckHandler(() => false)
  browserSession.on("will-download", (event) => event.preventDefault())
  browserSession.webRequest.onBeforeRequest((details, callback) => {
    void assertSafeURL(details.url, settings().privateNetwork).then(
      () => callback({ cancel: false }),
      () => callback({ cancel: true }),
    )
  })

  const ensureWindow = () => {
    if (window && !window.isDestroyed()) return window
    window = new BrowserWindow({
      width: 1100,
      height: 760,
      show: false,
      autoHideMenuBar: true,
      title: nativeT("desktop.researchBrowser.title"),
      backgroundColor: "#111111",
      webPreferences: {
        session: browserSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        navigateOnDragDrop: false,
        autoplayPolicy: "document-user-activation-required",
      },
    })
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    window.webContents.on("will-navigate", (event, url) => {
      if (safeResearchProtocol(url)) return
      event.preventDefault()
    })
    window.webContents.on("will-redirect", (event, url) => {
      if (safeResearchProtocol(url)) return
      event.preventDefault()
    })
    window.on("show", () => {
      state.visible = true
    })
    window.on("hide", () => {
      state.visible = false
    })
    window.on("closed", () => {
      window = undefined
      state.visible = false
      state.phase = "idle"
    })
    return window
  }

  const show = async () => {
    const win = ensureWindow()
    if (!win.webContents.getURL()) await win.loadURL(searchURL(settings().engine, "", undefined, undefined))
    win.show()
    win.focus()
  }

  const run = <T>(task: () => Promise<T>) => {
    const next = queue.then(task, task)
    queue = next.catch(() => undefined)
    return next
  }

  const runRead = <T>(task: () => Promise<T>) => {
    const index = readIndex.current++ % readQueues.length
    const next = readQueues[index]!.then(task, task)
    readQueues[index] = next.catch(() => undefined)
    return next
  }

  const search = (input: SearchInput) =>
    run(async () => {
      const config = settings()
      state.engine = config.engine
      if (!config.enabled)
        return response("disabled", config, { results: [], message: "Local Research Browser is disabled" })
      const queries = input.queries
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, input.depth === "deep" ? 4 : 1)
      if (!queries.length) return response("failed", config, { results: [], message: "Search query is empty" })
      state.phase = "searching"
      state.message = undefined
      const results: SearchResult[] = []
      const deadline = Date.now() + (input.depth === "deep" ? 90_000 : 35_000)
      try {
        for (const query of queries) {
          const remaining = deadline - Date.now()
          if (remaining <= 0) break
          state.query = query
          const win = ensureWindow()
          if (config.visibility === "always") win.show()
          await win.loadURL(searchURL(config.engine, query, input.language, input.timeRange))
          const found = await waitForSearchResults(win, config.engine, Math.min(SEARCH_TIMEOUT, remaining))
          if (found.challenge) {
            state.phase = "waiting_user"
            state.message = "Search engine requires user attention"
            win.show()
            win.focus()
            const resumed = await waitForSearchResults(win, config.engine, CHALLENGE_TIMEOUT)
            if (resumed.challenge || !resumed.results.length) {
              state.phase = "requires_user"
              return response("requires_user", config, {
                results,
                message: "Complete the browser challenge and retry the search",
              })
            }
            results.push(...resumed.results)
          } else {
            results.push(...found.results)
          }
          if (results.length >= Math.max(1, Math.min(input.maxResults, 20))) break
        }
        state.phase = "idle"
        state.resultCount = results.length
        return response("ready", config, {
          results: results.slice(0, Math.max(1, Math.min(input.maxResults, 20))),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        state.phase = "failed"
        state.message = message
        return response("failed", config, { results, message })
      }
    })

  const read = (input: ReadInput) =>
    runRead(async () => {
      const config = settings()
      if (!config.enabled)
        return response("disabled", config, {
          url: input.url,
          finalURL: input.url,
          title: "",
          text: "",
          fetchMode: "browser" as const,
          message: "Local Research Browser is disabled",
        })
      try {
        await assertSafeURL(input.url, config.privateNetwork)
        state.phase = "reading"
        state.domain = new URL(input.url).hostname
        const direct = await readHTTP(browserSession, input, config)
        if (direct) {
          state.phase = "idle"
          state.domain = new URL(direct.finalURL).hostname
          state.message = undefined
          return response("ready", config, direct)
        }
        if (!input.allowAuthenticated || !config.authenticatedPages)
          throw new Error("Rendered fallback is disabled while signed-in page access is off")
        return await run(async () => {
          const win = ensureWindow()
          state.phase = "reading"
          state.domain = new URL(input.url).hostname
          if (config.visibility === "always") win.show()
          await win.loadURL(input.url)
          await waitForReady(win, SEARCH_TIMEOUT)
          const login = (await win.webContents.executeJavaScript(
            `Boolean(document.querySelector('input[type="password"]')) && (document.body?.innerText?.length ?? 0) < 8000`,
            true,
          )) as boolean
          if (login && input.allowAuthenticated && config.authenticatedPages) {
            state.phase = "waiting_user"
            state.message = "Sign in to continue reading"
            win.show()
            win.focus()
            const signedIn = await waitForLogin(win, CHALLENGE_TIMEOUT)
            if (!signedIn) {
              state.phase = "requires_user"
              return response("requires_user", config, {
                url: input.url,
                finalURL: win.webContents.getURL() || input.url,
                title: win.webContents.getTitle(),
                text: "",
                fetchMode: "browser" as const,
                message: "Sign in in the Research Browser and retry",
              })
            }
          }
          const rendered = (await win.webContents.executeJavaScript(
            `(() => ({
              html: (document.documentElement?.outerHTML ?? '').slice(0, ${MAX_RENDERED_HTML}),
              text: (document.body?.innerText ?? '').slice(0, ${MAX_RENDERED_TEXT}),
              finalURL: location.href,
              title: document.title ?? '',
              links: [...document.querySelectorAll('a[href]')].slice(0, 200).flatMap((anchor) => {
                try { return [{ title: (anchor.textContent ?? '').trim().slice(0, 200), url: new URL(anchor.href, location.href).href }] }
                catch { return [] }
              })
            }))()`,
            true,
          )) as {
            html: string
            text: string
            finalURL: string
            title: string
            links: { title: string; url: string }[]
          }
          const article = parseArticle(rendered.html, rendered.finalURL)
          const text = (article?.textContent || rendered.text)
            .replace(/\n{3,}/g, "\n\n")
            .trim()
            .slice(0, MAX_RENDERED_TEXT)
          state.phase = "idle"
          state.domain = new URL(rendered.finalURL).hostname
          state.message = undefined
          return response("ready", config, {
            url: input.url,
            finalURL: rendered.finalURL,
            title: article?.title || rendered.title,
            byline: article?.byline || undefined,
            publishedTime: article?.publishedTime || undefined,
            text,
            links: article?.links ?? rendered.links,
            fetchMode: "browser" as const,
          })
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        state.phase = "failed"
        state.message = message
        return response("failed", config, {
          url: input.url,
          finalURL: input.url,
          title: "",
          text: "",
          fetchMode: "browser" as const,
          message,
        })
      }
    })

  const server = createServer((request, result) => {
    void handleRequest(request, result, token, {
      status: () => ({ ...state, engine: settings().engine, visible: Boolean(window?.isVisible()) }),
      search,
      read,
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Failed to start Research Browser bridge")
  const url = `http://127.0.0.1:${address.port}/`

  const clear = async () => {
    window?.destroy()
    window = undefined
    await browserSession.clearCache()
    await browserSession.clearStorageData()
    state.phase = "idle"
    state.url = undefined
    state.domain = undefined
    state.query = undefined
    state.resultCount = undefined
    state.message = undefined
  }

  let stopped = false
  const stop = async () => {
    if (stopped) return
    stopped = true
    window?.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  app.once("will-quit", () => void stop())
  return {
    url,
    token,
    status: () => ({ ...state, engine: settings().engine, visible: Boolean(window?.isVisible()) }),
    show,
    clear,
    stop,
  }
}

async function handleRequest(
  request: IncomingMessage,
  result: ServerResponse,
  token: string,
  controller: {
    status: () => ResearchBrowserStatus
    search: (input: SearchInput) => Promise<unknown>
    read: (input: ReadInput) => Promise<unknown>
  },
) {
  result.setHeader("content-type", "application/json; charset=utf-8")
  if (request.headers.origin) return send(result, 403, { error: "Browser origins are not allowed" })
  if (request.headers.authorization !== `Bearer ${token}`) return send(result, 401, { error: "Unauthorized" })
  if (request.method === "GET" && request.url === "/status") return send(result, 200, controller.status())
  if (request.method !== "POST" || (request.url !== "/search" && request.url !== "/read"))
    return send(result, 404, { error: "Not found" })
  try {
    const body = await readBody(request)
    const output =
      request.url === "/search" ? await controller.search(parseSearch(body)) : await controller.read(parseRead(body))
    return send(result, 200, output)
  } catch (error) {
    return send(result, 400, { error: error instanceof Error ? error.message : String(error) })
  }
}

function settings(): Settings {
  const raw = getStore("opencode.global.dat").get("settings.v3")
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw
    if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_SETTINGS
    const web = "webSearch" in value && value.webSearch && typeof value.webSearch === "object" ? value.webSearch : {}
    return {
      enabled: typeof web.enabled === "boolean" ? web.enabled : DEFAULT_SETTINGS.enabled,
      engine: ["duckduckgo", "google", "bing"].includes(String(web.engine))
        ? (web.engine as Engine)
        : DEFAULT_SETTINGS.engine,
      visibility: ["background", "always", "hidden"].includes(String(web.visibility))
        ? (web.visibility as Visibility)
        : DEFAULT_SETTINGS.visibility,
      authenticatedPages:
        typeof web.authenticatedPages === "boolean" ? web.authenticatedPages : DEFAULT_SETTINGS.authenticatedPages,
      privateNetwork: typeof web.privateNetwork === "boolean" ? web.privateNetwork : DEFAULT_SETTINGS.privateNetwork,
      externalFallback:
        typeof web.externalFallback === "boolean" ? web.externalFallback : DEFAULT_SETTINGS.externalFallback,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function response<T extends Record<string, unknown>>(status: string, config: Settings, value: T) {
  return { status, engine: config.engine, externalFallback: config.externalFallback, ...value }
}

function parseSearch(value: unknown): SearchInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid search input")
  const input = value as Record<string, unknown>
  if (!Array.isArray(input.queries) || !input.queries.every((item) => typeof item === "string"))
    throw new Error("Search queries must be strings")
  const maxResults = typeof input.maxResults === "number" ? input.maxResults : 8
  return {
    queries: input.queries.slice(0, 4),
    depth: input.depth === "deep" ? "deep" : "quick",
    language: typeof input.language === "string" ? input.language.slice(0, 20) : undefined,
    timeRange: ["day", "week", "month", "year"].includes(String(input.timeRange))
      ? (input.timeRange as TimeRange)
      : undefined,
    maxResults: Math.max(1, Math.min(Math.floor(maxResults), 20)),
  }
}

function parseRead(value: unknown): ReadInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid read input")
  const input = value as Record<string, unknown>
  if (typeof input.url !== "string") throw new Error("Read URL must be a string")
  return { url: input.url, allowAuthenticated: input.allowAuthenticated !== false }
}

function readBody(request: IncomingMessage) {
  return new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on("data", (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > MAX_REQUEST_BYTES) {
        reject(new Error("Request body is too large"))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")))
      } catch {
        reject(new Error("Request body must be JSON"))
      }
    })
    request.on("error", reject)
  })
}

function send(result: ServerResponse, status: number, value: unknown) {
  result.statusCode = status
  result.end(JSON.stringify(value))
}

function searchURL(engine: Engine, query: string, language?: string, timeRange?: TimeRange) {
  if (engine === "google") {
    const url = new URL("https://www.google.com/search")
    url.searchParams.set("q", query)
    if (language) url.searchParams.set("hl", language)
    if (timeRange)
      url.searchParams.set(
        "tbs",
        `qdr:${timeRange === "day" ? "d" : timeRange === "week" ? "w" : timeRange === "month" ? "m" : "y"}`,
      )
    return url.toString()
  }
  if (engine === "bing") {
    const url = new URL("https://www.bing.com/search")
    url.searchParams.set("q", query)
    if (language) url.searchParams.set("setlang", language)
    if (timeRange)
      url.searchParams.set(
        "filters",
        `ex1:%22ez${timeRange === "day" ? "1" : timeRange === "week" ? "2" : timeRange === "month" ? "3" : "5"}%22`,
      )
    return url.toString()
  }
  const url = new URL("https://duckduckgo.com/")
  url.searchParams.set("q", query)
  if (language) url.searchParams.set("kl", language)
  if (timeRange)
    url.searchParams.set(
      "df",
      timeRange === "day" ? "d" : timeRange === "week" ? "w" : timeRange === "month" ? "m" : "y",
    )
  return url.toString()
}

async function waitForSearchResults(win: BrowserWindow, engine: Engine, timeout: number) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (win.isDestroyed()) return { challenge: true, results: [] }
    const value = (await win.webContents.executeJavaScript(searchExtractionScript(engine), true)) as {
      challenge: boolean
      results: SearchResult[]
    }
    if (value.challenge || value.results.length) return value
    await delay(400)
  }
  return { challenge: false, results: [] }
}

async function waitForReady(win: BrowserWindow, timeout: number) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const ready = (await win.webContents.executeJavaScript(
      `document.readyState === 'complete' && Boolean(document.body)`,
      true,
    )) as boolean
    if (ready) return
    await delay(250)
  }
  throw new Error("Rendered page timed out")
}

async function waitForLogin(win: BrowserWindow, timeout: number) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (win.isDestroyed()) return false
    const pending = (await win.webContents.executeJavaScript(
      `Boolean(document.querySelector('input[type="password"]')) && (document.body?.innerText?.length ?? 0) < 8000`,
      true,
    )) as boolean
    if (!pending) return true
    await delay(500)
  }
  return false
}

function parseArticle(html: string, url: string) {
  if (!html.trim()) return undefined
  try {
    const { document } = parseHTML(html)
    for (const anchor of document.querySelectorAll("a[href]")) {
      const href = anchor.getAttribute("href")
      if (!href) continue
      try {
        anchor.setAttribute("href", new URL(href, url).toString())
      } catch {}
    }
    const links = [...document.querySelectorAll("a[href]")].slice(0, 200).flatMap((anchor) => {
      const href = anchor.getAttribute("href")
      if (!href) return []
      return [{ title: (anchor.textContent ?? "").trim().slice(0, 200), url: href }]
    })
    const article = new Readability(document as unknown as Document).parse()
    if (!article) return undefined
    const publishedTime =
      document.querySelector('meta[property="article:published_time"]')?.getAttribute("content") ??
      document.querySelector('meta[name="date"]')?.getAttribute("content") ??
      document.querySelector("time[datetime]")?.getAttribute("datetime") ??
      undefined
    return { ...article, publishedTime, links }
  } catch {
    return undefined
  }
}

async function readHTTP(browserSession: Session, input: ReadInput, config: Settings) {
  const credentials = input.allowAuthenticated && config.authenticatedPages ? "include" : "omit"
  const result = await Array.fromAsync({ length: 6 }, (_, index) => index).then(async (steps) => {
    let current = input.url
    for (const step of steps) {
      await assertSafeURL(current, config.privateNetwork)
      const response = await browserSession.fetch(current, {
        redirect: "manual",
        credentials,
        signal: AbortSignal.timeout(SEARCH_TIMEOUT),
      })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location")
        if (!location || step === steps.length - 1) return undefined
        current = new URL(location, current).toString()
        continue
      }
      if (!response.ok) return undefined
      const contentType = response.headers.get("content-type") ?? ""
      if (!contentType.startsWith("text/") && !contentType.includes("json") && !contentType.includes("xml"))
        return undefined
      const buffer = await response.arrayBuffer()
      if (buffer.byteLength > MAX_RENDERED_HTML) return undefined
      return { current, contentType, content: new TextDecoder().decode(buffer) }
    }
  })
  if (!result) return undefined
  const article = result.contentType.includes("html") ? parseArticle(result.content, result.current) : undefined
  const text = (article?.textContent || result.content)
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_RENDERED_TEXT)
  if (text.length < 300) return undefined
  return {
    url: input.url,
    finalURL: result.current,
    title: article?.title || result.current,
    byline: article?.byline || undefined,
    publishedTime: article?.publishedTime || undefined,
    text,
    links: article?.links,
    fetchMode: "http" as const,
  }
}

async function assertSafeURL(value: string, allowPrivate: boolean) {
  if (!URL.canParse(value)) throw new Error("Invalid URL")
  const url = new URL(value)
  if (!safeResearchProtocol(value)) throw new Error("Only HTTP and HTTPS URLs are allowed")
  const host = url.hostname.toLocaleLowerCase().replace(/^\[|\]$/g, "")
  if (allowPrivate) return
  if (blockedResearchHostname(host)) throw new Error("Private network URLs are blocked")
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
  if (addresses.some((item) => privateResearchAddress(item.address)))
    throw new Error("Private network URLs are blocked")
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
