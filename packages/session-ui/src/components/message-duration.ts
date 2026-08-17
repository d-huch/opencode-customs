import type { UiI18n } from "@opencode-ai/ui/context/i18n"

export function elapsedMilliseconds(start: number, end: number | undefined, now: number) {
  if (!Number.isFinite(start)) return
  const stopped = end ?? now
  if (!Number.isFinite(stopped) || stopped < start) return
  return stopped - start
}

export function formatCompactDuration(i18n: UiI18n, milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return ""
  const formatter = new Intl.NumberFormat(i18n.locale())
  const total = Math.round(milliseconds / 1_000)
  if (total < 60) return i18n.t("ui.message.duration.seconds", { count: formatter.format(total) })
  return i18n.t("ui.message.duration.minutesSeconds", {
    minutes: formatter.format(Math.floor(total / 60)),
    seconds: formatter.format(total % 60),
  })
}
