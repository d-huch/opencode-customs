import { parseHTML } from "linkedom"

export type ResearchEngine = "duckduckgo" | "google" | "bing"
export type SearchResult = { title: string; url: string; snippet: string; domain: string }

const selectors: Record<ResearchEngine, string[]> = {
  duckduckgo: ['article[data-testid="result"]', '[data-testid="result"]', ".result"],
  google: ["#search .MjjYud", "#search .g"],
  bing: ["#b_results > li.b_algo"],
}
const challengePhrases = [
  "unusual traffic",
  "verify you are human",
  "перевірте, що ви людина",
  "підтвердьте, що ви людина",
]

export function searchExtractionScript(engine: ResearchEngine) {
  return `(() => {
    const text = (document.body?.innerText ?? '').toLowerCase()
    const challenge = Boolean(document.querySelector('iframe[src*="captcha"], [class*="captcha"], [id*="captcha"]')) ||
      ${JSON.stringify(challengePhrases)}.some((phrase) => text.includes(phrase))
    const nodes = [...new Set(${JSON.stringify(selectors[engine])}.flatMap((selector) => [...document.querySelectorAll(selector)]))]
    const source = nodes.length ? nodes : [...document.querySelectorAll('a')].filter((anchor) => anchor.querySelector('h2,h3'))
    const results = source.flatMap((node) => {
      if (node.closest?.('#tads, .b_ad, [data-testid="ad"], [data-layout="ad"]')) return []
      const anchor = node.matches?.('a') ? node : node.querySelector('a[href]')
      const heading = node.querySelector?.('h2,h3')
      if (!anchor?.href || !heading?.textContent) return []
      const label = (node.querySelector?.('[data-testid="ad"], .b_adlabel')?.textContent ?? '').trim().toLowerCase()
      if (label === 'ad' || label === 'sponsored') return []
      const snippet = node.querySelector?.('[data-result="snippet"], .VwiC3b, .b_caption p, .result__snippet')?.textContent ?? ''
      try {
        const url = new URL(anchor.href)
        return [{ title: heading.textContent.trim(), url: url.href, snippet: snippet.trim(), domain: url.hostname.replace(/^www\\./, '') }]
      } catch { return [] }
    })
    return { challenge, results }
  })()`
}

export function extractSearchResultsFromHTML(engine: ResearchEngine, html: string, baseURL: string) {
  const { document } = parseHTML(html)
  const text = (document.body?.textContent ?? "").toLocaleLowerCase()
  const challenge =
    Boolean(document.querySelector('iframe[src*="captcha"], [class*="captcha"], [id*="captcha"]')) ||
    challengePhrases.some((phrase) => text.includes(phrase))
  const nodes = [...new Set(selectors[engine].flatMap((selector) => [...document.querySelectorAll(selector)]))]
  const source = nodes.length
    ? nodes
    : [...document.querySelectorAll("a")].filter((anchor) => anchor.querySelector("h2,h3"))
  const results = source.flatMap((node) => {
    if (node.closest('#tads, .b_ad, [data-testid="ad"], [data-layout="ad"]')) return []
    const anchor = node.matches("a") ? node : node.querySelector("a[href]")
    const heading = node.querySelector("h2,h3")
    if (!anchor?.getAttribute("href") || !heading?.textContent) return []
    const label = node.querySelector('[data-testid="ad"], .b_adlabel')?.textContent?.trim().toLocaleLowerCase()
    if (label === "ad" || label === "sponsored") return []
    const url = new URL(anchor.getAttribute("href")!, baseURL)
    return [
      {
        title: heading.textContent.trim(),
        url: url.toString(),
        snippet:
          node.querySelector('[data-result="snippet"], .VwiC3b, .b_caption p, .result__snippet')?.textContent?.trim() ??
          "",
        domain: url.hostname.replace(/^www\./, ""),
      },
    ]
  })
  return { challenge, results }
}
