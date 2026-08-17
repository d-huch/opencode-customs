import { describe, expect, test } from "bun:test"
import { extractSearchResultsFromHTML } from "./research-browser-dom"

describe("Research Browser search adapters", () => {
  test("extracts DuckDuckGo results and ignores ads", () => {
    const result = extractSearchResultsFromHTML(
      "duckduckgo",
      `<body>
        <article data-testid="result"><a href="https://example.com/one"><h2>One</h2></a><div data-result="snippet">First source</div></article>
        <article data-testid="result" data-layout="ad"><a href="https://ads.example/two"><h2>Ad</h2></a></article>
      </body>`,
      "https://duckduckgo.com/",
    )
    expect(result.challenge).toBe(false)
    expect(result.results).toEqual([
      { title: "One", url: "https://example.com/one", snippet: "First source", domain: "example.com" },
    ])
  })

  test("extracts Google and Bing result fixtures", () => {
    expect(
      extractSearchResultsFromHTML(
        "google",
        `<div id="search"><div class="g"><a href="https://google.example/source"><h3>Google source</h3></a><div class="VwiC3b">Snippet</div></div></div>`,
        "https://www.google.com/search?q=test",
      ).results,
    ).toHaveLength(1)
    expect(
      extractSearchResultsFromHTML(
        "bing",
        `<ol id="b_results"><li class="b_algo"><a href="https://bing.example/source"><h2>Bing source</h2></a><div class="b_caption"><p>Snippet</p></div></li></ol>`,
        "https://www.bing.com/search?q=test",
      ).results,
    ).toHaveLength(1)
  })

  test("detects a CAPTCHA and tolerates an empty result page", () => {
    expect(
      extractSearchResultsFromHTML(
        "google",
        `<body><iframe src="https://captcha.example/challenge"></iframe>Verify you are human</body>`,
        "https://www.google.com/search?q=test",
      ),
    ).toEqual({ challenge: true, results: [] })
    expect(extractSearchResultsFromHTML("bing", "<body>No results</body>", "https://bing.com/")).toEqual({
      challenge: false,
      results: [],
    })
  })
})
