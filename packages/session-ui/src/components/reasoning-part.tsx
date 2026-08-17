import { Collapsible } from "@opencode-ai/ui/collapsible"
import { useI18n } from "@opencode-ai/ui/context/i18n"
import { createEffect, createMemo, createSignal, onCleanup, type ParentProps } from "solid-js"
import { elapsedMilliseconds, formatCompactDuration } from "./message-duration"

export function ReasoningPartDisclosure(props: ParentProps<{ start: number; end?: number; partID?: string }>) {
  const i18n = useI18n()
  const [open, setOpen] = createSignal(false)
  const [now, setNow] = createSignal(Date.now())
  const streaming = createMemo(() => props.end === undefined)
  const duration = createMemo(() => {
    const milliseconds = elapsedMilliseconds(props.start, props.end, now())
    return milliseconds === undefined ? "" : formatCompactDuration(i18n, milliseconds)
  })
  const label = createMemo(() => {
    if (!duration()) return i18n.t("ui.message.reasoning.fallback")
    return i18n.t(streaming() ? "ui.message.reasoning.active" : "ui.message.reasoning.completed", {
      duration: duration(),
    })
  })

  createEffect(() => {
    if (!streaming() || !Number.isFinite(props.start)) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    onCleanup(() => window.clearInterval(timer))
  })

  return (
    <div data-component="reasoning-part" data-timeline-part-id={props.partID}>
      <Collapsible class="reasoning-collapsible" variant="ghost" open={open()} onOpenChange={setOpen}>
        <Collapsible.Trigger aria-label={label()}>
          <Collapsible.Arrow />
          <span data-slot="reasoning-part-label">{label()}</span>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div data-slot="reasoning-part-content">{props.children}</div>
        </Collapsible.Content>
      </Collapsible>
    </div>
  )
}
