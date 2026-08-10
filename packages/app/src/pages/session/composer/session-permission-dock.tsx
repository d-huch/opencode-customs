import { For, Show } from "solid-js"
import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { Button } from "@opencode-ai/ui/button"
import { DockPrompt } from "@opencode-ai/session-ui/dock-prompt"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"

export function SessionPermissionDock(props: {
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "always" | "reject") => void
}) {
  const language = useLanguage()
  const risk = () => riskMetadata(props.request.permission, props.request.metadata)

  const toolDescription = () => {
    const key = `settings.permissions.tool.${props.request.permission}.description`
    const value = language.t(key as Parameters<typeof language.t>[0])
    if (value === key) return ""
    return value
  }

  return (
    <DockPrompt
      kind="permission"
      header={
        <div data-slot="permission-row" data-variant="header">
          <span data-slot="permission-icon">
            <Icon name="warning" size="normal" />
          </span>
          <div data-slot="permission-header-title">{language.t("notification.permission.title")}</div>
        </div>
      }
      footer={
        <>
          <div />
          <div data-slot="permission-footer-actions">
            <Button variant="ghost" size="normal" onClick={() => props.onDecide("reject")} disabled={props.responding}>
              {language.t("ui.permission.deny")}
            </Button>
            <Button
              variant="secondary"
              size="normal"
              onClick={() => props.onDecide("always")}
              disabled={props.responding}
            >
              {language.t("ui.permission.allowAlways")}
            </Button>
            <Button variant="primary" size="normal" onClick={() => props.onDecide("once")} disabled={props.responding}>
              {language.t("ui.permission.allowOnce")}
            </Button>
          </div>
        </>
      }
    >
      <Show when={toolDescription()}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-hint">{toolDescription()}</div>
        </div>
      </Show>

      <Show when={risk()}>
        {(assessment) => (
          <>
            <div data-slot="permission-row">
              <span data-slot="permission-spacer" aria-hidden="true" />
              <div data-slot="permission-hint">
                {language.t("permission.risk.level")}: <strong>{assessment().level.toUpperCase()}</strong>
                {" · "}
                {language.t("permission.risk.plan")}: {assessment().plan}
                {" · "}
                {language.t("permission.risk.verification")}: {assessment().verification}
                {" · "}
                {language.t("permission.risk.critic")}:{" "}
                {assessment().critic
                  ? language.t("permission.risk.required")
                  : language.t("permission.risk.notRequired")}
              </div>
            </div>
            <Show when={assessment().files.length > 0}>
              <div data-slot="permission-row">
                <span data-slot="permission-spacer" aria-hidden="true" />
                <div data-slot="permission-patterns">
                  <span class="text-12-regular text-text-weak">{language.t("permission.risk.files")}</span>
                  <For each={assessment().files}>
                    {(file) => <code class="text-12-regular text-text-base break-all">{file}</code>}
                  </For>
                </div>
              </div>
            </Show>
          </>
        )}
      </Show>

      <Show when={props.request.permission !== "change_risk" && props.request.patterns.length > 0}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-patterns">
            <For each={props.request.patterns}>
              {(pattern) => <code class="text-12-regular text-text-base break-all">{pattern}</code>}
            </For>
          </div>
        </div>
      </Show>
    </DockPrompt>
  )
}

function riskMetadata(permission: string, metadata: Record<string, unknown>) {
  if (permission !== "change_risk") return
  if (!["high", "critical"].includes(String(metadata.level))) return
  if (!metadata.policy || typeof metadata.policy !== "object" || Array.isArray(metadata.policy)) return
  const policy = metadata.policy as Record<string, unknown>
  return {
    level: String(metadata.level),
    plan: String(policy.plan ?? "required"),
    verification: String(policy.verification ?? "extended"),
    critic: policy.critic === true,
    files: Array.isArray(metadata.files) ? metadata.files.filter((file): file is string => typeof file === "string") : [],
  }
}
