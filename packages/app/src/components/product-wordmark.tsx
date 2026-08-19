import { useLanguage } from "@/context/language"

export function ProductWordmark(props: { class?: string }) {
  const language = useLanguage()
  return (
    <div
      role="img"
      aria-label={language.t("app.name.desktop")}
      class={`select-none whitespace-nowrap text-center font-mono font-black leading-none tracking-[-0.08em] uppercase ${props.class ?? ""}`}
    >
      {language.t("app.name.desktop")}
    </div>
  )
}
