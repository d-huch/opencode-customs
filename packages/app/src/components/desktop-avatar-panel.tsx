import type { VRM } from "@pixiv/three-vrm"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform, type AvatarBridgeStatus } from "@/context/platform"

type PresentationState = NonNullable<AvatarBridgeStatus["presence"]>["state"]

export function DesktopAvatarPanel(props: { sessionID: string; working: boolean }) {
  const platform = usePlatform()
  const language = useLanguage()
  const [status, setStatus] = createSignal<AvatarBridgeStatus>()
  const [model, setModel] = createSignal<{ data: ArrayBuffer; name: string; updatedAt: number }>()
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [revision, setRevision] = createSignal(0)
  let viewport: HTMLDivElement | undefined

  const presence = createMemo(() => {
    const value = status()?.presence
    if (!value) return
    if (value.sessionID && value.sessionID !== props.sessionID) return
    return value
  })
  const state = createMemo<PresentationState>(() => presence()?.state ?? (props.working ? "thinking" : "idle"))
  const label = createMemo(() => language.t(`avatar.presentation.${state()}`))

  const refresh = async () => {
    const [nextStatus, nextModel] = await Promise.all([
      platform.getAvatarBridgeStatus?.(),
      platform.getAvatarModel?.(),
    ])
    if (nextStatus) setStatus(nextStatus)
    if (nextModel && nextModel.updatedAt !== model()?.updatedAt) {
      setModel(nextModel)
      setRevision((value) => value + 1)
    }
  }

  onMount(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 750)
    onCleanup(() => window.clearInterval(timer))
  })

  createEffect(() => {
    revision()
    const target = viewport
    const source = model()
    if (!target || !source) return
    let disposed = false
    let frame = 0
    let renderer: import("three").WebGLRenderer | undefined
    let avatar: VRM | undefined
    let resize: ResizeObserver | undefined

    void Promise.all([import("three"), import("three/addons/loaders/GLTFLoader.js"), import("@pixiv/three-vrm")])
      .then(async ([THREE, { GLTFLoader }, { VRMLoaderPlugin, VRMUtils }]) => {
        if (disposed) return
        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20)
        camera.position.set(0, 1.35, 3.25)
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        target.replaceChildren(renderer.domElement)
        scene.add(new THREE.HemisphereLight(0xc8d8ff, 0x251936, 2.3))
        const key = new THREE.DirectionalLight(0x7ce7ff, 3)
        key.position.set(2, 3, 3)
        scene.add(key)

        const loader = new GLTFLoader()
        loader.register((parser) => new VRMLoaderPlugin(parser))
        const url = URL.createObjectURL(new Blob([source.data], { type: "model/gltf-binary" }))
        const gltf = await loader.loadAsync(url).finally(() => URL.revokeObjectURL(url))
        if (disposed) return VRMUtils.deepDispose(gltf.scene)
        avatar = gltf.userData.vrm as VRM | undefined
        if (!avatar) throw new Error("The selected file does not contain a VRM avatar")
        VRMUtils.removeUnnecessaryVertices(gltf.scene)
        VRMUtils.combineSkeletons(gltf.scene)
        VRMUtils.rotateVRM0(avatar)
        avatar.scene.rotation.y = Math.PI
        scene.add(avatar.scene)

        resize = new ResizeObserver(() => {
          const rect = target.getBoundingClientRect()
          renderer?.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false)
          camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height)
          camera.updateProjectionMatrix()
        })
        resize.observe(target)

        const clock = new THREE.Clock()
        const animate = () => {
          if (disposed) return
          frame = requestAnimationFrame(animate)
          const elapsed = clock.elapsedTime
          const current = state()
          const intensity = presence()?.intensity ?? 0.45
          const root = avatar?.humanoid?.getNormalizedBoneNode("hips")
          if (root) root.position.y = Math.sin(elapsed * 1.6) * 0.006
          const head = avatar?.humanoid?.getNormalizedBoneNode("head")
          if (head) {
            head.rotation.y = Math.sin(elapsed * 0.45) * 0.035
            head.rotation.x = current === "thinking" || current === "planning" ? -0.06 : 0
          }
          const expressions = avatar?.expressionManager
          expressions?.setValue("happy", presence()?.emotion === "happy" ? intensity : 0)
          expressions?.setValue("sad", presence()?.emotion === "sad" ? intensity : 0)
          expressions?.setValue("surprised", current === "uncertain" ? intensity * 0.7 : 0)
          expressions?.setValue("aa", current === "speaking" ? Math.max(0, Math.sin(elapsed * 14)) * 0.38 : 0)
          avatar?.update(clock.getDelta())
          renderer?.render(scene, camera)
        }
        animate()
      })
      .catch((cause) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause))
      })

    onCleanup(() => {
      disposed = true
      cancelAnimationFrame(frame)
      resize?.disconnect()
      if (avatar) avatar.scene.removeFromParent()
      renderer?.dispose()
      target.replaceChildren()
    })
  })

  const choose = async () => {
    if (!platform.selectAvatarModel || loading()) return
    setLoading(true)
    setError(undefined)
    const selected = await platform.selectAvatarModel().catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause))
      return null
    })
    setLoading(false)
    if (!selected) return
    await refresh()
    setRevision((value) => value + 1)
  }

  return (
    <aside class="hidden xl:flex w-[304px] min-w-[304px] h-full overflow-hidden rounded-lg border border-border-weak bg-background-base flex-col">
      <div class="px-4 py-3 border-b border-border-weak flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="text-14-medium text-text-strong truncate">Jarvis</div>
          <div class="text-12-regular text-text-weak truncate">{label()}</div>
        </div>
        <span
          class="size-2 rounded-full shrink-0"
          classList={{
            "bg-icon-success-base": (status()?.connectedClients.length ?? 0) > 0,
            "bg-icon-neutral-muted": (status()?.connectedClients.length ?? 0) === 0,
          }}
        />
      </div>
      <div class="relative flex-1 min-h-0 overflow-hidden bg-gradient-to-b from-background-stronger to-background-base">
        <Show
          when={model()}
          fallback={
            <div class="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
              <div class="relative size-28 rounded-full border border-border-strong bg-background-strong shadow-[0_0_48px_rgba(72,210,255,0.12)]">
                <div class="absolute inset-3 rounded-full border border-accent-base/30 animate-pulse" />
                <div class="absolute inset-8 rounded-full bg-accent-base/20" />
              </div>
              <div class="text-13-regular text-text-weak">{language.t("avatar.presentation.noModel")}</div>
            </div>
          }
        >
          <div ref={viewport} class="absolute inset-0" />
        </Show>
        <div class="absolute inset-x-3 bottom-3 rounded-md border border-border-weak bg-background-base/85 backdrop-blur px-3 py-2">
          <div class="text-12-medium text-text-strong truncate">{presence()?.subtitle ?? label()}</div>
          <Show when={presence()?.goal}>
            <div class="mt-1 text-11-regular text-text-weak line-clamp-2">{presence()!.goal}</div>
          </Show>
        </div>
      </div>
      <div class="p-3 border-t border-border-weak flex flex-col gap-2">
        <Show when={error()}>
          <div class="text-11-regular text-icon-critical-base line-clamp-2">{error()}</div>
        </Show>
        <ButtonV2 variant="neutral" size="small" onClick={() => void choose()} disabled={loading()}>
          {loading() ? language.t("common.loading") : language.t("avatar.presentation.chooseModel")}
        </ButtonV2>
      </div>
    </aside>
  )
}
