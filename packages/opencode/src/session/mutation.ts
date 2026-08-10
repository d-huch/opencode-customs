export * as SessionMutation from "./mutation"

import path from "path"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { isRecord } from "@/util/record"

const tools = new Set(["apply_patch", "bash", "edit", "write"])

export function normalize(root: string, file: string) {
  const absolute = path.isAbsolute(file) ? file : path.resolve(root, file)
  return path.relative(root, absolute).replaceAll("\\", "/") || path.basename(absolute)
}

export function toolFiles(input: { tool: string; metadata: unknown; root: string }) {
  if (!tools.has(input.tool) || !isRecord(input.metadata)) return []

  const files =
    input.tool === "apply_patch" && Array.isArray(input.metadata.files)
      ? input.metadata.files.flatMap((item) => {
          if (!isRecord(item)) return []
          return [item.filePath, item.movePath, item.relativePath].filter(
            (file): file is string => typeof file === "string",
          )
        })
      : input.tool === "edit" && isRecord(input.metadata.filediff) && typeof input.metadata.filediff.file === "string"
        ? [input.metadata.filediff.file]
      : input.tool === "write" && typeof input.metadata.filepath === "string"
          ? [input.metadata.filepath]
          : input.tool === "bash" && Array.isArray(input.metadata.files)
            ? input.metadata.files.filter((file): file is string => typeof file === "string")
          : []

  return Array.from(new Set(files.map((file) => normalize(input.root, file))))
}

export function messageFiles(message: SessionV1.WithParts, root: string) {
  if (message.info.role !== "assistant") return []
  return Array.from(
    new Set(
      message.parts.flatMap((part) =>
        part.type === "tool" && part.state.status === "completed"
          ? toolFiles({ tool: part.tool, metadata: part.state.metadata, root })
          : [],
      ),
    ),
  )
}

export function filter(root: string, files: readonly string[], owned: ReadonlySet<string>) {
  return files.filter((file) => owned.has(normalize(root, file)))
}
