import path from "path"

export namespace SessionMode {
  export const MetadataKey = "mode"
  export const LegacyDirectories = new Set(["Default Project", "OpenCode Customs Chat"])

  export type Value = "project" | "chat"

  export function resolve(input: { mode?: unknown; metadata?: Record<string, unknown>; directory: string }): Value {
    if (input.mode === "chat" || input.mode === "project") return input.mode
    if (input.metadata?.[MetadataKey] === "chat") return "chat"
    if (input.metadata?.[MetadataKey] === "project") return "project"
    return LegacyDirectories.has(path.basename(path.normalize(input.directory))) ? "chat" : "project"
  }

  export function metadata(metadata: Record<string, unknown> | undefined, mode: Value | undefined, directory: string) {
    const value = resolve({ mode, metadata, directory })
    if (value === "chat") return { ...metadata, [MetadataKey]: value }
    if (!metadata || !(MetadataKey in metadata)) return metadata
    return Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== MetadataKey))
  }
}
