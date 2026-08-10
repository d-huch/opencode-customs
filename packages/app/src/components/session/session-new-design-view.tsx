import type { JSX } from "solid-js"
import { NEW_SESSION_CONTENT_WIDTH } from "@/pages/session/new-session-layout"

export function NewSessionDesignView(props: { children: JSX.Element }) {
  return (
    <div data-component="session-new-design" class="relative size-full overflow-hidden bg-v2-background-bg-deep ">
      <div class="absolute inset-x-0 top-[25.375%] flex justify-center px-6">
        <div class={NEW_SESSION_CONTENT_WIDTH}>
          <div
            role="img"
            aria-label="OpenCode Customs"
            class="w-full select-none whitespace-nowrap text-center font-mono text-[clamp(2rem,5.5vw,5rem)] font-black leading-none tracking-[-0.08em] text-v2-background-bg-inverse opacity-[0.096]"
          >
            OPENCODE CUSTOMS
          </div>
          <div class="mt-8">{props.children}</div>
        </div>
      </div>
    </div>
  )
}
