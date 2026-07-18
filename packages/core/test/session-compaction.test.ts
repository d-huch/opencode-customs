import { expect, test } from "bun:test"
import { SessionCompaction } from "@opencode-ai/core/session/compaction"

test("compaction prompt preserves detailed work state and relevant files", () => {
  const prompt = SessionCompaction.buildPrompt({
    context: ["conversation history"],
    languageSample: "Знайди журнал правопорушень",
  })

  expect(prompt).toContain("## Work State\n### Completed")
  expect(prompt).toContain("### Active")
  expect(prompt).toContain("### Blocked")
  expect(prompt).toContain("## Relevant Files")
  expect(prompt).toContain("successful tool result confirmed it")
  expect(prompt).toContain("Знайди журнал правопорушень")
})

test("compaction normalizes repeated output and removes paths without evidence", () => {
  const block = `## Objective
- Знайти журнал правопорушень

## Important Details
- Меню реалізовано у resources/js/components/NavigationSidebar.vue

## Work State
### Completed
- Прочитано resources/views/layout.blade.php

### Active
- Відкрити resources/js/components/NavigationSidebar.vue

### Blocked
- (none)

## Next Move
1. Перевірити resources/js/components/NavigationSidebar.vue

## Relevant Files
- resources/views/layout.blade.php: перевірений layout
- resources/js/components/NavigationSidebar.vue: нібито компонент`
  const summary = SessionCompaction.normalizeSummary({
    text: `${block}\n\n${block}`,
    evidence: ["Read /project/resources/views/layout.blade.php successfully"],
  })

  expect(summary.match(/## Objective/g)).toHaveLength(1)
  expect(summary).toContain("## Work State\n\n### Completed")
  expect(summary).toContain("resources/views/layout.blade.php")
  expect(summary).not.toContain("NavigationSidebar.vue")
})

test("compaction describes tool media without embedding base64", () => {
  const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
  const serialized = SessionCompaction.serializeToolContent([
    { type: "text", text: "Image read successfully" },
    {
      type: "file",
      uri: `data:image/png;base64,${base64}`,
      mime: "image/png",
      name: "pixel.png",
    },
  ])

  expect(serialized).toBe("Image read successfully\n[Attached image/png: pixel.png]")
  expect(serialized).not.toContain(base64)
})
