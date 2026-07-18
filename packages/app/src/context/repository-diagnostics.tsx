import type { RepositoryMapDiagnostics } from "@opencode-ai/sdk/v2"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { createEffect, createSignal, onCleanup } from "solid-js"
import { useSDK } from "@/context/sdk"

const RepositoryDiagnosticsContext = createSimpleContext({
  name: "RepositoryDiagnostics",
  init: () => {
    const sdk = useSDK()
    const [data, setData] = createSignal<RepositoryMapDiagnostics>()
    const [updating, setUpdating] = createSignal(false)
    let inflight: Promise<void> | undefined
    let revision = 0

    const refresh = () => {
      if (inflight) return inflight
      const current = revision
      inflight = sdk()
        .client.v2.repositoryMap.diagnostics()
        .then((result) => {
          const next = result.data?.data
          if (current !== revision || !next) return
          const previous = data()
          if (
            previous?.enabled === next.enabled &&
            previous.entries.length === next.entries.length &&
            previous.entries[0]?.time === next.entries[0]?.time &&
            previous.entries.at(-1)?.time === next.entries.at(-1)?.time
          )
            return
          setData(next)
        })
        .catch(() => {})
        .finally(() => {
          inflight = undefined
        })
      return inflight
    }

    const configure = (enabled: boolean, clear = false) => {
      if (updating()) return Promise.resolve()
      const current = ++revision
      const previous = data()
      setUpdating(true)
      setData({ enabled, entries: clear ? [] : (previous?.entries ?? []) })
      return sdk()
        .client.v2.repositoryMap.configureDiagnostics({
          repositoryMapDiagnosticsConfig: { enabled, clear },
        })
        .then((result) => {
          if (current === revision && result.data?.data) setData(result.data.data)
        })
        .catch((error) => {
          if (current === revision) setData(previous)
          throw error
        })
        .finally(() => setUpdating(false))
    }

    createEffect(() => {
      sdk()
      void refresh()
    })

    createEffect(() => {
      if (!data()?.enabled) return
      const timer = window.setInterval(() => void refresh(), 750)
      onCleanup(() => window.clearInterval(timer))
    })

    return { data, updating, refresh, configure }
  },
})

export const useRepositoryDiagnostics = () => RepositoryDiagnosticsContext.use()
export const RepositoryDiagnosticsProvider = RepositoryDiagnosticsContext.provider
