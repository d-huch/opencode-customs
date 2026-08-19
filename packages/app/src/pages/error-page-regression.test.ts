import { expect, test } from "bun:test"

test("the recovery page keeps local diagnostics without external reporting affordances", async () => {
  const source = await Bun.file(new URL("./error.tsx", import.meta.url)).text()

  expect(source).toContain("ProductWordmark")
  expect(source).toContain("error.page.action.exportLogs")
  expect(source).not.toContain("Sentry.captureException")
  expect(source).not.toContain("desktop-feedback")
  expect(source).not.toContain('name="discord"')
})
