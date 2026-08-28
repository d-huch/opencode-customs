import type { OpenCodeEventEncoded } from "@opencode-ai/protocol/groups/event"

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue }

export type UnauthorizedError = { readonly _tag: "UnauthorizedError"; readonly message: string }
export const isUnauthorizedError = (value: unknown): value is UnauthorizedError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "UnauthorizedError"

export type InvalidRequestError = {
  readonly _tag: "InvalidRequestError"
  readonly message: string
  readonly kind?: string | undefined
  readonly field?: string | undefined
}
export const isInvalidRequestError = (value: unknown): value is InvalidRequestError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "InvalidRequestError"

export type InvalidCursorError = { readonly _tag: "InvalidCursorError"; readonly message: string }
export const isInvalidCursorError = (value: unknown): value is InvalidCursorError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "InvalidCursorError"

export type SessionNotFoundError = {
  readonly _tag: "SessionNotFoundError"
  readonly sessionID: string
  readonly message: string
}
export const isSessionNotFoundError = (value: unknown): value is SessionNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "SessionNotFoundError"

export type ConflictError = {
  readonly _tag: "ConflictError"
  readonly message: string
  readonly resource?: string | undefined
}
export const isConflictError = (value: unknown): value is ConflictError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ConflictError"

export type ServiceUnavailableError = {
  readonly _tag: "ServiceUnavailableError"
  readonly message: string
  readonly service?: string | undefined
}
export const isServiceUnavailableError = (value: unknown): value is ServiceUnavailableError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ServiceUnavailableError"

export type MessageNotFoundError = {
  readonly _tag: "MessageNotFoundError"
  readonly sessionID: string
  readonly messageID: string
  readonly message: string
}
export const isMessageNotFoundError = (value: unknown): value is MessageNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "MessageNotFoundError"

export type UnknownError = {
  readonly _tag: "UnknownError"
  readonly message: string
  readonly ref?: string | undefined
}
export const isUnknownError = (value: unknown): value is UnknownError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "UnknownError"

export type ProviderNotFoundError = {
  readonly _tag: "ProviderNotFoundError"
  readonly providerID: string
  readonly message: string
}
export const isProviderNotFoundError = (value: unknown): value is ProviderNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ProviderNotFoundError"

export type PermissionNotFoundError = {
  readonly _tag: "PermissionNotFoundError"
  readonly requestID: string
  readonly message: string
}
export const isPermissionNotFoundError = (value: unknown): value is PermissionNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "PermissionNotFoundError"

export type PtyNotFoundError = { readonly _tag: "PtyNotFoundError"; readonly ptyID: string; readonly message: string }
export const isPtyNotFoundError = (value: unknown): value is PtyNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "PtyNotFoundError"

export type QuestionNotFoundError = {
  readonly _tag: "QuestionNotFoundError"
  readonly requestID: string
  readonly message: string
}
export const isQuestionNotFoundError = (value: unknown): value is QuestionNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "QuestionNotFoundError"

export type ProjectCopyError = {
  readonly name: "ProjectCopyError"
  readonly data: { readonly message: string; readonly forceRequired?: boolean | undefined }
}
export const isProjectCopyError = (value: unknown): value is ProjectCopyError =>
  typeof value === "object" && value !== null && "name" in value && value["name"] === "ProjectCopyError"

export type HealthGetOutput = { readonly healthy: true }

export type LocationGetInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type LocationGetOutput = {
  readonly directory: string
  readonly workspaceID?: string
  readonly project: { readonly id: string; readonly directory: string }
}

export type AgentsListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type AgentsListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly request: {
      readonly headers: { readonly [x: string]: string }
      readonly body: { readonly [x: string]: JsonValue }
    }
    readonly system?: string
    readonly description?: string
    readonly mode: "subagent" | "primary" | "all"
    readonly hidden: boolean
    readonly color?: string | "primary" | "secondary" | "accent" | "success" | "warning" | "error" | "info"
    readonly steps?: number
    readonly permissions: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
    }>
  }>
}

export type SessionsListInput = {
  readonly workspace?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["workspace"]
  readonly limit?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["limit"]
  readonly order?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["order"]
  readonly search?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["search"]
  readonly directory?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["directory"]
  readonly project?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["project"]
  readonly subpath?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["subpath"]
  readonly cursor?: {
    readonly workspace?: string | undefined
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["cursor"]
}

export type SessionsListOutput = {
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly parentID?: string
    readonly projectID: string
    readonly agent?: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly cost: number
    readonly tokens: {
      readonly input: number
      readonly output: number
      readonly reasoning: number
      readonly cache: { readonly read: number; readonly write: number }
    }
    readonly time: { readonly created: number; readonly updated: number; readonly archived?: number }
    readonly title: string
    readonly location: { readonly directory: string; readonly workspaceID?: string }
    readonly mode?: "project" | "chat"
    readonly jarvis?: {
      readonly profileID?: string
      readonly profileRevision?: number
      readonly mode?: "chat" | "unity"
      readonly inbox?: boolean
    }
    readonly subpath?: string
    readonly revert?: {
      readonly messageID: string
      readonly partID?: string
      readonly snapshot?: string
      readonly diff?: string
      readonly files?: ReadonlyArray<{
        readonly path: string
        readonly status: "added" | "modified" | "deleted"
        readonly additions: number
        readonly deletions: number
        readonly patch: string
      }>
    }
  }>
  readonly cursor: { readonly previous?: string | null; readonly next?: string | null }
}

export type SessionsCreateInput = {
  readonly id?: {
    readonly id?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string; readonly workspaceID?: string } | null
    readonly mode?: "project" | "chat" | null
    readonly jarvis?: {
      readonly profileID?: string
      readonly profileRevision?: number
      readonly mode?: "chat" | "unity"
      readonly inbox?: boolean
    } | null
  }["id"]
  readonly agent?: {
    readonly id?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string; readonly workspaceID?: string } | null
    readonly mode?: "project" | "chat" | null
    readonly jarvis?: {
      readonly profileID?: string
      readonly profileRevision?: number
      readonly mode?: "chat" | "unity"
      readonly inbox?: boolean
    } | null
  }["agent"]
  readonly model?: {
    readonly id?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string; readonly workspaceID?: string } | null
    readonly mode?: "project" | "chat" | null
    readonly jarvis?: {
      readonly profileID?: string
      readonly profileRevision?: number
      readonly mode?: "chat" | "unity"
      readonly inbox?: boolean
    } | null
  }["model"]
  readonly location?: {
    readonly id?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string; readonly workspaceID?: string } | null
    readonly mode?: "project" | "chat" | null
    readonly jarvis?: {
      readonly profileID?: string
      readonly profileRevision?: number
      readonly mode?: "chat" | "unity"
      readonly inbox?: boolean
    } | null
  }["location"]
  readonly mode?: {
    readonly id?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string; readonly workspaceID?: string } | null
    readonly mode?: "project" | "chat" | null
    readonly jarvis?: {
      readonly profileID?: string
      readonly profileRevision?: number
      readonly mode?: "chat" | "unity"
      readonly inbox?: boolean
    } | null
  }["mode"]
  readonly jarvis?: {
    readonly id?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string; readonly workspaceID?: string } | null
    readonly mode?: "project" | "chat" | null
    readonly jarvis?: {
      readonly profileID?: string
      readonly profileRevision?: number
      readonly mode?: "chat" | "unity"
      readonly inbox?: boolean
    } | null
  }["jarvis"]
}

export type SessionsCreateOutput = {
  readonly data: {
    readonly id: string
    readonly parentID?: string
    readonly projectID: string
    readonly agent?: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly cost: number
    readonly tokens: {
      readonly input: number
      readonly output: number
      readonly reasoning: number
      readonly cache: { readonly read: number; readonly write: number }
    }
    readonly time: { readonly created: number; readonly updated: number; readonly archived?: number }
    readonly title: string
    readonly location: { readonly directory: string; readonly workspaceID?: string }
    readonly mode?: "project" | "chat"
    readonly jarvis?: {
      readonly profileID?: string
      readonly profileRevision?: number
      readonly mode?: "chat" | "unity"
      readonly inbox?: boolean
    }
    readonly subpath?: string
    readonly revert?: {
      readonly messageID: string
      readonly partID?: string
      readonly snapshot?: string
      readonly diff?: string
      readonly files?: ReadonlyArray<{
        readonly path: string
        readonly status: "added" | "modified" | "deleted"
        readonly additions: number
        readonly deletions: number
        readonly patch: string
      }>
    }
  }
}["data"]

export type SessionsActiveOutput = { readonly data: { readonly [x: string]: { readonly type: "running" } } }["data"]

export type SessionsGetInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsGetOutput = {
  readonly data: {
    readonly id: string
    readonly parentID?: string
    readonly projectID: string
    readonly agent?: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly cost: number
    readonly tokens: {
      readonly input: number
      readonly output: number
      readonly reasoning: number
      readonly cache: { readonly read: number; readonly write: number }
    }
    readonly time: { readonly created: number; readonly updated: number; readonly archived?: number }
    readonly title: string
    readonly location: { readonly directory: string; readonly workspaceID?: string }
    readonly mode?: "project" | "chat"
    readonly jarvis?: {
      readonly profileID?: string
      readonly profileRevision?: number
      readonly mode?: "chat" | "unity"
      readonly inbox?: boolean
    }
    readonly subpath?: string
    readonly revert?: {
      readonly messageID: string
      readonly partID?: string
      readonly snapshot?: string
      readonly diff?: string
      readonly files?: ReadonlyArray<{
        readonly path: string
        readonly status: "added" | "modified" | "deleted"
        readonly additions: number
        readonly deletions: number
        readonly patch: string
      }>
    }
  }
}["data"]

export type SessionsUpdateJarvisInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly profileID?: {
    readonly profileID?: string
    readonly profileRevision?: number
    readonly mode?: "chat" | "unity"
    readonly inbox?: boolean
  }["profileID"]
  readonly profileRevision?: {
    readonly profileID?: string
    readonly profileRevision?: number
    readonly mode?: "chat" | "unity"
    readonly inbox?: boolean
  }["profileRevision"]
  readonly mode?: {
    readonly profileID?: string
    readonly profileRevision?: number
    readonly mode?: "chat" | "unity"
    readonly inbox?: boolean
  }["mode"]
  readonly inbox?: {
    readonly profileID?: string
    readonly profileRevision?: number
    readonly mode?: "chat" | "unity"
    readonly inbox?: boolean
  }["inbox"]
}

export type SessionsUpdateJarvisOutput = {
  readonly data: {
    readonly id: string
    readonly parentID?: string
    readonly projectID: string
    readonly agent?: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly cost: number
    readonly tokens: {
      readonly input: number
      readonly output: number
      readonly reasoning: number
      readonly cache: { readonly read: number; readonly write: number }
    }
    readonly time: { readonly created: number; readonly updated: number; readonly archived?: number }
    readonly title: string
    readonly location: { readonly directory: string; readonly workspaceID?: string }
    readonly mode?: "project" | "chat"
    readonly jarvis?: {
      readonly profileID?: string
      readonly profileRevision?: number
      readonly mode?: "chat" | "unity"
      readonly inbox?: boolean
    }
    readonly subpath?: string
    readonly revert?: {
      readonly messageID: string
      readonly partID?: string
      readonly snapshot?: string
      readonly diff?: string
      readonly files?: ReadonlyArray<{
        readonly path: string
        readonly status: "added" | "modified" | "deleted"
        readonly additions: number
        readonly deletions: number
        readonly patch: string
      }>
    }
  }
}["data"]

export type SessionsRemoveInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsRemoveOutput = void

export type SessionsSwitchAgentInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly agent: { readonly agent: string }["agent"]
}

export type SessionsSwitchAgentOutput = void

export type SessionsSwitchModelInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly model: {
    readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
  }["model"]
}

export type SessionsSwitchModelOutput = void

export type SessionsPromptInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id?: {
    readonly id?: string | null
    readonly prompt: {
      readonly text: string
      readonly files?: ReadonlyArray<{
        readonly uri: string
        readonly name?: string
        readonly description?: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
      readonly agents?: ReadonlyArray<{
        readonly name: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["id"]
  readonly prompt: {
    readonly id?: string | null
    readonly prompt: {
      readonly text: string
      readonly files?: ReadonlyArray<{
        readonly uri: string
        readonly name?: string
        readonly description?: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
      readonly agents?: ReadonlyArray<{
        readonly name: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["prompt"]
  readonly delivery?: {
    readonly id?: string | null
    readonly prompt: {
      readonly text: string
      readonly files?: ReadonlyArray<{
        readonly uri: string
        readonly name?: string
        readonly description?: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
      readonly agents?: ReadonlyArray<{
        readonly name: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["delivery"]
  readonly resume?: {
    readonly id?: string | null
    readonly prompt: {
      readonly text: string
      readonly files?: ReadonlyArray<{
        readonly uri: string
        readonly name?: string
        readonly description?: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
      readonly agents?: ReadonlyArray<{
        readonly name: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    }
    readonly delivery?: "steer" | "queue" | null
    readonly resume?: boolean | null
  }["resume"]
}

export type SessionsPromptOutput = {
  readonly data: {
    readonly admittedSeq: number
    readonly id: string
    readonly sessionID: string
    readonly prompt: {
      readonly text: string
      readonly files?: ReadonlyArray<{
        readonly uri: string
        readonly mime: string
        readonly name?: string
        readonly description?: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
      readonly agents?: ReadonlyArray<{
        readonly name: string
        readonly source?: { readonly start: number; readonly end: number; readonly text: string }
      }>
    }
    readonly delivery: "steer" | "queue"
    readonly timeCreated: number
    readonly promotedSeq?: number
  }
}["data"]

export type SessionsExternalTurnInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly idempotencyKey: {
    readonly idempotencyKey: string
    readonly userText: string
    readonly assistantText: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
  }["idempotencyKey"]
  readonly userText: {
    readonly idempotencyKey: string
    readonly userText: string
    readonly assistantText: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
  }["userText"]
  readonly assistantText: {
    readonly idempotencyKey: string
    readonly userText: string
    readonly assistantText: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
  }["assistantText"]
  readonly model?: {
    readonly idempotencyKey: string
    readonly userText: string
    readonly assistantText: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
  }["model"]
}

export type SessionsExternalTurnOutput = {
  readonly data: { readonly userMessageID: string; readonly assistantMessageID: string }
}["data"]

export type SessionsCompactInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsCompactOutput = void

export type SessionsWaitInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsWaitOutput = void

export type SessionsStageInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly messageID: { readonly messageID: string; readonly files?: boolean | undefined }["messageID"]
  readonly files?: { readonly messageID: string; readonly files?: boolean | undefined }["files"]
}

export type SessionsStageOutput = {
  readonly data: {
    readonly messageID: string
    readonly partID?: string
    readonly snapshot?: string
    readonly diff?: string
    readonly files?: ReadonlyArray<{
      readonly path: string
      readonly status: "added" | "modified" | "deleted"
      readonly additions: number
      readonly deletions: number
      readonly patch: string
    }>
  }
}["data"]

export type SessionsClearInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsClearOutput = void

export type SessionsCommitInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsCommitOutput = void

export type SessionsContextInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsContextOutput = {
  readonly data: ReadonlyArray<
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "agent-switched"
        readonly agent: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "model-switched"
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly text: string
        readonly files?: ReadonlyArray<{
          readonly uri: string
          readonly mime: string
          readonly name?: string
          readonly description?: string
          readonly source?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly agents?: ReadonlyArray<{
          readonly name: string
          readonly source?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly type: "user"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly sessionID: string
        readonly text: string
        readonly type: "synthetic"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "system"
        readonly text: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "shell"
        readonly callID: string
        readonly command: string
        readonly output: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "assistant"
        readonly agent: string
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly content: ReadonlyArray<
          | { readonly type: "text"; readonly id: string; readonly text: string }
          | {
              readonly type: "reasoning"
              readonly id: string
              readonly text: string
              readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
              readonly time?: { readonly created: number; readonly completed?: number }
            }
          | {
              readonly type: "tool"
              readonly id: string
              readonly name: string
              readonly provider?: {
                readonly executed: boolean
                readonly metadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
                readonly resultMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
              }
              readonly state:
                | { readonly status: "pending"; readonly input: string }
                | {
                    readonly status: "running"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                  }
                | {
                    readonly status: "completed"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly attachments?: ReadonlyArray<{
                      readonly uri: string
                      readonly mime: string
                      readonly name?: string
                      readonly description?: string
                      readonly source?: { readonly start: number; readonly end: number; readonly text: string }
                    }>
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly outputPaths?: ReadonlyArray<string>
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly result?: JsonValue
                  }
                | {
                    readonly status: "error"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly error: { readonly type: "unknown"; readonly message: string }
                    readonly result?: JsonValue
                  }
              readonly time: {
                readonly created: number
                readonly ran?: number
                readonly completed?: number
                readonly pruned?: number
              }
            }
        >
        readonly snapshot?: { readonly start?: string; readonly end?: string; readonly files?: ReadonlyArray<string> }
        readonly finish?: string
        readonly cost?: number
        readonly tokens?: {
          readonly input: number
          readonly output: number
          readonly reasoning: number
          readonly cache: { readonly read: number; readonly write: number }
        }
        readonly error?: { readonly type: "unknown"; readonly message: string }
      }
    | {
        readonly type: "compaction"
        readonly reason: "auto" | "manual"
        readonly summary: string
        readonly recent: string
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
      }
  >
}["data"]

export type SessionsHistoryInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly limit?: { readonly limit?: number | undefined; readonly after?: number | undefined }["limit"]
  readonly after?: { readonly limit?: number | undefined; readonly after?: number | undefined }["after"]
}

export type SessionsHistoryOutput = {
  readonly data: ReadonlyArray<
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.agent.switched"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly agent: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.model.switched"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.moved"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly location: { readonly directory: string; readonly workspaceID?: string }
          readonly subdirectory?: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.prompted"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly prompt: {
            readonly text: string
            readonly files?: ReadonlyArray<{
              readonly uri: string
              readonly mime: string
              readonly name?: string
              readonly description?: string
              readonly source?: { readonly start: number; readonly end: number; readonly text: string }
            }>
            readonly agents?: ReadonlyArray<{
              readonly name: string
              readonly source?: { readonly start: number; readonly end: number; readonly text: string }
            }>
          }
          readonly delivery: "steer" | "queue"
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.prompt.admitted"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly prompt: {
            readonly text: string
            readonly files?: ReadonlyArray<{
              readonly uri: string
              readonly mime: string
              readonly name?: string
              readonly description?: string
              readonly source?: { readonly start: number; readonly end: number; readonly text: string }
            }>
            readonly agents?: ReadonlyArray<{
              readonly name: string
              readonly source?: { readonly start: number; readonly end: number; readonly text: string }
            }>
          }
          readonly delivery: "steer" | "queue"
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.context.updated"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly text: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.synthetic"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly text: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.shell.started"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly callID: string
          readonly command: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.shell.ended"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly callID: string
          readonly output: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.step.started"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly agent: string
          readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
          readonly snapshot?: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.step.ended"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly finish: string
          readonly cost: number
          readonly tokens: {
            readonly input: number
            readonly output: number
            readonly reasoning: number
            readonly cache: { readonly read: number; readonly write: number }
          }
          readonly snapshot?: string
          readonly files?: ReadonlyArray<string>
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.step.failed"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly error: { readonly type: "unknown"; readonly message: string }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.text.started"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly textID: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.text.ended"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly textID: string
          readonly text: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.tool.input.started"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly callID: string
          readonly name: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.tool.input.ended"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly callID: string
          readonly text: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.tool.called"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly callID: string
          readonly tool: string
          readonly input: { readonly [x: string]: JsonValue }
          readonly provider: {
            readonly executed: boolean
            readonly metadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
          }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.tool.progress"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly callID: string
          readonly structured: { readonly [x: string]: JsonValue }
          readonly content: ReadonlyArray<
            | { readonly type: "text"; readonly text: string }
            | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
          >
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.tool.success"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly callID: string
          readonly structured: { readonly [x: string]: JsonValue }
          readonly content: ReadonlyArray<
            | { readonly type: "text"; readonly text: string }
            | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
          >
          readonly outputPaths?: ReadonlyArray<string>
          readonly result?: JsonValue
          readonly provider: {
            readonly executed: boolean
            readonly metadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
          }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.tool.failed"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly callID: string
          readonly error: { readonly type: "unknown"; readonly message: string }
          readonly result?: JsonValue
          readonly provider: {
            readonly executed: boolean
            readonly metadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
          }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.reasoning.started"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly reasoningID: string
          readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.reasoning.ended"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly assistantMessageID: string
          readonly reasoningID: string
          readonly text: string
          readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.retried"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly attempt: number
          readonly error: {
            readonly message: string
            readonly statusCode?: number
            readonly isRetryable: boolean
            readonly responseHeaders?: { readonly [x: string]: string }
            readonly responseBody?: string
            readonly metadata?: { readonly [x: string]: string }
          }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.compaction.started"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly reason: "auto" | "manual"
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.compaction.ended"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly messageID: string
          readonly reason: "auto" | "manual"
          readonly text: string
          readonly recent: string
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.revert.staged"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: {
          readonly timestamp: number
          readonly sessionID: string
          readonly revert: {
            readonly messageID: string
            readonly partID?: string
            readonly snapshot?: string
            readonly diff?: string
            readonly files?: ReadonlyArray<{
              readonly path: string
              readonly status: "added" | "modified" | "deleted"
              readonly additions: number
              readonly deletions: number
              readonly patch: string
            }>
          }
        }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.revert.cleared"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: { readonly timestamp: number; readonly sessionID: string }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly type: "session.next.revert.committed"
        readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
        readonly location?: { readonly directory: string; readonly workspaceID?: string }
        readonly data: { readonly timestamp: number; readonly sessionID: string; readonly messageID: string }
      }
  >
  readonly hasMore: boolean
}

export type SessionsEventsInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly after?: { readonly after?: number | undefined }["after"]
}

export type SessionsEventsOutput =
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.agent.switched"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly agent: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.model.switched"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.moved"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly location: { readonly directory: string; readonly workspaceID?: string }
        readonly subdirectory?: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.prompted"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly prompt: {
          readonly text: string
          readonly files?: ReadonlyArray<{
            readonly uri: string
            readonly mime: string
            readonly name?: string
            readonly description?: string
            readonly source?: { readonly start: number; readonly end: number; readonly text: string }
          }>
          readonly agents?: ReadonlyArray<{
            readonly name: string
            readonly source?: { readonly start: number; readonly end: number; readonly text: string }
          }>
        }
        readonly delivery: "steer" | "queue"
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.prompt.admitted"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly prompt: {
          readonly text: string
          readonly files?: ReadonlyArray<{
            readonly uri: string
            readonly mime: string
            readonly name?: string
            readonly description?: string
            readonly source?: { readonly start: number; readonly end: number; readonly text: string }
          }>
          readonly agents?: ReadonlyArray<{
            readonly name: string
            readonly source?: { readonly start: number; readonly end: number; readonly text: string }
          }>
        }
        readonly delivery: "steer" | "queue"
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.context.updated"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly text: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.synthetic"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly text: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.shell.started"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly callID: string
        readonly command: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.shell.ended"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly callID: string
        readonly output: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.step.started"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly agent: string
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly snapshot?: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.step.ended"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly finish: string
        readonly cost: number
        readonly tokens: {
          readonly input: number
          readonly output: number
          readonly reasoning: number
          readonly cache: { readonly read: number; readonly write: number }
        }
        readonly snapshot?: string
        readonly files?: ReadonlyArray<string>
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.step.failed"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly error: { readonly type: "unknown"; readonly message: string }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.text.started"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly textID: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.text.ended"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly textID: string
        readonly text: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.tool.input.started"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly name: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.tool.input.ended"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly text: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.tool.called"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly tool: string
        readonly input: { readonly [x: string]: unknown }
        readonly provider: {
          readonly executed: boolean
          readonly metadata?: { readonly [x: string]: { readonly [x: string]: unknown } }
        }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.tool.progress"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly structured: { readonly [x: string]: unknown }
        readonly content: ReadonlyArray<
          | { readonly type: "text"; readonly text: string }
          | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
        >
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.tool.success"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly structured: { readonly [x: string]: unknown }
        readonly content: ReadonlyArray<
          | { readonly type: "text"; readonly text: string }
          | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
        >
        readonly outputPaths?: ReadonlyArray<string>
        readonly result?: unknown
        readonly provider: {
          readonly executed: boolean
          readonly metadata?: { readonly [x: string]: { readonly [x: string]: unknown } }
        }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.tool.failed"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly callID: string
        readonly error: { readonly type: "unknown"; readonly message: string }
        readonly result?: unknown
        readonly provider: {
          readonly executed: boolean
          readonly metadata?: { readonly [x: string]: { readonly [x: string]: unknown } }
        }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.reasoning.started"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly reasoningID: string
        readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: unknown } }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.reasoning.ended"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly assistantMessageID: string
        readonly reasoningID: string
        readonly text: string
        readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: unknown } }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.retried"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly attempt: number
        readonly error: {
          readonly message: string
          readonly statusCode?: number
          readonly isRetryable: boolean
          readonly responseHeaders?: { readonly [x: string]: string }
          readonly responseBody?: string
          readonly metadata?: { readonly [x: string]: string }
        }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.compaction.started"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly reason: "auto" | "manual"
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.compaction.ended"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly messageID: string
        readonly reason: "auto" | "manual"
        readonly text: string
        readonly recent: string
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.revert.staged"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: {
        readonly timestamp: number
        readonly sessionID: string
        readonly revert: {
          readonly messageID: string
          readonly partID?: string
          readonly snapshot?: string
          readonly diff?: string
          readonly files?: ReadonlyArray<{
            readonly path: string
            readonly status: "added" | "modified" | "deleted"
            readonly additions: number
            readonly deletions: number
            readonly patch: string
          }>
        }
      }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.revert.cleared"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly timestamp: number; readonly sessionID: string }
    }
  | {
      readonly id: string
      readonly metadata?: { readonly [x: string]: unknown }
      readonly type: "session.next.revert.committed"
      readonly durable?: { readonly aggregateID: string; readonly seq: number; readonly version: number }
      readonly location?: { readonly directory: string; readonly workspaceID?: string }
      readonly data: { readonly timestamp: number; readonly sessionID: string; readonly messageID: string }
    }

export type SessionsInterruptInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionsInterruptOutput = void

export type SessionsMessageInput = {
  readonly sessionID: { readonly sessionID: string; readonly messageID: string }["sessionID"]
  readonly messageID: { readonly sessionID: string; readonly messageID: string }["messageID"]
}

export type SessionsMessageOutput = {
  readonly data:
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "agent-switched"
        readonly agent: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "model-switched"
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly text: string
        readonly files?: ReadonlyArray<{
          readonly uri: string
          readonly mime: string
          readonly name?: string
          readonly description?: string
          readonly source?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly agents?: ReadonlyArray<{
          readonly name: string
          readonly source?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly type: "user"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly sessionID: string
        readonly text: string
        readonly type: "synthetic"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "system"
        readonly text: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "shell"
        readonly callID: string
        readonly command: string
        readonly output: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "assistant"
        readonly agent: string
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly content: ReadonlyArray<
          | { readonly type: "text"; readonly id: string; readonly text: string }
          | {
              readonly type: "reasoning"
              readonly id: string
              readonly text: string
              readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
              readonly time?: { readonly created: number; readonly completed?: number }
            }
          | {
              readonly type: "tool"
              readonly id: string
              readonly name: string
              readonly provider?: {
                readonly executed: boolean
                readonly metadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
                readonly resultMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
              }
              readonly state:
                | { readonly status: "pending"; readonly input: string }
                | {
                    readonly status: "running"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                  }
                | {
                    readonly status: "completed"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly attachments?: ReadonlyArray<{
                      readonly uri: string
                      readonly mime: string
                      readonly name?: string
                      readonly description?: string
                      readonly source?: { readonly start: number; readonly end: number; readonly text: string }
                    }>
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly outputPaths?: ReadonlyArray<string>
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly result?: JsonValue
                  }
                | {
                    readonly status: "error"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly error: { readonly type: "unknown"; readonly message: string }
                    readonly result?: JsonValue
                  }
              readonly time: {
                readonly created: number
                readonly ran?: number
                readonly completed?: number
                readonly pruned?: number
              }
            }
        >
        readonly snapshot?: { readonly start?: string; readonly end?: string; readonly files?: ReadonlyArray<string> }
        readonly finish?: string
        readonly cost?: number
        readonly tokens?: {
          readonly input: number
          readonly output: number
          readonly reasoning: number
          readonly cache: { readonly read: number; readonly write: number }
        }
        readonly error?: { readonly type: "unknown"; readonly message: string }
      }
    | {
        readonly type: "compaction"
        readonly reason: "auto" | "manual"
        readonly summary: string
        readonly recent: string
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
      }
}["data"]

export type MessagesListInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly limit?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly cursor?: string | undefined
  }["limit"]
  readonly order?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly cursor?: string | undefined
  }["order"]
  readonly cursor?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly cursor?: string | undefined
  }["cursor"]
}

export type MessagesListOutput = {
  readonly data: ReadonlyArray<
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "agent-switched"
        readonly agent: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "model-switched"
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly text: string
        readonly files?: ReadonlyArray<{
          readonly uri: string
          readonly mime: string
          readonly name?: string
          readonly description?: string
          readonly source?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly agents?: ReadonlyArray<{
          readonly name: string
          readonly source?: { readonly start: number; readonly end: number; readonly text: string }
        }>
        readonly type: "user"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly sessionID: string
        readonly text: string
        readonly type: "synthetic"
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
        readonly type: "system"
        readonly text: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "shell"
        readonly callID: string
        readonly command: string
        readonly output: string
      }
    | {
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number; readonly completed?: number }
        readonly type: "assistant"
        readonly agent: string
        readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
        readonly content: ReadonlyArray<
          | { readonly type: "text"; readonly id: string; readonly text: string }
          | {
              readonly type: "reasoning"
              readonly id: string
              readonly text: string
              readonly providerMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
              readonly time?: { readonly created: number; readonly completed?: number }
            }
          | {
              readonly type: "tool"
              readonly id: string
              readonly name: string
              readonly provider?: {
                readonly executed: boolean
                readonly metadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
                readonly resultMetadata?: { readonly [x: string]: { readonly [x: string]: JsonValue } }
              }
              readonly state:
                | { readonly status: "pending"; readonly input: string }
                | {
                    readonly status: "running"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                  }
                | {
                    readonly status: "completed"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly attachments?: ReadonlyArray<{
                      readonly uri: string
                      readonly mime: string
                      readonly name?: string
                      readonly description?: string
                      readonly source?: { readonly start: number; readonly end: number; readonly text: string }
                    }>
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly outputPaths?: ReadonlyArray<string>
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly result?: JsonValue
                  }
                | {
                    readonly status: "error"
                    readonly input: { readonly [x: string]: JsonValue }
                    readonly content: ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
                    >
                    readonly structured: { readonly [x: string]: JsonValue }
                    readonly error: { readonly type: "unknown"; readonly message: string }
                    readonly result?: JsonValue
                  }
              readonly time: {
                readonly created: number
                readonly ran?: number
                readonly completed?: number
                readonly pruned?: number
              }
            }
        >
        readonly snapshot?: { readonly start?: string; readonly end?: string; readonly files?: ReadonlyArray<string> }
        readonly finish?: string
        readonly cost?: number
        readonly tokens?: {
          readonly input: number
          readonly output: number
          readonly reasoning: number
          readonly cache: { readonly read: number; readonly write: number }
        }
        readonly error?: { readonly type: "unknown"; readonly message: string }
      }
    | {
        readonly type: "compaction"
        readonly reason: "auto" | "manual"
        readonly summary: string
        readonly recent: string
        readonly id: string
        readonly metadata?: { readonly [x: string]: JsonValue }
        readonly time: { readonly created: number }
      }
  >
  readonly cursor: { readonly previous?: string | null; readonly next?: string | null }
}

export type ModelsListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ModelsListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly providerID: string
    readonly family?: string
    readonly name: string
    readonly api:
      | {
          readonly id: string
          readonly type: "aisdk"
          readonly package: string
          readonly url?: string
          readonly settings?: { readonly [x: string]: JsonValue }
        }
      | {
          readonly id: string
          readonly type: "native"
          readonly url?: string
          readonly settings: { readonly [x: string]: JsonValue }
        }
    readonly capabilities: {
      readonly tools: boolean
      readonly input: ReadonlyArray<string>
      readonly output: ReadonlyArray<string>
    }
    readonly request: {
      readonly headers: { readonly [x: string]: string }
      readonly body: { readonly [x: string]: JsonValue }
      readonly variant?: string
    }
    readonly variants: ReadonlyArray<{
      readonly id: string
      readonly headers: { readonly [x: string]: string }
      readonly body: { readonly [x: string]: JsonValue }
    }>
    readonly time: { readonly released: number }
    readonly cost: ReadonlyArray<{
      readonly tier?: { readonly type: "context"; readonly size: number }
      readonly input: number
      readonly output: number
      readonly cache: { readonly read: number; readonly write: number }
    }>
    readonly status: "alpha" | "beta" | "deprecated" | "active"
    readonly enabled: boolean
    readonly runtime?: { readonly instanceID?: string; readonly sizeBytes?: number | "Infinity" | "-Infinity" | "NaN" }
    readonly limit: { readonly context: number; readonly input?: number; readonly output: number }
  }>
}

export type ProvidersListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ProvidersListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly integrationID?: string
    readonly name: string
    readonly disabled?: boolean
    readonly api:
      | {
          readonly type: "aisdk"
          readonly package: string
          readonly url?: string
          readonly settings?: { readonly [x: string]: JsonValue }
        }
      | { readonly type: "native"; readonly url?: string; readonly settings: { readonly [x: string]: JsonValue } }
    readonly request: {
      readonly headers: { readonly [x: string]: string }
      readonly body: { readonly [x: string]: JsonValue }
    }
  }>
}

export type ProvidersGetInput = {
  readonly providerID: { readonly providerID: string }["providerID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ProvidersGetOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly integrationID?: string
    readonly name: string
    readonly disabled?: boolean
    readonly api:
      | {
          readonly type: "aisdk"
          readonly package: string
          readonly url?: string
          readonly settings?: { readonly [x: string]: JsonValue }
        }
      | { readonly type: "native"; readonly url?: string; readonly settings: { readonly [x: string]: JsonValue } }
    readonly request: {
      readonly headers: { readonly [x: string]: string }
      readonly body: { readonly [x: string]: JsonValue }
    }
  }
}

export type IntegrationsListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type IntegrationsListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly methods: ReadonlyArray<
      | {
          readonly id: string
          readonly type: "oauth"
          readonly label: string
          readonly prompts?: ReadonlyArray<
            | {
                readonly type: "text"
                readonly key: string
                readonly message: string
                readonly placeholder?: string
                readonly when?: { readonly key: string; readonly op: "eq" | "neq"; readonly value: string }
              }
            | {
                readonly type: "select"
                readonly key: string
                readonly message: string
                readonly options: ReadonlyArray<{
                  readonly label: string
                  readonly value: string
                  readonly hint?: string
                }>
                readonly when?: { readonly key: string; readonly op: "eq" | "neq"; readonly value: string }
              }
          >
        }
      | { readonly type: "key"; readonly label?: string }
      | { readonly type: "env"; readonly names: ReadonlyArray<string> }
    >
    readonly connections: ReadonlyArray<
      | { readonly type: "credential"; readonly id: string; readonly label: string }
      | { readonly type: "env"; readonly name: string }
    >
  }>
}

export type IntegrationsGetInput = {
  readonly integrationID: { readonly integrationID: string }["integrationID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type IntegrationsGetOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly name: string
    readonly methods: ReadonlyArray<
      | {
          readonly id: string
          readonly type: "oauth"
          readonly label: string
          readonly prompts?: ReadonlyArray<
            | {
                readonly type: "text"
                readonly key: string
                readonly message: string
                readonly placeholder?: string
                readonly when?: { readonly key: string; readonly op: "eq" | "neq"; readonly value: string }
              }
            | {
                readonly type: "select"
                readonly key: string
                readonly message: string
                readonly options: ReadonlyArray<{
                  readonly label: string
                  readonly value: string
                  readonly hint?: string
                }>
                readonly when?: { readonly key: string; readonly op: "eq" | "neq"; readonly value: string }
              }
          >
        }
      | { readonly type: "key"; readonly label?: string }
      | { readonly type: "env"; readonly names: ReadonlyArray<string> }
    >
    readonly connections: ReadonlyArray<
      | { readonly type: "credential"; readonly id: string; readonly label: string }
      | { readonly type: "env"; readonly name: string }
    >
  } | null
}

export type IntegrationsConnectKeyInput = {
  readonly integrationID: { readonly integrationID: string }["integrationID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly key: { readonly key: string; readonly label?: string | undefined }["key"]
  readonly label?: { readonly key: string; readonly label?: string | undefined }["label"]
}

export type IntegrationsConnectKeyOutput = void

export type IntegrationsConnectOauthInput = {
  readonly integrationID: { readonly integrationID: string }["integrationID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly methodID: {
    readonly methodID: string
    readonly inputs: { readonly [x: string]: string }
    readonly label?: string | undefined
  }["methodID"]
  readonly inputs: {
    readonly methodID: string
    readonly inputs: { readonly [x: string]: string }
    readonly label?: string | undefined
  }["inputs"]
  readonly label?: {
    readonly methodID: string
    readonly inputs: { readonly [x: string]: string }
    readonly label?: string | undefined
  }["label"]
}

export type IntegrationsConnectOauthOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly attemptID: string
    readonly url: string
    readonly instructions: string
    readonly mode: "auto" | "code"
    readonly time: {
      readonly created: number | "Infinity" | "-Infinity" | "NaN"
      readonly expires: number | "Infinity" | "-Infinity" | "NaN"
    }
  }
}

export type IntegrationsAttemptStatusInput = {
  readonly attemptID: { readonly attemptID: string }["attemptID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type IntegrationsAttemptStatusOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data:
    | {
        readonly status: "pending"
        readonly time: {
          readonly created: number | "Infinity" | "-Infinity" | "NaN"
          readonly expires: number | "Infinity" | "-Infinity" | "NaN"
        }
      }
    | {
        readonly status: "complete"
        readonly time: {
          readonly created: number | "Infinity" | "-Infinity" | "NaN"
          readonly expires: number | "Infinity" | "-Infinity" | "NaN"
        }
      }
    | {
        readonly status: "failed"
        readonly message: string
        readonly time: {
          readonly created: number | "Infinity" | "-Infinity" | "NaN"
          readonly expires: number | "Infinity" | "-Infinity" | "NaN"
        }
      }
    | {
        readonly status: "expired"
        readonly time: {
          readonly created: number | "Infinity" | "-Infinity" | "NaN"
          readonly expires: number | "Infinity" | "-Infinity" | "NaN"
        }
      }
}

export type IntegrationsAttemptCompleteInput = {
  readonly attemptID: { readonly attemptID: string }["attemptID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly code?: { readonly code?: string | undefined }["code"]
}

export type IntegrationsAttemptCompleteOutput = void

export type IntegrationsAttemptCancelInput = {
  readonly attemptID: { readonly attemptID: string }["attemptID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type IntegrationsAttemptCancelOutput = void

export type CredentialsUpdateInput = {
  readonly credentialID: { readonly credentialID: string }["credentialID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly label: { readonly label: string }["label"]
}

export type CredentialsUpdateOutput = void

export type CredentialsRemoveInput = {
  readonly credentialID: { readonly credentialID: string }["credentialID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type CredentialsRemoveOutput = void

export type PermissionsListRequestsInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PermissionsListRequestsOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly sessionID: string
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
  }>
}

export type PermissionsListSavedInput = {
  readonly projectID?: { readonly projectID?: string | undefined }["projectID"]
}

export type PermissionsListSavedOutput = {
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly projectID: string
    readonly action: string
    readonly resource: string
  }>
}["data"]

export type PermissionsRemoveSavedInput = { readonly id: { readonly id: string }["id"] }

export type PermissionsRemoveSavedOutput = void

export type PermissionsCreateInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["id"]
  readonly action: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["action"]
  readonly resources: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["resources"]
  readonly save?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["save"]
  readonly metadata?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["metadata"]
  readonly source?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["source"]
  readonly agent?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
    readonly agent?: string | null
  }["agent"]
}

export type PermissionsCreateOutput = {
  readonly data: { readonly id: string; readonly effect: "allow" | "deny" | "ask" }
}["data"]

export type PermissionsListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type PermissionsListOutput = {
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly sessionID: string
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
  }>
}["data"]

export type PermissionsGetInput = {
  readonly sessionID: { readonly sessionID: string; readonly requestID: string }["sessionID"]
  readonly requestID: { readonly sessionID: string; readonly requestID: string }["requestID"]
}

export type PermissionsGetOutput = {
  readonly data: {
    readonly id: string
    readonly sessionID: string
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
  }
}["data"]

export type PermissionsReplyInput = {
  readonly sessionID: { readonly sessionID: string; readonly requestID: string }["sessionID"]
  readonly requestID: { readonly sessionID: string; readonly requestID: string }["requestID"]
  readonly reply: { readonly reply: "once" | "always" | "reject"; readonly message?: string | undefined }["reply"]
  readonly message?: { readonly reply: "once" | "always" | "reject"; readonly message?: string | undefined }["message"]
}

export type PermissionsReplyOutput = void

export type FilesListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly path?: string | undefined
  }["location"]
  readonly path?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly path?: string | undefined
  }["path"]
}

export type FilesListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{ readonly path: string; readonly type: "file" | "directory" }>
}

export type FilesFindInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly query: string
    readonly type?: "file" | "directory" | undefined
    readonly limit?: number | undefined
  }["location"]
  readonly query: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly query: string
    readonly type?: "file" | "directory" | undefined
    readonly limit?: number | undefined
  }["query"]
  readonly type?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly query: string
    readonly type?: "file" | "directory" | undefined
    readonly limit?: number | undefined
  }["type"]
  readonly limit?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly query: string
    readonly type?: "file" | "directory" | undefined
    readonly limit?: number | undefined
  }["limit"]
}

export type FilesFindOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{ readonly path: string; readonly type: "file" | "directory" }>
}

export type CommandsListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type CommandsListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly name: string
    readonly template: string
    readonly description?: string
    readonly agent?: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly subtask?: boolean
  }>
}

export type SkillsListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type SkillsListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly name: string
    readonly description?: string
    readonly slash?: boolean
    readonly location: string
    readonly content: string
  }>
}

export type EventsSubscribeOutput = OpenCodeEventEncoded

export type PtysListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PtysListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly title: string
    readonly command: string
    readonly args: ReadonlyArray<string>
    readonly cwd: string
    readonly status: "running" | "exited"
    readonly pid: number
    readonly exitCode?: number
  }>
}

export type PtysCreateInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly command?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["command"]
  readonly args?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["args"]
  readonly cwd?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["cwd"]
  readonly title?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["title"]
  readonly env?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["env"]
}

export type PtysCreateOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly title: string
    readonly command: string
    readonly args: ReadonlyArray<string>
    readonly cwd: string
    readonly status: "running" | "exited"
    readonly pid: number
    readonly exitCode?: number
  }
}

export type PtysGetInput = {
  readonly ptyID: { readonly ptyID: string }["ptyID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PtysGetOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly title: string
    readonly command: string
    readonly args: ReadonlyArray<string>
    readonly cwd: string
    readonly status: "running" | "exited"
    readonly pid: number
    readonly exitCode?: number
  }
}

export type PtysUpdateInput = {
  readonly ptyID: { readonly ptyID: string }["ptyID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly title?: {
    readonly title?: string
    readonly size?: { readonly rows: number; readonly cols: number }
  }["title"]
  readonly size?: { readonly title?: string; readonly size?: { readonly rows: number; readonly cols: number } }["size"]
}

export type PtysUpdateOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly id: string
    readonly title: string
    readonly command: string
    readonly args: ReadonlyArray<string>
    readonly cwd: string
    readonly status: "running" | "exited"
    readonly pid: number
    readonly exitCode?: number
  }
}

export type PtysRemoveInput = {
  readonly ptyID: { readonly ptyID: string }["ptyID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type PtysRemoveOutput = void

export type QuestionsListRequestsInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type QuestionsListRequestsOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly sessionID: string
    readonly questions: ReadonlyArray<{
      readonly question: string
      readonly header: string
      readonly options: ReadonlyArray<{ readonly label: string; readonly description: string }>
      readonly multiple?: boolean
      readonly custom?: boolean
    }>
    readonly tool?: { readonly messageID: string; readonly callID: string }
  }>
}

export type QuestionsListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type QuestionsListOutput = {
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly sessionID: string
    readonly questions: ReadonlyArray<{
      readonly question: string
      readonly header: string
      readonly options: ReadonlyArray<{ readonly label: string; readonly description: string }>
      readonly multiple?: boolean
      readonly custom?: boolean
    }>
    readonly tool?: { readonly messageID: string; readonly callID: string }
  }>
}["data"]

export type QuestionsReplyInput = {
  readonly sessionID: { readonly sessionID: string; readonly requestID: string }["sessionID"]
  readonly requestID: { readonly sessionID: string; readonly requestID: string }["requestID"]
  readonly answers: { readonly answers: ReadonlyArray<ReadonlyArray<string>> }["answers"]
}

export type QuestionsReplyOutput = void

export type QuestionsRejectInput = {
  readonly sessionID: { readonly sessionID: string; readonly requestID: string }["sessionID"]
  readonly requestID: { readonly sessionID: string; readonly requestID: string }["requestID"]
}

export type QuestionsRejectOutput = void

export type ReferencesListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ReferencesListOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: ReadonlyArray<{
    readonly name: string
    readonly path: string
    readonly description?: string
    readonly hidden?: boolean
    readonly source:
      | { readonly type: "local"; readonly path: string; readonly description?: string; readonly hidden?: boolean }
      | {
          readonly type: "git"
          readonly repository: string
          readonly branch?: string
          readonly description?: string
          readonly hidden?: boolean
        }
  }>
}

export type ProjectCopiesCreateInput = {
  readonly projectID: { readonly projectID: string }["projectID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly strategy: { readonly strategy: string; readonly directory: string; readonly name?: string }["strategy"]
  readonly directory: { readonly strategy: string; readonly directory: string; readonly name?: string }["directory"]
  readonly name?: { readonly strategy: string; readonly directory: string; readonly name?: string }["name"]
}

export type ProjectCopiesCreateOutput = { readonly directory: string }

export type ProjectCopiesRemoveInput = {
  readonly projectID: { readonly projectID: string }["projectID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly directory: { readonly directory: string; readonly force: boolean }["directory"]
  readonly force: { readonly directory: string; readonly force: boolean }["force"]
}

export type ProjectCopiesRemoveOutput = void

export type ProjectCopiesRefreshInput = {
  readonly projectID: { readonly projectID: string }["projectID"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type ProjectCopiesRefreshOutput = void

export type RepositoryMapGetInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type RepositoryMapGetOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly status: "complete" | "truncated" | "unavailable"
    readonly files: number
    readonly languages: ReadonlyArray<{ readonly name: string; readonly files: number }>
    readonly modules: ReadonlyArray<{
      readonly path: string
      readonly name?: string
      readonly files: number
      readonly manifests: ReadonlyArray<string>
      readonly entrypoints: ReadonlyArray<string>
    }>
    readonly relationships: ReadonlyArray<{ readonly from: string; readonly to: string; readonly references: number }>
    readonly landmarks: ReadonlyArray<{
      readonly kind: "routes" | "controllers" | "components" | "config" | "schema" | "migrations"
      readonly path: string
    }>
    readonly symbols: ReadonlyArray<{
      readonly name: string
      readonly kind: "class" | "function" | "interface" | "type" | "enum" | "variable" | "export"
      readonly path: string
      readonly line: number
      readonly source: "syntax" | "lsp"
    }>
    readonly edges: ReadonlyArray<{
      readonly from: string
      readonly to: string
      readonly kind: "import" | "reference" | "call"
      readonly references: number
    }>
    readonly semantic: {
      readonly status: "indexing" | "ready" | "unavailable"
      readonly files: number
      readonly servers: ReadonlyArray<string>
    }
  }
}

export type RepositoryMapRefreshInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type RepositoryMapRefreshOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly status: "complete" | "truncated" | "unavailable"
    readonly files: number
    readonly languages: ReadonlyArray<{ readonly name: string; readonly files: number }>
    readonly modules: ReadonlyArray<{
      readonly path: string
      readonly name?: string
      readonly files: number
      readonly manifests: ReadonlyArray<string>
      readonly entrypoints: ReadonlyArray<string>
    }>
    readonly relationships: ReadonlyArray<{ readonly from: string; readonly to: string; readonly references: number }>
    readonly landmarks: ReadonlyArray<{
      readonly kind: "routes" | "controllers" | "components" | "config" | "schema" | "migrations"
      readonly path: string
    }>
    readonly symbols: ReadonlyArray<{
      readonly name: string
      readonly kind: "class" | "function" | "interface" | "type" | "enum" | "variable" | "export"
      readonly path: string
      readonly line: number
      readonly source: "syntax" | "lsp"
    }>
    readonly edges: ReadonlyArray<{
      readonly from: string
      readonly to: string
      readonly kind: "import" | "reference" | "call"
      readonly references: number
    }>
    readonly semantic: {
      readonly status: "indexing" | "ready" | "unavailable"
      readonly files: number
      readonly servers: ReadonlyArray<string>
    }
  }
}

export type RepositoryMapDiagnosticsInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type RepositoryMapDiagnosticsOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly enabled: boolean
    readonly entries: ReadonlyArray<{
      readonly id: number
      readonly time: number
      readonly level: "info" | "warning" | "error"
      readonly stage: string
      readonly message: string
    }>
  }
}

export type RepositoryMapConfigureDiagnosticsInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly enabled: { readonly enabled: boolean; readonly clear?: boolean }["enabled"]
  readonly clear?: { readonly enabled: boolean; readonly clear?: boolean }["clear"]
}

export type RepositoryMapConfigureDiagnosticsOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly enabled: boolean
    readonly entries: ReadonlyArray<{
      readonly id: number
      readonly time: number
      readonly level: "info" | "warning" | "error"
      readonly stage: string
      readonly message: string
    }>
  }
}

export type RepositoryMapKnowledgeInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly search?: string | undefined
    readonly limit?: number | undefined
  }["location"]
  readonly search?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly search?: string | undefined
    readonly limit?: number | undefined
  }["search"]
  readonly limit?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
    readonly search?: string | undefined
    readonly limit?: number | undefined
  }["limit"]
}

export type RepositoryMapKnowledgeOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly memory: {
      readonly total: number
      readonly matched: number
      readonly entries: ReadonlyArray<{
        readonly id: string
        readonly kind: "route" | "summary" | "conversation"
        readonly text: string
        readonly terms: ReadonlyArray<string>
        readonly files: ReadonlyArray<string>
        readonly updatedAt: number
        readonly embeddingModel?: string
        readonly dimensions: number
        readonly category?: "identity" | "preference" | "constraint" | "decision" | "context"
        readonly topic?: string
        readonly confidence?: number | "Infinity" | "-Infinity" | "NaN"
        readonly source?: "classifier" | "answer" | "manual" | "route" | "compaction"
        readonly evidence?: string
        readonly originProject?: string
        readonly scope?: "global" | "cross-project" | "project" | "session" | "pattern"
        readonly scopeID?: string
        readonly lifecycle?: "candidate" | "verified" | "durable" | "rejected" | "expired" | "archived"
        readonly createdAt?: number
        readonly verifiedAt?: number
        readonly ttl?: number
        readonly classification?: "fact" | "analogy"
        readonly status?: "active" | "conflict"
        readonly conflictsWith?: string
        readonly conflicts?: ReadonlyArray<string>
        readonly pinned?: boolean
        readonly expiresAt?: number
        readonly lastUsedAt?: number
        readonly useCount?: number
        readonly confirmationCount?: number
        readonly lastQuery?: string
        readonly matchReason?: "lexical" | "semantic"
        readonly usage?: ReadonlyArray<{
          readonly at: number
          readonly query: string
          readonly reason: "lexical" | "semantic"
          readonly project: string
          readonly classification: "fact" | "analogy"
        }>
      }>
    }
    readonly rag: {
      readonly model?: string
      readonly total: number
      readonly matched: number
      readonly files: number
      readonly entries: ReadonlyArray<{
        readonly id: string
        readonly path: string
        readonly start: number
        readonly end: number
        readonly fileHash: string
        readonly updatedAt: number
        readonly dimensions: number
      }>
    }
    readonly retrieval: {
      readonly total: number
      readonly matched: number
      readonly recallAt5?: number | "Infinity" | "-Infinity" | "NaN"
      readonly recallAt10?: number | "Infinity" | "-Infinity" | "NaN"
      readonly entries: ReadonlyArray<{
        readonly id: string
        readonly query: string
        readonly files: ReadonlyArray<{
          readonly path: string
          readonly score: number | "Infinity" | "-Infinity" | "NaN"
          readonly confidence: number | "Infinity" | "-Infinity" | "NaN"
          readonly classification: "fact" | "assumption" | "analogy"
          readonly reasons: ReadonlyArray<{
            readonly stage:
              | "attachment"
              | "exact"
              | "lexical"
              | "concept"
              | "embedding"
              | "lsp"
              | "graph"
              | "memory"
              | "analogy"
            readonly detail: string
            readonly weight: number | "Infinity" | "-Infinity" | "NaN"
          }>
          readonly used?: boolean
          readonly rejected?: boolean
        }>
        readonly createdAt: number
        readonly updatedAt: number
        readonly recallAt5?: number | "Infinity" | "-Infinity" | "NaN"
        readonly recallAt10?: number | "Infinity" | "-Infinity" | "NaN"
      }>
    }
  }
}

export type RepositoryMapRemoveKnowledgeInput = {
  readonly scope: { readonly scope: "memory" | "rag" | "retrieval"; readonly id: string }["scope"]
  readonly id: { readonly scope: "memory" | "rag" | "retrieval"; readonly id: string }["id"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type RepositoryMapRemoveKnowledgeOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: { readonly removed: number }
}

export type RepositoryMapUpdateMemoryInput = {
  readonly id: { readonly id: string }["id"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly pinned?: {
    readonly pinned?: boolean
    readonly expiresAt?: number
    readonly clearExpiration?: boolean
    readonly resolve?: boolean
    readonly lifecycle?: "candidate" | "verified" | "durable" | "rejected" | "expired" | "archived"
  }["pinned"]
  readonly expiresAt?: {
    readonly pinned?: boolean
    readonly expiresAt?: number
    readonly clearExpiration?: boolean
    readonly resolve?: boolean
    readonly lifecycle?: "candidate" | "verified" | "durable" | "rejected" | "expired" | "archived"
  }["expiresAt"]
  readonly clearExpiration?: {
    readonly pinned?: boolean
    readonly expiresAt?: number
    readonly clearExpiration?: boolean
    readonly resolve?: boolean
    readonly lifecycle?: "candidate" | "verified" | "durable" | "rejected" | "expired" | "archived"
  }["clearExpiration"]
  readonly resolve?: {
    readonly pinned?: boolean
    readonly expiresAt?: number
    readonly clearExpiration?: boolean
    readonly resolve?: boolean
    readonly lifecycle?: "candidate" | "verified" | "durable" | "rejected" | "expired" | "archived"
  }["resolve"]
  readonly lifecycle?: {
    readonly pinned?: boolean
    readonly expiresAt?: number
    readonly clearExpiration?: boolean
    readonly resolve?: boolean
    readonly lifecycle?: "candidate" | "verified" | "durable" | "rejected" | "expired" | "archived"
  }["lifecycle"]
}

export type RepositoryMapUpdateMemoryOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: { readonly removed: number }
}

export type RepositoryMapPreviewMemoryConsolidationInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type RepositoryMapPreviewMemoryConsolidationOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly fingerprint: string
    readonly generatedAt: number
    readonly total: number
    readonly protected: number
    readonly actionable: number
    readonly unresolved: number
    readonly actions: ReadonlyArray<{
      readonly type:
        | "merge_duplicate"
        | "resolve_conflict"
        | "decrease_confidence"
        | "increase_confidence"
        | "archive_unused"
        | "unresolved_conflict"
      readonly id: string
      readonly relatedIDs: ReadonlyArray<string>
      readonly reason: string
      readonly beforeConfidence?: number | "Infinity" | "-Infinity" | "NaN"
      readonly afterConfidence?: number | "Infinity" | "-Infinity" | "NaN"
      readonly winnerID?: string
    }>
  }
}

export type RepositoryMapApplyMemoryConsolidationInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly fingerprint: { readonly fingerprint: string; readonly generatedAt: number }["fingerprint"]
  readonly generatedAt: { readonly fingerprint: string; readonly generatedAt: number }["generatedAt"]
}

export type RepositoryMapApplyMemoryConsolidationOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: {
    readonly applied: boolean
    readonly stale: boolean
    readonly removed: number
    readonly updated: number
    readonly archived: number
    readonly preview: {
      readonly fingerprint: string
      readonly generatedAt: number
      readonly total: number
      readonly protected: number
      readonly actionable: number
      readonly unresolved: number
      readonly actions: ReadonlyArray<{
        readonly type:
          | "merge_duplicate"
          | "resolve_conflict"
          | "decrease_confidence"
          | "increase_confidence"
          | "archive_unused"
          | "unresolved_conflict"
        readonly id: string
        readonly relatedIDs: ReadonlyArray<string>
        readonly reason: string
        readonly beforeConfidence?: number | "Infinity" | "-Infinity" | "NaN"
        readonly afterConfidence?: number | "Infinity" | "-Infinity" | "NaN"
        readonly winnerID?: string
      }>
    }
  }
}

export type RepositoryMapFeedbackRetrievalInput = {
  readonly id: { readonly id: string }["id"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
  readonly path: { readonly path: string; readonly relevance: "used" | "rejected" | "clear" }["path"]
  readonly relevance: { readonly path: string; readonly relevance: "used" | "rejected" | "clear" }["relevance"]
}

export type RepositoryMapFeedbackRetrievalOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: { readonly removed: number }
}

export type RepositoryMapClearKnowledgeInput = {
  readonly scope: { readonly scope: "memory" | "rag" | "retrieval" }["scope"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined; readonly workspace?: string | undefined } | undefined
  }["location"]
}

export type RepositoryMapClearKnowledgeOutput = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: { readonly id: string; readonly directory: string }
  }
  readonly data: { readonly removed: number }
}

export type ServerJarvisConversationOutput = {
  readonly sessionID: string
  readonly profileID?: string
  readonly profileRevision?: number
  readonly recoveredAt?: number
  readonly updatedAt: number
}

export type ServerJarvisAdoptConversationInput = {
  readonly sessionID?: {
    readonly sessionID?: string
    readonly profileID?: string
    readonly profileRevision?: number
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
  }["sessionID"]
  readonly profileID?: {
    readonly sessionID?: string
    readonly profileID?: string
    readonly profileRevision?: number
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
  }["profileID"]
  readonly profileRevision?: {
    readonly sessionID?: string
    readonly profileID?: string
    readonly profileRevision?: number
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
  }["profileRevision"]
  readonly surface: {
    readonly sessionID?: string
    readonly profileID?: string
    readonly profileRevision?: number
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
  }["surface"]
}

export type ServerJarvisAdoptConversationOutput = {
  readonly sessionID: string
  readonly profileID?: string
  readonly profileRevision?: number
  readonly recoveredAt?: number
  readonly updatedAt: number
}

export type ServerJarvisPrewarmInput = {
  readonly turnID?: {
    readonly turnID?: string
    readonly requestID: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly text: string
    readonly sequence: number
    readonly language?: string
    readonly profileRevision?: number
    readonly worldContext?: string
    readonly capturedAt: number
  }["turnID"]
  readonly requestID: {
    readonly turnID?: string
    readonly requestID: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly text: string
    readonly sequence: number
    readonly language?: string
    readonly profileRevision?: number
    readonly worldContext?: string
    readonly capturedAt: number
  }["requestID"]
  readonly surface: {
    readonly turnID?: string
    readonly requestID: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly text: string
    readonly sequence: number
    readonly language?: string
    readonly profileRevision?: number
    readonly worldContext?: string
    readonly capturedAt: number
  }["surface"]
  readonly text: {
    readonly turnID?: string
    readonly requestID: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly text: string
    readonly sequence: number
    readonly language?: string
    readonly profileRevision?: number
    readonly worldContext?: string
    readonly capturedAt: number
  }["text"]
  readonly sequence: {
    readonly turnID?: string
    readonly requestID: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly text: string
    readonly sequence: number
    readonly language?: string
    readonly profileRevision?: number
    readonly worldContext?: string
    readonly capturedAt: number
  }["sequence"]
  readonly language?: {
    readonly turnID?: string
    readonly requestID: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly text: string
    readonly sequence: number
    readonly language?: string
    readonly profileRevision?: number
    readonly worldContext?: string
    readonly capturedAt: number
  }["language"]
  readonly profileRevision?: {
    readonly turnID?: string
    readonly requestID: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly text: string
    readonly sequence: number
    readonly language?: string
    readonly profileRevision?: number
    readonly worldContext?: string
    readonly capturedAt: number
  }["profileRevision"]
  readonly worldContext?: {
    readonly turnID?: string
    readonly requestID: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly text: string
    readonly sequence: number
    readonly language?: string
    readonly profileRevision?: number
    readonly worldContext?: string
    readonly capturedAt: number
  }["worldContext"]
  readonly capturedAt: {
    readonly turnID?: string
    readonly requestID: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly text: string
    readonly sequence: number
    readonly language?: string
    readonly profileRevision?: number
    readonly worldContext?: string
    readonly capturedAt: number
  }["capturedAt"]
}

export type ServerJarvisPrewarmOutput = {
  readonly requestID: string
  readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
  readonly sequence: number
  readonly language?: string
  readonly profileRevision?: number
  readonly modelReady: boolean
  readonly memoryReady: boolean
  readonly worldReady: boolean
  readonly expiresAt: number
}

export type ServerJarvisAdmitFinalInput = {
  readonly requestID: {
    readonly requestID: string
    readonly transcript: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly responseMode: "voice" | "text"
    readonly profileID?: string
    readonly profileRevision?: number
    readonly worldContext?: string
  }["requestID"]
  readonly transcript: {
    readonly requestID: string
    readonly transcript: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly responseMode: "voice" | "text"
    readonly profileID?: string
    readonly profileRevision?: number
    readonly worldContext?: string
  }["transcript"]
  readonly surface: {
    readonly requestID: string
    readonly transcript: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly responseMode: "voice" | "text"
    readonly profileID?: string
    readonly profileRevision?: number
    readonly worldContext?: string
  }["surface"]
  readonly responseMode: {
    readonly requestID: string
    readonly transcript: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly responseMode: "voice" | "text"
    readonly profileID?: string
    readonly profileRevision?: number
    readonly worldContext?: string
  }["responseMode"]
  readonly profileID?: {
    readonly requestID: string
    readonly transcript: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly responseMode: "voice" | "text"
    readonly profileID?: string
    readonly profileRevision?: number
    readonly worldContext?: string
  }["profileID"]
  readonly profileRevision?: {
    readonly requestID: string
    readonly transcript: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly responseMode: "voice" | "text"
    readonly profileID?: string
    readonly profileRevision?: number
    readonly worldContext?: string
  }["profileRevision"]
  readonly worldContext?: {
    readonly requestID: string
    readonly transcript: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly responseMode: "voice" | "text"
    readonly profileID?: string
    readonly profileRevision?: number
    readonly worldContext?: string
  }["worldContext"]
}

export type ServerJarvisAdmitFinalOutput = {
  readonly conversation: {
    readonly sessionID: string
    readonly profileID?: string
    readonly profileRevision?: number
    readonly recoveredAt?: number
    readonly updatedAt: number
  }
  readonly turn: {
    readonly id: string
    readonly requestID: string
    readonly sessionID: string
    readonly profileID?: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly responseMode: "voice" | "text"
    readonly phase:
      | "listening"
      | "transcribing"
      | "understanding"
      | "planning"
      | "responding"
      | "speaking"
      | "acting"
      | "completed"
      | "cancelled"
      | "error"
    readonly sequence: number
    readonly presentation?: {
      readonly emotion: string
      readonly intensity: number | "Infinity" | "-Infinity" | "NaN"
      readonly gestureHint?: string
      readonly gazeTarget?: string
      readonly expectedDurationMs?: number
    }
    readonly metrics: {
      readonly admittedAt?: number
      readonly providerStartedAt?: number
      readonly firstTextAt?: number
      readonly firstAudioAt?: number
      readonly completedAt?: number
      readonly sttMs?: number
      readonly ttftMs?: number
      readonly ttsMs?: number
      readonly cancelMs?: number
    }
    readonly error?: string
    readonly cancelReason?: string
    readonly createdAt: number
    readonly updatedAt: number
  }
  readonly messageID: string
  readonly admitted: boolean
  readonly prewarm?: {
    readonly requestID: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly sequence: number
    readonly language?: string
    readonly profileRevision?: number
    readonly modelReady: boolean
    readonly memoryReady: boolean
    readonly worldReady: boolean
    readonly expiresAt: number
  }
}

export type ServerJarvisControlStatusOutput = {
  readonly runtime: {
    readonly state: "ready" | "degraded" | "suspended"
    readonly primaryProfile?: {
      readonly id: string
      readonly revision: number
      readonly name: string
      readonly userName?: string
      readonly addressAs?: string
      readonly language: string
      readonly archetype: "natural" | "military" | "depressive" | "clown" | "jarvis" | "mentor" | "sarcastic"
      readonly tone: string
      readonly detail: string
      readonly humor: string
      readonly proactivity: string
      readonly instructions: string
      readonly catchphrases: ReadonlyArray<string>
      readonly primary: boolean
      readonly updatedAt: number
    }
    readonly config: {
      readonly primaryProfileID?: string
      readonly inboxSessionID?: string
      readonly models: {
        readonly dialogue?: { readonly providerID: string; readonly modelID: string }
        readonly planner?: { readonly providerID: string; readonly modelID: string }
        readonly embedding?: { readonly providerID: string; readonly modelID: string }
      }
      readonly plannerTimeoutMs: number
      readonly plannerIdleUnloadMs: number
      readonly plannerEscalationMinWords: number
      readonly reactor: {
        readonly profile: "fast" | "balanced" | "quality"
        readonly dialogueReasoning: "off" | "on"
        readonly plannerReasoning: "off" | "on"
        readonly allowFallback: boolean
      }
      readonly benchmark: {
        readonly status: "idle" | "running" | "completed" | "cancelled" | "error"
        readonly profile: "fast" | "balanced" | "quality"
        readonly startedAt?: number
        readonly completedAt?: number
        readonly activeModel?: { readonly providerID: string; readonly modelID: string }
        readonly results: ReadonlyArray<{
          readonly model: { readonly providerID: string; readonly modelID: string }
          readonly endpoint: string
          readonly instance: string
          readonly testedAt: number
          readonly expiresAt: number
          readonly ttftMs: number
          readonly totalMs: number
          readonly tokensPerSecond: number | "Infinity" | "-Infinity" | "NaN"
          readonly outputTokens: number
          readonly context: number
          readonly memoryBytes?: number
          readonly ukrainian: boolean
          readonly instructions: boolean
          readonly toolCalling: boolean
          readonly accepted: boolean
          readonly score: number | "Infinity" | "-Infinity" | "NaN"
          readonly error?: string
        }>
        readonly selected?: { readonly providerID: string; readonly modelID: string }
        readonly fallback: ReadonlyArray<{ readonly providerID: string; readonly modelID: string }>
        readonly error?: string
      }
      readonly initiative: {
        readonly enabled: boolean
        readonly quietStart: string
        readonly quietEnd: string
        readonly reflectionLimit: number
        readonly eventLimit: number
        readonly topicCooldownMinutes: number
      }
      readonly updatedAt: number
    }
    readonly activeGoals: number
    readonly suspendedGoals: number
    readonly pendingInbox: number
    readonly memoryRecords: number
    readonly degradedReasons: ReadonlyArray<string>
    readonly modelRoles: ReadonlyArray<{
      readonly role: "dialogue" | "planner" | "embedding"
      readonly status: "unconfigured" | "ready" | "loading" | "offline" | "unauthorized" | "unsupported" | "degraded"
      readonly model?: { readonly providerID: string; readonly modelID: string }
      readonly verified: boolean
      readonly detail?: string
    }>
    readonly planner: {
      readonly state: "idle" | "loading" | "ready" | "busy" | "unloading" | "offline"
      readonly managed: boolean
      readonly activeRequests: number
      readonly lastUsedAt?: number
    }
    readonly embeddings: {
      readonly state: "idle" | "running" | "blocked" | "error"
      readonly remaining: number
      readonly processed: number
      readonly error?: string
    }
  }
  readonly conversation?: {
    readonly sessionID: string
    readonly profileID?: string
    readonly profileRevision?: number
    readonly recoveredAt?: number
    readonly updatedAt: number
  }
  readonly currentTurn?: {
    readonly id: string
    readonly requestID: string
    readonly sessionID: string
    readonly profileID?: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly responseMode: "voice" | "text"
    readonly phase:
      | "listening"
      | "transcribing"
      | "understanding"
      | "planning"
      | "responding"
      | "speaking"
      | "acting"
      | "completed"
      | "cancelled"
      | "error"
    readonly sequence: number
    readonly presentation?: {
      readonly emotion: string
      readonly intensity: number | "Infinity" | "-Infinity" | "NaN"
      readonly gestureHint?: string
      readonly gazeTarget?: string
      readonly expectedDurationMs?: number
    }
    readonly metrics: {
      readonly admittedAt?: number
      readonly providerStartedAt?: number
      readonly firstTextAt?: number
      readonly firstAudioAt?: number
      readonly completedAt?: number
      readonly sttMs?: number
      readonly ttftMs?: number
      readonly ttsMs?: number
      readonly cancelMs?: number
    }
    readonly error?: string
    readonly cancelReason?: string
    readonly createdAt: number
    readonly updatedAt: number
  }
  readonly presence: {
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly microphoneOwner?: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly playbackOwner?: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly turnID?: string
    readonly sessionID?: string
    readonly state:
      | "listening"
      | "transcribing"
      | "understanding"
      | "planning"
      | "responding"
      | "speaking"
      | "acting"
      | "completed"
      | "cancelled"
      | "error"
    readonly updatedAt: number
  }
  readonly media: {
    readonly turnID?: string
    readonly owner?: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly state: "idle" | "buffering" | "synthesizing" | "playing" | "cancelling" | "error"
    readonly queuedSentences: number
    readonly activeJobs: number
    readonly acknowledgedCancellation: boolean
    readonly updatedAt: number
  }
  readonly replayCount: number
  readonly recentMemoryUses: number
  readonly recommendations: ReadonlyArray<string>
}

export type ServerJarvisUpdateMediaStateInput = {
  readonly turnID?: {
    readonly turnID?: string
    readonly owner?: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly state: "idle" | "buffering" | "synthesizing" | "playing" | "cancelling" | "error"
    readonly queuedSentences: number
    readonly activeJobs: number
    readonly acknowledgedCancellation: boolean
  }["turnID"]
  readonly owner?: {
    readonly turnID?: string
    readonly owner?: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly state: "idle" | "buffering" | "synthesizing" | "playing" | "cancelling" | "error"
    readonly queuedSentences: number
    readonly activeJobs: number
    readonly acknowledgedCancellation: boolean
  }["owner"]
  readonly state: {
    readonly turnID?: string
    readonly owner?: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly state: "idle" | "buffering" | "synthesizing" | "playing" | "cancelling" | "error"
    readonly queuedSentences: number
    readonly activeJobs: number
    readonly acknowledgedCancellation: boolean
  }["state"]
  readonly queuedSentences: {
    readonly turnID?: string
    readonly owner?: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly state: "idle" | "buffering" | "synthesizing" | "playing" | "cancelling" | "error"
    readonly queuedSentences: number
    readonly activeJobs: number
    readonly acknowledgedCancellation: boolean
  }["queuedSentences"]
  readonly activeJobs: {
    readonly turnID?: string
    readonly owner?: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly state: "idle" | "buffering" | "synthesizing" | "playing" | "cancelling" | "error"
    readonly queuedSentences: number
    readonly activeJobs: number
    readonly acknowledgedCancellation: boolean
  }["activeJobs"]
  readonly acknowledgedCancellation: {
    readonly turnID?: string
    readonly owner?: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly state: "idle" | "buffering" | "synthesizing" | "playing" | "cancelling" | "error"
    readonly queuedSentences: number
    readonly activeJobs: number
    readonly acknowledgedCancellation: boolean
  }["acknowledgedCancellation"]
}

export type ServerJarvisUpdateMediaStateOutput = {
  readonly turnID?: string
  readonly owner?: "desktop" | "unity-editor" | "pcvr" | "quest"
  readonly state: "idle" | "buffering" | "synthesizing" | "playing" | "cancelling" | "error"
  readonly queuedSentences: number
  readonly activeJobs: number
  readonly acknowledgedCancellation: boolean
  readonly updatedAt: number
}

export type ServerJarvisRunDiagnosticsOutput = {
  readonly checkedAt: number
  readonly checks: ReadonlyArray<{
    readonly id: string
    readonly status: "ready" | "degraded" | "error"
    readonly summary: string
    readonly detail?: string
  }>
  readonly recommendations: ReadonlyArray<string>
}

export type ServerJarvisCreateTurnInput = {
  readonly requestID: {
    readonly requestID: string
    readonly sessionID: string
    readonly profileID?: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly responseMode: "voice" | "text"
    readonly phase?:
      | "listening"
      | "transcribing"
      | "understanding"
      | "planning"
      | "responding"
      | "speaking"
      | "acting"
      | "completed"
      | "cancelled"
      | "error"
  }["requestID"]
  readonly sessionID: {
    readonly requestID: string
    readonly sessionID: string
    readonly profileID?: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly responseMode: "voice" | "text"
    readonly phase?:
      | "listening"
      | "transcribing"
      | "understanding"
      | "planning"
      | "responding"
      | "speaking"
      | "acting"
      | "completed"
      | "cancelled"
      | "error"
  }["sessionID"]
  readonly profileID?: {
    readonly requestID: string
    readonly sessionID: string
    readonly profileID?: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly responseMode: "voice" | "text"
    readonly phase?:
      | "listening"
      | "transcribing"
      | "understanding"
      | "planning"
      | "responding"
      | "speaking"
      | "acting"
      | "completed"
      | "cancelled"
      | "error"
  }["profileID"]
  readonly surface: {
    readonly requestID: string
    readonly sessionID: string
    readonly profileID?: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly responseMode: "voice" | "text"
    readonly phase?:
      | "listening"
      | "transcribing"
      | "understanding"
      | "planning"
      | "responding"
      | "speaking"
      | "acting"
      | "completed"
      | "cancelled"
      | "error"
  }["surface"]
  readonly responseMode: {
    readonly requestID: string
    readonly sessionID: string
    readonly profileID?: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly responseMode: "voice" | "text"
    readonly phase?:
      | "listening"
      | "transcribing"
      | "understanding"
      | "planning"
      | "responding"
      | "speaking"
      | "acting"
      | "completed"
      | "cancelled"
      | "error"
  }["responseMode"]
  readonly phase?: {
    readonly requestID: string
    readonly sessionID: string
    readonly profileID?: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly responseMode: "voice" | "text"
    readonly phase?:
      | "listening"
      | "transcribing"
      | "understanding"
      | "planning"
      | "responding"
      | "speaking"
      | "acting"
      | "completed"
      | "cancelled"
      | "error"
  }["phase"]
}

export type ServerJarvisCreateTurnOutput = {
  readonly id: string
  readonly requestID: string
  readonly sessionID: string
  readonly profileID?: string
  readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
  readonly responseMode: "voice" | "text"
  readonly phase:
    | "listening"
    | "transcribing"
    | "understanding"
    | "planning"
    | "responding"
    | "speaking"
    | "acting"
    | "completed"
    | "cancelled"
    | "error"
  readonly sequence: number
  readonly presentation?: {
    readonly emotion: string
    readonly intensity: number | "Infinity" | "-Infinity" | "NaN"
    readonly gestureHint?: string
    readonly gazeTarget?: string
    readonly expectedDurationMs?: number
  }
  readonly metrics: {
    readonly admittedAt?: number
    readonly providerStartedAt?: number
    readonly firstTextAt?: number
    readonly firstAudioAt?: number
    readonly completedAt?: number
    readonly sttMs?: number
    readonly ttftMs?: number
    readonly ttsMs?: number
    readonly cancelMs?: number
  }
  readonly error?: string
  readonly cancelReason?: string
  readonly createdAt: number
  readonly updatedAt: number
}

export type ServerJarvisCurrentTurnOutput = {
  readonly id: string
  readonly requestID: string
  readonly sessionID: string
  readonly profileID?: string
  readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
  readonly responseMode: "voice" | "text"
  readonly phase:
    | "listening"
    | "transcribing"
    | "understanding"
    | "planning"
    | "responding"
    | "speaking"
    | "acting"
    | "completed"
    | "cancelled"
    | "error"
  readonly sequence: number
  readonly presentation?: {
    readonly emotion: string
    readonly intensity: number | "Infinity" | "-Infinity" | "NaN"
    readonly gestureHint?: string
    readonly gazeTarget?: string
    readonly expectedDurationMs?: number
  }
  readonly metrics: {
    readonly admittedAt?: number
    readonly providerStartedAt?: number
    readonly firstTextAt?: number
    readonly firstAudioAt?: number
    readonly completedAt?: number
    readonly sttMs?: number
    readonly ttftMs?: number
    readonly ttsMs?: number
    readonly cancelMs?: number
  }
  readonly error?: string
  readonly cancelReason?: string
  readonly createdAt: number
  readonly updatedAt: number
} | null

export type ServerJarvisTurnInput = { readonly turnID: { readonly turnID: string }["turnID"] }

export type ServerJarvisTurnOutput = {
  readonly id: string
  readonly requestID: string
  readonly sessionID: string
  readonly profileID?: string
  readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
  readonly responseMode: "voice" | "text"
  readonly phase:
    | "listening"
    | "transcribing"
    | "understanding"
    | "planning"
    | "responding"
    | "speaking"
    | "acting"
    | "completed"
    | "cancelled"
    | "error"
  readonly sequence: number
  readonly presentation?: {
    readonly emotion: string
    readonly intensity: number | "Infinity" | "-Infinity" | "NaN"
    readonly gestureHint?: string
    readonly gazeTarget?: string
    readonly expectedDurationMs?: number
  }
  readonly metrics: {
    readonly admittedAt?: number
    readonly providerStartedAt?: number
    readonly firstTextAt?: number
    readonly firstAudioAt?: number
    readonly completedAt?: number
    readonly sttMs?: number
    readonly ttftMs?: number
    readonly ttsMs?: number
    readonly cancelMs?: number
  }
  readonly error?: string
  readonly cancelReason?: string
  readonly createdAt: number
  readonly updatedAt: number
} | null

export type ServerJarvisUpdateTurnInput = {
  readonly turnID: { readonly turnID: string }["turnID"]
  readonly phase: {
    readonly phase:
      | "listening"
      | "transcribing"
      | "understanding"
      | "planning"
      | "responding"
      | "speaking"
      | "acting"
      | "completed"
      | "cancelled"
      | "error"
    readonly sequence: number
    readonly presentation?: {
      readonly emotion: string
      readonly intensity: number | "Infinity" | "-Infinity" | "NaN"
      readonly gestureHint?: string
      readonly gazeTarget?: string
      readonly expectedDurationMs?: number
    }
    readonly metrics?: {
      readonly admittedAt?: number
      readonly providerStartedAt?: number
      readonly firstTextAt?: number
      readonly firstAudioAt?: number
      readonly completedAt?: number
      readonly sttMs?: number
      readonly ttftMs?: number
      readonly ttsMs?: number
      readonly cancelMs?: number
    }
    readonly error?: string
    readonly cancelReason?: string
  }["phase"]
  readonly sequence: {
    readonly phase:
      | "listening"
      | "transcribing"
      | "understanding"
      | "planning"
      | "responding"
      | "speaking"
      | "acting"
      | "completed"
      | "cancelled"
      | "error"
    readonly sequence: number
    readonly presentation?: {
      readonly emotion: string
      readonly intensity: number | "Infinity" | "-Infinity" | "NaN"
      readonly gestureHint?: string
      readonly gazeTarget?: string
      readonly expectedDurationMs?: number
    }
    readonly metrics?: {
      readonly admittedAt?: number
      readonly providerStartedAt?: number
      readonly firstTextAt?: number
      readonly firstAudioAt?: number
      readonly completedAt?: number
      readonly sttMs?: number
      readonly ttftMs?: number
      readonly ttsMs?: number
      readonly cancelMs?: number
    }
    readonly error?: string
    readonly cancelReason?: string
  }["sequence"]
  readonly presentation?: {
    readonly phase:
      | "listening"
      | "transcribing"
      | "understanding"
      | "planning"
      | "responding"
      | "speaking"
      | "acting"
      | "completed"
      | "cancelled"
      | "error"
    readonly sequence: number
    readonly presentation?: {
      readonly emotion: string
      readonly intensity: number | "Infinity" | "-Infinity" | "NaN"
      readonly gestureHint?: string
      readonly gazeTarget?: string
      readonly expectedDurationMs?: number
    }
    readonly metrics?: {
      readonly admittedAt?: number
      readonly providerStartedAt?: number
      readonly firstTextAt?: number
      readonly firstAudioAt?: number
      readonly completedAt?: number
      readonly sttMs?: number
      readonly ttftMs?: number
      readonly ttsMs?: number
      readonly cancelMs?: number
    }
    readonly error?: string
    readonly cancelReason?: string
  }["presentation"]
  readonly metrics?: {
    readonly phase:
      | "listening"
      | "transcribing"
      | "understanding"
      | "planning"
      | "responding"
      | "speaking"
      | "acting"
      | "completed"
      | "cancelled"
      | "error"
    readonly sequence: number
    readonly presentation?: {
      readonly emotion: string
      readonly intensity: number | "Infinity" | "-Infinity" | "NaN"
      readonly gestureHint?: string
      readonly gazeTarget?: string
      readonly expectedDurationMs?: number
    }
    readonly metrics?: {
      readonly admittedAt?: number
      readonly providerStartedAt?: number
      readonly firstTextAt?: number
      readonly firstAudioAt?: number
      readonly completedAt?: number
      readonly sttMs?: number
      readonly ttftMs?: number
      readonly ttsMs?: number
      readonly cancelMs?: number
    }
    readonly error?: string
    readonly cancelReason?: string
  }["metrics"]
  readonly error?: {
    readonly phase:
      | "listening"
      | "transcribing"
      | "understanding"
      | "planning"
      | "responding"
      | "speaking"
      | "acting"
      | "completed"
      | "cancelled"
      | "error"
    readonly sequence: number
    readonly presentation?: {
      readonly emotion: string
      readonly intensity: number | "Infinity" | "-Infinity" | "NaN"
      readonly gestureHint?: string
      readonly gazeTarget?: string
      readonly expectedDurationMs?: number
    }
    readonly metrics?: {
      readonly admittedAt?: number
      readonly providerStartedAt?: number
      readonly firstTextAt?: number
      readonly firstAudioAt?: number
      readonly completedAt?: number
      readonly sttMs?: number
      readonly ttftMs?: number
      readonly ttsMs?: number
      readonly cancelMs?: number
    }
    readonly error?: string
    readonly cancelReason?: string
  }["error"]
  readonly cancelReason?: {
    readonly phase:
      | "listening"
      | "transcribing"
      | "understanding"
      | "planning"
      | "responding"
      | "speaking"
      | "acting"
      | "completed"
      | "cancelled"
      | "error"
    readonly sequence: number
    readonly presentation?: {
      readonly emotion: string
      readonly intensity: number | "Infinity" | "-Infinity" | "NaN"
      readonly gestureHint?: string
      readonly gazeTarget?: string
      readonly expectedDurationMs?: number
    }
    readonly metrics?: {
      readonly admittedAt?: number
      readonly providerStartedAt?: number
      readonly firstTextAt?: number
      readonly firstAudioAt?: number
      readonly completedAt?: number
      readonly sttMs?: number
      readonly ttftMs?: number
      readonly ttsMs?: number
      readonly cancelMs?: number
    }
    readonly error?: string
    readonly cancelReason?: string
  }["cancelReason"]
}

export type ServerJarvisUpdateTurnOutput = {
  readonly id: string
  readonly requestID: string
  readonly sessionID: string
  readonly profileID?: string
  readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
  readonly responseMode: "voice" | "text"
  readonly phase:
    | "listening"
    | "transcribing"
    | "understanding"
    | "planning"
    | "responding"
    | "speaking"
    | "acting"
    | "completed"
    | "cancelled"
    | "error"
  readonly sequence: number
  readonly presentation?: {
    readonly emotion: string
    readonly intensity: number | "Infinity" | "-Infinity" | "NaN"
    readonly gestureHint?: string
    readonly gazeTarget?: string
    readonly expectedDurationMs?: number
  }
  readonly metrics: {
    readonly admittedAt?: number
    readonly providerStartedAt?: number
    readonly firstTextAt?: number
    readonly firstAudioAt?: number
    readonly completedAt?: number
    readonly sttMs?: number
    readonly ttftMs?: number
    readonly ttsMs?: number
    readonly cancelMs?: number
  }
  readonly error?: string
  readonly cancelReason?: string
  readonly createdAt: number
  readonly updatedAt: number
} | null

export type ServerJarvisCancelTurnInput = {
  readonly turnID: { readonly turnID: string }["turnID"]
  readonly reason?: { readonly reason?: string }["reason"]
}

export type ServerJarvisCancelTurnOutput = {
  readonly id: string
  readonly requestID: string
  readonly sessionID: string
  readonly profileID?: string
  readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
  readonly responseMode: "voice" | "text"
  readonly phase:
    | "listening"
    | "transcribing"
    | "understanding"
    | "planning"
    | "responding"
    | "speaking"
    | "acting"
    | "completed"
    | "cancelled"
    | "error"
  readonly sequence: number
  readonly presentation?: {
    readonly emotion: string
    readonly intensity: number | "Infinity" | "-Infinity" | "NaN"
    readonly gestureHint?: string
    readonly gazeTarget?: string
    readonly expectedDurationMs?: number
  }
  readonly metrics: {
    readonly admittedAt?: number
    readonly providerStartedAt?: number
    readonly firstTextAt?: number
    readonly firstAudioAt?: number
    readonly completedAt?: number
    readonly sttMs?: number
    readonly ttftMs?: number
    readonly ttsMs?: number
    readonly cancelMs?: number
  }
  readonly error?: string
  readonly cancelReason?: string
  readonly createdAt: number
  readonly updatedAt: number
} | null

export type ServerJarvisPresenceOutput = {
  readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
  readonly microphoneOwner?: "desktop" | "unity-editor" | "pcvr" | "quest"
  readonly playbackOwner?: "desktop" | "unity-editor" | "pcvr" | "quest"
  readonly turnID?: string
  readonly sessionID?: string
  readonly state:
    | "listening"
    | "transcribing"
    | "understanding"
    | "planning"
    | "responding"
    | "speaking"
    | "acting"
    | "completed"
    | "cancelled"
    | "error"
  readonly updatedAt: number
}

export type ServerJarvisHandoffPresenceInput = {
  readonly from?: {
    readonly from?: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly to: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly sessionID?: string
    readonly turnID?: string
    readonly microphone: boolean
    readonly playback: boolean
  }["from"]
  readonly to: {
    readonly from?: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly to: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly sessionID?: string
    readonly turnID?: string
    readonly microphone: boolean
    readonly playback: boolean
  }["to"]
  readonly sessionID?: {
    readonly from?: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly to: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly sessionID?: string
    readonly turnID?: string
    readonly microphone: boolean
    readonly playback: boolean
  }["sessionID"]
  readonly turnID?: {
    readonly from?: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly to: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly sessionID?: string
    readonly turnID?: string
    readonly microphone: boolean
    readonly playback: boolean
  }["turnID"]
  readonly microphone: {
    readonly from?: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly to: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly sessionID?: string
    readonly turnID?: string
    readonly microphone: boolean
    readonly playback: boolean
  }["microphone"]
  readonly playback: {
    readonly from?: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly to: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly sessionID?: string
    readonly turnID?: string
    readonly microphone: boolean
    readonly playback: boolean
  }["playback"]
}

export type ServerJarvisHandoffPresenceOutput = {
  readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
  readonly microphoneOwner?: "desktop" | "unity-editor" | "pcvr" | "quest"
  readonly playbackOwner?: "desktop" | "unity-editor" | "pcvr" | "quest"
  readonly turnID?: string
  readonly sessionID?: string
  readonly state:
    | "listening"
    | "transcribing"
    | "understanding"
    | "planning"
    | "responding"
    | "speaking"
    | "acting"
    | "completed"
    | "cancelled"
    | "error"
  readonly updatedAt: number
}

export type ServerJarvisStatusOutput = {
  readonly state: "ready" | "degraded" | "suspended"
  readonly primaryProfile?: {
    readonly id: string
    readonly revision: number
    readonly name: string
    readonly userName?: string
    readonly addressAs?: string
    readonly language: string
    readonly archetype: "natural" | "military" | "depressive" | "clown" | "jarvis" | "mentor" | "sarcastic"
    readonly tone: string
    readonly detail: string
    readonly humor: string
    readonly proactivity: string
    readonly instructions: string
    readonly catchphrases: ReadonlyArray<string>
    readonly primary: boolean
    readonly updatedAt: number
  }
  readonly config: {
    readonly primaryProfileID?: string
    readonly inboxSessionID?: string
    readonly models: {
      readonly dialogue?: { readonly providerID: string; readonly modelID: string }
      readonly planner?: { readonly providerID: string; readonly modelID: string }
      readonly embedding?: { readonly providerID: string; readonly modelID: string }
    }
    readonly plannerTimeoutMs: number
    readonly plannerIdleUnloadMs: number
    readonly plannerEscalationMinWords: number
    readonly reactor: {
      readonly profile: "fast" | "balanced" | "quality"
      readonly dialogueReasoning: "off" | "on"
      readonly plannerReasoning: "off" | "on"
      readonly allowFallback: boolean
    }
    readonly benchmark: {
      readonly status: "idle" | "running" | "completed" | "cancelled" | "error"
      readonly profile: "fast" | "balanced" | "quality"
      readonly startedAt?: number
      readonly completedAt?: number
      readonly activeModel?: { readonly providerID: string; readonly modelID: string }
      readonly results: ReadonlyArray<{
        readonly model: { readonly providerID: string; readonly modelID: string }
        readonly endpoint: string
        readonly instance: string
        readonly testedAt: number
        readonly expiresAt: number
        readonly ttftMs: number
        readonly totalMs: number
        readonly tokensPerSecond: number | "Infinity" | "-Infinity" | "NaN"
        readonly outputTokens: number
        readonly context: number
        readonly memoryBytes?: number
        readonly ukrainian: boolean
        readonly instructions: boolean
        readonly toolCalling: boolean
        readonly accepted: boolean
        readonly score: number | "Infinity" | "-Infinity" | "NaN"
        readonly error?: string
      }>
      readonly selected?: { readonly providerID: string; readonly modelID: string }
      readonly fallback: ReadonlyArray<{ readonly providerID: string; readonly modelID: string }>
      readonly error?: string
    }
    readonly initiative: {
      readonly enabled: boolean
      readonly quietStart: string
      readonly quietEnd: string
      readonly reflectionLimit: number
      readonly eventLimit: number
      readonly topicCooldownMinutes: number
    }
    readonly updatedAt: number
  }
  readonly activeGoals: number
  readonly suspendedGoals: number
  readonly pendingInbox: number
  readonly memoryRecords: number
  readonly degradedReasons: ReadonlyArray<string>
  readonly modelRoles: ReadonlyArray<{
    readonly role: "dialogue" | "planner" | "embedding"
    readonly status: "unconfigured" | "ready" | "loading" | "offline" | "unauthorized" | "unsupported" | "degraded"
    readonly model?: { readonly providerID: string; readonly modelID: string }
    readonly verified: boolean
    readonly detail?: string
  }>
  readonly planner: {
    readonly state: "idle" | "loading" | "ready" | "busy" | "unloading" | "offline"
    readonly managed: boolean
    readonly activeRequests: number
    readonly lastUsedAt?: number
  }
  readonly embeddings: {
    readonly state: "idle" | "running" | "blocked" | "error"
    readonly remaining: number
    readonly processed: number
    readonly error?: string
  }
}

export type ServerJarvisConfigOutput = {
  readonly primaryProfileID?: string
  readonly inboxSessionID?: string
  readonly models: {
    readonly dialogue?: { readonly providerID: string; readonly modelID: string }
    readonly planner?: { readonly providerID: string; readonly modelID: string }
    readonly embedding?: { readonly providerID: string; readonly modelID: string }
  }
  readonly plannerTimeoutMs: number
  readonly plannerIdleUnloadMs: number
  readonly plannerEscalationMinWords: number
  readonly reactor: {
    readonly profile: "fast" | "balanced" | "quality"
    readonly dialogueReasoning: "off" | "on"
    readonly plannerReasoning: "off" | "on"
    readonly allowFallback: boolean
  }
  readonly benchmark: {
    readonly status: "idle" | "running" | "completed" | "cancelled" | "error"
    readonly profile: "fast" | "balanced" | "quality"
    readonly startedAt?: number
    readonly completedAt?: number
    readonly activeModel?: { readonly providerID: string; readonly modelID: string }
    readonly results: ReadonlyArray<{
      readonly model: { readonly providerID: string; readonly modelID: string }
      readonly endpoint: string
      readonly instance: string
      readonly testedAt: number
      readonly expiresAt: number
      readonly ttftMs: number
      readonly totalMs: number
      readonly tokensPerSecond: number | "Infinity" | "-Infinity" | "NaN"
      readonly outputTokens: number
      readonly context: number
      readonly memoryBytes?: number
      readonly ukrainian: boolean
      readonly instructions: boolean
      readonly toolCalling: boolean
      readonly accepted: boolean
      readonly score: number | "Infinity" | "-Infinity" | "NaN"
      readonly error?: string
    }>
    readonly selected?: { readonly providerID: string; readonly modelID: string }
    readonly fallback: ReadonlyArray<{ readonly providerID: string; readonly modelID: string }>
    readonly error?: string
  }
  readonly initiative: {
    readonly enabled: boolean
    readonly quietStart: string
    readonly quietEnd: string
    readonly reflectionLimit: number
    readonly eventLimit: number
    readonly topicCooldownMinutes: number
  }
  readonly updatedAt: number
}

export type ServerJarvisUpdateConfigInput = {
  readonly primaryProfileID?: {
    readonly primaryProfileID?: string
    readonly inboxSessionID?: string
    readonly models: {
      readonly dialogue?: { readonly providerID: string; readonly modelID: string }
      readonly planner?: { readonly providerID: string; readonly modelID: string }
      readonly embedding?: { readonly providerID: string; readonly modelID: string }
    }
    readonly plannerTimeoutMs: number
    readonly plannerIdleUnloadMs: number
    readonly plannerEscalationMinWords: number
    readonly reactor: {
      readonly profile: "fast" | "balanced" | "quality"
      readonly dialogueReasoning: "off" | "on"
      readonly plannerReasoning: "off" | "on"
      readonly allowFallback: boolean
    }
    readonly benchmark: {
      readonly status: "idle" | "running" | "completed" | "cancelled" | "error"
      readonly profile: "fast" | "balanced" | "quality"
      readonly startedAt?: number
      readonly completedAt?: number
      readonly activeModel?: { readonly providerID: string; readonly modelID: string }
      readonly results: ReadonlyArray<{
        readonly model: { readonly providerID: string; readonly modelID: string }
        readonly endpoint: string
        readonly instance: string
        readonly testedAt: number
        readonly expiresAt: number
        readonly ttftMs: number
        readonly totalMs: number
        readonly tokensPerSecond: number | "Infinity" | "-Infinity" | "NaN"
        readonly outputTokens: number
        readonly context: number
        readonly memoryBytes?: number
        readonly ukrainian: boolean
        readonly instructions: boolean
        readonly toolCalling: boolean
        readonly accepted: boolean
        readonly score: number | "Infinity" | "-Infinity" | "NaN"
        readonly error?: string
      }>
      readonly selected?: { readonly providerID: string; readonly modelID: string }
      readonly fallback: ReadonlyArray<{ readonly providerID: string; readonly modelID: string }>
      readonly error?: string
    }
    readonly initiative: {
      readonly enabled: boolean
      readonly quietStart: string
      readonly quietEnd: string
      readonly reflectionLimit: number
      readonly eventLimit: number
      readonly topicCooldownMinutes: number
    }
    readonly updatedAt: number
  }["primaryProfileID"]
  readonly inboxSessionID?: {
    readonly primaryProfileID?: string
    readonly inboxSessionID?: string
    readonly models: {
      readonly dialogue?: { readonly providerID: string; readonly modelID: string }
      readonly planner?: { readonly providerID: string; readonly modelID: string }
      readonly embedding?: { readonly providerID: string; readonly modelID: string }
    }
    readonly plannerTimeoutMs: number
    readonly plannerIdleUnloadMs: number
    readonly plannerEscalationMinWords: number
    readonly reactor: {
      readonly profile: "fast" | "balanced" | "quality"
      readonly dialogueReasoning: "off" | "on"
      readonly plannerReasoning: "off" | "on"
      readonly allowFallback: boolean
    }
    readonly benchmark: {
      readonly status: "idle" | "running" | "completed" | "cancelled" | "error"
      readonly profile: "fast" | "balanced" | "quality"
      readonly startedAt?: number
      readonly completedAt?: number
      readonly activeModel?: { readonly providerID: string; readonly modelID: string }
      readonly results: ReadonlyArray<{
        readonly model: { readonly providerID: string; readonly modelID: string }
        readonly endpoint: string
        readonly instance: string
        readonly testedAt: number
        readonly expiresAt: number
        readonly ttftMs: number
        readonly totalMs: number
        readonly tokensPerSecond: number | "Infinity" | "-Infinity" | "NaN"
        readonly outputTokens: number
        readonly context: number
        readonly memoryBytes?: number
        readonly ukrainian: boolean
        readonly instructions: boolean
        readonly toolCalling: boolean
        readonly accepted: boolean
        readonly score: number | "Infinity" | "-Infinity" | "NaN"
        readonly error?: string
      }>
      readonly selected?: { readonly providerID: string; readonly modelID: string }
      readonly fallback: ReadonlyArray<{ readonly providerID: string; readonly modelID: string }>
      readonly error?: string
    }
    readonly initiative: {
      readonly enabled: boolean
      readonly quietStart: string
      readonly quietEnd: string
      readonly reflectionLimit: number
      readonly eventLimit: number
      readonly topicCooldownMinutes: number
    }
    readonly updatedAt: number
  }["inboxSessionID"]
  readonly models: {
    readonly primaryProfileID?: string
    readonly inboxSessionID?: string
    readonly models: {
      readonly dialogue?: { readonly providerID: string; readonly modelID: string }
      readonly planner?: { readonly providerID: string; readonly modelID: string }
      readonly embedding?: { readonly providerID: string; readonly modelID: string }
    }
    readonly plannerTimeoutMs: number
    readonly plannerIdleUnloadMs: number
    readonly plannerEscalationMinWords: number
    readonly reactor: {
      readonly profile: "fast" | "balanced" | "quality"
      readonly dialogueReasoning: "off" | "on"
      readonly plannerReasoning: "off" | "on"
      readonly allowFallback: boolean
    }
    readonly benchmark: {
      readonly status: "idle" | "running" | "completed" | "cancelled" | "error"
      readonly profile: "fast" | "balanced" | "quality"
      readonly startedAt?: number
      readonly completedAt?: number
      readonly activeModel?: { readonly providerID: string; readonly modelID: string }
      readonly results: ReadonlyArray<{
        readonly model: { readonly providerID: string; readonly modelID: string }
        readonly endpoint: string
        readonly instance: string
        readonly testedAt: number
        readonly expiresAt: number
        readonly ttftMs: number
        readonly totalMs: number
        readonly tokensPerSecond: number | "Infinity" | "-Infinity" | "NaN"
        readonly outputTokens: number
        readonly context: number
        readonly memoryBytes?: number
        readonly ukrainian: boolean
        readonly instructions: boolean
        readonly toolCalling: boolean
        readonly accepted: boolean
        readonly score: number | "Infinity" | "-Infinity" | "NaN"
        readonly error?: string
      }>
      readonly selected?: { readonly providerID: string; readonly modelID: string }
      readonly fallback: ReadonlyArray<{ readonly providerID: string; readonly modelID: string }>
      readonly error?: string
    }
    readonly initiative: {
      readonly enabled: boolean
      readonly quietStart: string
      readonly quietEnd: string
      readonly reflectionLimit: number
      readonly eventLimit: number
      readonly topicCooldownMinutes: number
    }
    readonly updatedAt: number
  }["models"]
  readonly plannerTimeoutMs: {
    readonly primaryProfileID?: string
    readonly inboxSessionID?: string
    readonly models: {
      readonly dialogue?: { readonly providerID: string; readonly modelID: string }
      readonly planner?: { readonly providerID: string; readonly modelID: string }
      readonly embedding?: { readonly providerID: string; readonly modelID: string }
    }
    readonly plannerTimeoutMs: number
    readonly plannerIdleUnloadMs: number
    readonly plannerEscalationMinWords: number
    readonly reactor: {
      readonly profile: "fast" | "balanced" | "quality"
      readonly dialogueReasoning: "off" | "on"
      readonly plannerReasoning: "off" | "on"
      readonly allowFallback: boolean
    }
    readonly benchmark: {
      readonly status: "idle" | "running" | "completed" | "cancelled" | "error"
      readonly profile: "fast" | "balanced" | "quality"
      readonly startedAt?: number
      readonly completedAt?: number
      readonly activeModel?: { readonly providerID: string; readonly modelID: string }
      readonly results: ReadonlyArray<{
        readonly model: { readonly providerID: string; readonly modelID: string }
        readonly endpoint: string
        readonly instance: string
        readonly testedAt: number
        readonly expiresAt: number
        readonly ttftMs: number
        readonly totalMs: number
        readonly tokensPerSecond: number | "Infinity" | "-Infinity" | "NaN"
        readonly outputTokens: number
        readonly context: number
        readonly memoryBytes?: number
        readonly ukrainian: boolean
        readonly instructions: boolean
        readonly toolCalling: boolean
        readonly accepted: boolean
        readonly score: number | "Infinity" | "-Infinity" | "NaN"
        readonly error?: string
      }>
      readonly selected?: { readonly providerID: string; readonly modelID: string }
      readonly fallback: ReadonlyArray<{ readonly providerID: string; readonly modelID: string }>
      readonly error?: string
    }
    readonly initiative: {
      readonly enabled: boolean
      readonly quietStart: string
      readonly quietEnd: string
      readonly reflectionLimit: number
      readonly eventLimit: number
      readonly topicCooldownMinutes: number
    }
    readonly updatedAt: number
  }["plannerTimeoutMs"]
  readonly plannerIdleUnloadMs: {
    readonly primaryProfileID?: string
    readonly inboxSessionID?: string
    readonly models: {
      readonly dialogue?: { readonly providerID: string; readonly modelID: string }
      readonly planner?: { readonly providerID: string; readonly modelID: string }
      readonly embedding?: { readonly providerID: string; readonly modelID: string }
    }
    readonly plannerTimeoutMs: number
    readonly plannerIdleUnloadMs: number
    readonly plannerEscalationMinWords: number
    readonly reactor: {
      readonly profile: "fast" | "balanced" | "quality"
      readonly dialogueReasoning: "off" | "on"
      readonly plannerReasoning: "off" | "on"
      readonly allowFallback: boolean
    }
    readonly benchmark: {
      readonly status: "idle" | "running" | "completed" | "cancelled" | "error"
      readonly profile: "fast" | "balanced" | "quality"
      readonly startedAt?: number
      readonly completedAt?: number
      readonly activeModel?: { readonly providerID: string; readonly modelID: string }
      readonly results: ReadonlyArray<{
        readonly model: { readonly providerID: string; readonly modelID: string }
        readonly endpoint: string
        readonly instance: string
        readonly testedAt: number
        readonly expiresAt: number
        readonly ttftMs: number
        readonly totalMs: number
        readonly tokensPerSecond: number | "Infinity" | "-Infinity" | "NaN"
        readonly outputTokens: number
        readonly context: number
        readonly memoryBytes?: number
        readonly ukrainian: boolean
        readonly instructions: boolean
        readonly toolCalling: boolean
        readonly accepted: boolean
        readonly score: number | "Infinity" | "-Infinity" | "NaN"
        readonly error?: string
      }>
      readonly selected?: { readonly providerID: string; readonly modelID: string }
      readonly fallback: ReadonlyArray<{ readonly providerID: string; readonly modelID: string }>
      readonly error?: string
    }
    readonly initiative: {
      readonly enabled: boolean
      readonly quietStart: string
      readonly quietEnd: string
      readonly reflectionLimit: number
      readonly eventLimit: number
      readonly topicCooldownMinutes: number
    }
    readonly updatedAt: number
  }["plannerIdleUnloadMs"]
  readonly plannerEscalationMinWords: {
    readonly primaryProfileID?: string
    readonly inboxSessionID?: string
    readonly models: {
      readonly dialogue?: { readonly providerID: string; readonly modelID: string }
      readonly planner?: { readonly providerID: string; readonly modelID: string }
      readonly embedding?: { readonly providerID: string; readonly modelID: string }
    }
    readonly plannerTimeoutMs: number
    readonly plannerIdleUnloadMs: number
    readonly plannerEscalationMinWords: number
    readonly reactor: {
      readonly profile: "fast" | "balanced" | "quality"
      readonly dialogueReasoning: "off" | "on"
      readonly plannerReasoning: "off" | "on"
      readonly allowFallback: boolean
    }
    readonly benchmark: {
      readonly status: "idle" | "running" | "completed" | "cancelled" | "error"
      readonly profile: "fast" | "balanced" | "quality"
      readonly startedAt?: number
      readonly completedAt?: number
      readonly activeModel?: { readonly providerID: string; readonly modelID: string }
      readonly results: ReadonlyArray<{
        readonly model: { readonly providerID: string; readonly modelID: string }
        readonly endpoint: string
        readonly instance: string
        readonly testedAt: number
        readonly expiresAt: number
        readonly ttftMs: number
        readonly totalMs: number
        readonly tokensPerSecond: number | "Infinity" | "-Infinity" | "NaN"
        readonly outputTokens: number
        readonly context: number
        readonly memoryBytes?: number
        readonly ukrainian: boolean
        readonly instructions: boolean
        readonly toolCalling: boolean
        readonly accepted: boolean
        readonly score: number | "Infinity" | "-Infinity" | "NaN"
        readonly error?: string
      }>
      readonly selected?: { readonly providerID: string; readonly modelID: string }
      readonly fallback: ReadonlyArray<{ readonly providerID: string; readonly modelID: string }>
      readonly error?: string
    }
    readonly initiative: {
      readonly enabled: boolean
      readonly quietStart: string
      readonly quietEnd: string
      readonly reflectionLimit: number
      readonly eventLimit: number
      readonly topicCooldownMinutes: number
    }
    readonly updatedAt: number
  }["plannerEscalationMinWords"]
  readonly reactor: {
    readonly primaryProfileID?: string
    readonly inboxSessionID?: string
    readonly models: {
      readonly dialogue?: { readonly providerID: string; readonly modelID: string }
      readonly planner?: { readonly providerID: string; readonly modelID: string }
      readonly embedding?: { readonly providerID: string; readonly modelID: string }
    }
    readonly plannerTimeoutMs: number
    readonly plannerIdleUnloadMs: number
    readonly plannerEscalationMinWords: number
    readonly reactor: {
      readonly profile: "fast" | "balanced" | "quality"
      readonly dialogueReasoning: "off" | "on"
      readonly plannerReasoning: "off" | "on"
      readonly allowFallback: boolean
    }
    readonly benchmark: {
      readonly status: "idle" | "running" | "completed" | "cancelled" | "error"
      readonly profile: "fast" | "balanced" | "quality"
      readonly startedAt?: number
      readonly completedAt?: number
      readonly activeModel?: { readonly providerID: string; readonly modelID: string }
      readonly results: ReadonlyArray<{
        readonly model: { readonly providerID: string; readonly modelID: string }
        readonly endpoint: string
        readonly instance: string
        readonly testedAt: number
        readonly expiresAt: number
        readonly ttftMs: number
        readonly totalMs: number
        readonly tokensPerSecond: number | "Infinity" | "-Infinity" | "NaN"
        readonly outputTokens: number
        readonly context: number
        readonly memoryBytes?: number
        readonly ukrainian: boolean
        readonly instructions: boolean
        readonly toolCalling: boolean
        readonly accepted: boolean
        readonly score: number | "Infinity" | "-Infinity" | "NaN"
        readonly error?: string
      }>
      readonly selected?: { readonly providerID: string; readonly modelID: string }
      readonly fallback: ReadonlyArray<{ readonly providerID: string; readonly modelID: string }>
      readonly error?: string
    }
    readonly initiative: {
      readonly enabled: boolean
      readonly quietStart: string
      readonly quietEnd: string
      readonly reflectionLimit: number
      readonly eventLimit: number
      readonly topicCooldownMinutes: number
    }
    readonly updatedAt: number
  }["reactor"]
  readonly benchmark: {
    readonly primaryProfileID?: string
    readonly inboxSessionID?: string
    readonly models: {
      readonly dialogue?: { readonly providerID: string; readonly modelID: string }
      readonly planner?: { readonly providerID: string; readonly modelID: string }
      readonly embedding?: { readonly providerID: string; readonly modelID: string }
    }
    readonly plannerTimeoutMs: number
    readonly plannerIdleUnloadMs: number
    readonly plannerEscalationMinWords: number
    readonly reactor: {
      readonly profile: "fast" | "balanced" | "quality"
      readonly dialogueReasoning: "off" | "on"
      readonly plannerReasoning: "off" | "on"
      readonly allowFallback: boolean
    }
    readonly benchmark: {
      readonly status: "idle" | "running" | "completed" | "cancelled" | "error"
      readonly profile: "fast" | "balanced" | "quality"
      readonly startedAt?: number
      readonly completedAt?: number
      readonly activeModel?: { readonly providerID: string; readonly modelID: string }
      readonly results: ReadonlyArray<{
        readonly model: { readonly providerID: string; readonly modelID: string }
        readonly endpoint: string
        readonly instance: string
        readonly testedAt: number
        readonly expiresAt: number
        readonly ttftMs: number
        readonly totalMs: number
        readonly tokensPerSecond: number | "Infinity" | "-Infinity" | "NaN"
        readonly outputTokens: number
        readonly context: number
        readonly memoryBytes?: number
        readonly ukrainian: boolean
        readonly instructions: boolean
        readonly toolCalling: boolean
        readonly accepted: boolean
        readonly score: number | "Infinity" | "-Infinity" | "NaN"
        readonly error?: string
      }>
      readonly selected?: { readonly providerID: string; readonly modelID: string }
      readonly fallback: ReadonlyArray<{ readonly providerID: string; readonly modelID: string }>
      readonly error?: string
    }
    readonly initiative: {
      readonly enabled: boolean
      readonly quietStart: string
      readonly quietEnd: string
      readonly reflectionLimit: number
      readonly eventLimit: number
      readonly topicCooldownMinutes: number
    }
    readonly updatedAt: number
  }["benchmark"]
  readonly initiative: {
    readonly primaryProfileID?: string
    readonly inboxSessionID?: string
    readonly models: {
      readonly dialogue?: { readonly providerID: string; readonly modelID: string }
      readonly planner?: { readonly providerID: string; readonly modelID: string }
      readonly embedding?: { readonly providerID: string; readonly modelID: string }
    }
    readonly plannerTimeoutMs: number
    readonly plannerIdleUnloadMs: number
    readonly plannerEscalationMinWords: number
    readonly reactor: {
      readonly profile: "fast" | "balanced" | "quality"
      readonly dialogueReasoning: "off" | "on"
      readonly plannerReasoning: "off" | "on"
      readonly allowFallback: boolean
    }
    readonly benchmark: {
      readonly status: "idle" | "running" | "completed" | "cancelled" | "error"
      readonly profile: "fast" | "balanced" | "quality"
      readonly startedAt?: number
      readonly completedAt?: number
      readonly activeModel?: { readonly providerID: string; readonly modelID: string }
      readonly results: ReadonlyArray<{
        readonly model: { readonly providerID: string; readonly modelID: string }
        readonly endpoint: string
        readonly instance: string
        readonly testedAt: number
        readonly expiresAt: number
        readonly ttftMs: number
        readonly totalMs: number
        readonly tokensPerSecond: number | "Infinity" | "-Infinity" | "NaN"
        readonly outputTokens: number
        readonly context: number
        readonly memoryBytes?: number
        readonly ukrainian: boolean
        readonly instructions: boolean
        readonly toolCalling: boolean
        readonly accepted: boolean
        readonly score: number | "Infinity" | "-Infinity" | "NaN"
        readonly error?: string
      }>
      readonly selected?: { readonly providerID: string; readonly modelID: string }
      readonly fallback: ReadonlyArray<{ readonly providerID: string; readonly modelID: string }>
      readonly error?: string
    }
    readonly initiative: {
      readonly enabled: boolean
      readonly quietStart: string
      readonly quietEnd: string
      readonly reflectionLimit: number
      readonly eventLimit: number
      readonly topicCooldownMinutes: number
    }
    readonly updatedAt: number
  }["initiative"]
  readonly updatedAt: {
    readonly primaryProfileID?: string
    readonly inboxSessionID?: string
    readonly models: {
      readonly dialogue?: { readonly providerID: string; readonly modelID: string }
      readonly planner?: { readonly providerID: string; readonly modelID: string }
      readonly embedding?: { readonly providerID: string; readonly modelID: string }
    }
    readonly plannerTimeoutMs: number
    readonly plannerIdleUnloadMs: number
    readonly plannerEscalationMinWords: number
    readonly reactor: {
      readonly profile: "fast" | "balanced" | "quality"
      readonly dialogueReasoning: "off" | "on"
      readonly plannerReasoning: "off" | "on"
      readonly allowFallback: boolean
    }
    readonly benchmark: {
      readonly status: "idle" | "running" | "completed" | "cancelled" | "error"
      readonly profile: "fast" | "balanced" | "quality"
      readonly startedAt?: number
      readonly completedAt?: number
      readonly activeModel?: { readonly providerID: string; readonly modelID: string }
      readonly results: ReadonlyArray<{
        readonly model: { readonly providerID: string; readonly modelID: string }
        readonly endpoint: string
        readonly instance: string
        readonly testedAt: number
        readonly expiresAt: number
        readonly ttftMs: number
        readonly totalMs: number
        readonly tokensPerSecond: number | "Infinity" | "-Infinity" | "NaN"
        readonly outputTokens: number
        readonly context: number
        readonly memoryBytes?: number
        readonly ukrainian: boolean
        readonly instructions: boolean
        readonly toolCalling: boolean
        readonly accepted: boolean
        readonly score: number | "Infinity" | "-Infinity" | "NaN"
        readonly error?: string
      }>
      readonly selected?: { readonly providerID: string; readonly modelID: string }
      readonly fallback: ReadonlyArray<{ readonly providerID: string; readonly modelID: string }>
      readonly error?: string
    }
    readonly initiative: {
      readonly enabled: boolean
      readonly quietStart: string
      readonly quietEnd: string
      readonly reflectionLimit: number
      readonly eventLimit: number
      readonly topicCooldownMinutes: number
    }
    readonly updatedAt: number
  }["updatedAt"]
}

export type ServerJarvisUpdateConfigOutput = {
  readonly primaryProfileID?: string
  readonly inboxSessionID?: string
  readonly models: {
    readonly dialogue?: { readonly providerID: string; readonly modelID: string }
    readonly planner?: { readonly providerID: string; readonly modelID: string }
    readonly embedding?: { readonly providerID: string; readonly modelID: string }
  }
  readonly plannerTimeoutMs: number
  readonly plannerIdleUnloadMs: number
  readonly plannerEscalationMinWords: number
  readonly reactor: {
    readonly profile: "fast" | "balanced" | "quality"
    readonly dialogueReasoning: "off" | "on"
    readonly plannerReasoning: "off" | "on"
    readonly allowFallback: boolean
  }
  readonly benchmark: {
    readonly status: "idle" | "running" | "completed" | "cancelled" | "error"
    readonly profile: "fast" | "balanced" | "quality"
    readonly startedAt?: number
    readonly completedAt?: number
    readonly activeModel?: { readonly providerID: string; readonly modelID: string }
    readonly results: ReadonlyArray<{
      readonly model: { readonly providerID: string; readonly modelID: string }
      readonly endpoint: string
      readonly instance: string
      readonly testedAt: number
      readonly expiresAt: number
      readonly ttftMs: number
      readonly totalMs: number
      readonly tokensPerSecond: number | "Infinity" | "-Infinity" | "NaN"
      readonly outputTokens: number
      readonly context: number
      readonly memoryBytes?: number
      readonly ukrainian: boolean
      readonly instructions: boolean
      readonly toolCalling: boolean
      readonly accepted: boolean
      readonly score: number | "Infinity" | "-Infinity" | "NaN"
      readonly error?: string
    }>
    readonly selected?: { readonly providerID: string; readonly modelID: string }
    readonly fallback: ReadonlyArray<{ readonly providerID: string; readonly modelID: string }>
    readonly error?: string
  }
  readonly initiative: {
    readonly enabled: boolean
    readonly quietStart: string
    readonly quietEnd: string
    readonly reflectionLimit: number
    readonly eventLimit: number
    readonly topicCooldownMinutes: number
  }
  readonly updatedAt: number
}

export type ServerJarvisBenchmarkStatusOutput = {
  readonly status: "idle" | "running" | "completed" | "cancelled" | "error"
  readonly profile: "fast" | "balanced" | "quality"
  readonly startedAt?: number
  readonly completedAt?: number
  readonly activeModel?: { readonly providerID: string; readonly modelID: string }
  readonly results: ReadonlyArray<{
    readonly model: { readonly providerID: string; readonly modelID: string }
    readonly endpoint: string
    readonly instance: string
    readonly testedAt: number
    readonly expiresAt: number
    readonly ttftMs: number
    readonly totalMs: number
    readonly tokensPerSecond: number | "Infinity" | "-Infinity" | "NaN"
    readonly outputTokens: number
    readonly context: number
    readonly memoryBytes?: number
    readonly ukrainian: boolean
    readonly instructions: boolean
    readonly toolCalling: boolean
    readonly accepted: boolean
    readonly score: number | "Infinity" | "-Infinity" | "NaN"
    readonly error?: string
  }>
  readonly selected?: { readonly providerID: string; readonly modelID: string }
  readonly fallback: ReadonlyArray<{ readonly providerID: string; readonly modelID: string }>
  readonly error?: string
}

export type ServerJarvisRunBenchmarkInput = {
  readonly profile: { readonly profile: "fast" | "balanced" | "quality" }["profile"]
}

export type ServerJarvisRunBenchmarkOutput = {
  readonly status: "idle" | "running" | "completed" | "cancelled" | "error"
  readonly profile: "fast" | "balanced" | "quality"
  readonly startedAt?: number
  readonly completedAt?: number
  readonly activeModel?: { readonly providerID: string; readonly modelID: string }
  readonly results: ReadonlyArray<{
    readonly model: { readonly providerID: string; readonly modelID: string }
    readonly endpoint: string
    readonly instance: string
    readonly testedAt: number
    readonly expiresAt: number
    readonly ttftMs: number
    readonly totalMs: number
    readonly tokensPerSecond: number | "Infinity" | "-Infinity" | "NaN"
    readonly outputTokens: number
    readonly context: number
    readonly memoryBytes?: number
    readonly ukrainian: boolean
    readonly instructions: boolean
    readonly toolCalling: boolean
    readonly accepted: boolean
    readonly score: number | "Infinity" | "-Infinity" | "NaN"
    readonly error?: string
  }>
  readonly selected?: { readonly providerID: string; readonly modelID: string }
  readonly fallback: ReadonlyArray<{ readonly providerID: string; readonly modelID: string }>
  readonly error?: string
}

export type ServerJarvisCancelBenchmarkOutput = {
  readonly status: "idle" | "running" | "completed" | "cancelled" | "error"
  readonly profile: "fast" | "balanced" | "quality"
  readonly startedAt?: number
  readonly completedAt?: number
  readonly activeModel?: { readonly providerID: string; readonly modelID: string }
  readonly results: ReadonlyArray<{
    readonly model: { readonly providerID: string; readonly modelID: string }
    readonly endpoint: string
    readonly instance: string
    readonly testedAt: number
    readonly expiresAt: number
    readonly ttftMs: number
    readonly totalMs: number
    readonly tokensPerSecond: number | "Infinity" | "-Infinity" | "NaN"
    readonly outputTokens: number
    readonly context: number
    readonly memoryBytes?: number
    readonly ukrainian: boolean
    readonly instructions: boolean
    readonly toolCalling: boolean
    readonly accepted: boolean
    readonly score: number | "Infinity" | "-Infinity" | "NaN"
    readonly error?: string
  }>
  readonly selected?: { readonly providerID: string; readonly modelID: string }
  readonly fallback: ReadonlyArray<{ readonly providerID: string; readonly modelID: string }>
  readonly error?: string
}

export type ServerJarvisProfilesOutput = ReadonlyArray<{
  readonly id: string
  readonly revision: number
  readonly name: string
  readonly userName?: string
  readonly addressAs?: string
  readonly language: string
  readonly archetype: "natural" | "military" | "depressive" | "clown" | "jarvis" | "mentor" | "sarcastic"
  readonly tone: string
  readonly detail: string
  readonly humor: string
  readonly proactivity: string
  readonly instructions: string
  readonly catchphrases: ReadonlyArray<string>
  readonly primary: boolean
  readonly updatedAt: number
}>

export type ServerJarvisSyncProfilesInput = {
  readonly profiles: {
    readonly profiles: ReadonlyArray<{
      readonly id: string
      readonly revision: number
      readonly name: string
      readonly userName?: string
      readonly addressAs?: string
      readonly language: string
      readonly archetype: "natural" | "military" | "depressive" | "clown" | "jarvis" | "mentor" | "sarcastic"
      readonly tone: string
      readonly detail: string
      readonly humor: string
      readonly proactivity: string
      readonly instructions: string
      readonly catchphrases: ReadonlyArray<string>
      readonly primary: boolean
      readonly updatedAt: number
    }>
    readonly primaryProfileID?: string
  }["profiles"]
  readonly primaryProfileID?: {
    readonly profiles: ReadonlyArray<{
      readonly id: string
      readonly revision: number
      readonly name: string
      readonly userName?: string
      readonly addressAs?: string
      readonly language: string
      readonly archetype: "natural" | "military" | "depressive" | "clown" | "jarvis" | "mentor" | "sarcastic"
      readonly tone: string
      readonly detail: string
      readonly humor: string
      readonly proactivity: string
      readonly instructions: string
      readonly catchphrases: ReadonlyArray<string>
      readonly primary: boolean
      readonly updatedAt: number
    }>
    readonly primaryProfileID?: string
  }["primaryProfileID"]
}

export type ServerJarvisSyncProfilesOutput = ReadonlyArray<{
  readonly id: string
  readonly revision: number
  readonly name: string
  readonly userName?: string
  readonly addressAs?: string
  readonly language: string
  readonly archetype: "natural" | "military" | "depressive" | "clown" | "jarvis" | "mentor" | "sarcastic"
  readonly tone: string
  readonly detail: string
  readonly humor: string
  readonly proactivity: string
  readonly instructions: string
  readonly catchphrases: ReadonlyArray<string>
  readonly primary: boolean
  readonly updatedAt: number
}>

export type ServerJarvisGoalsInput = {
  readonly status?: {
    readonly status?: "pending" | "planning" | "active" | "suspended" | "completed" | "failed" | "cancelled" | undefined
  }["status"]
}

export type ServerJarvisGoalsOutput = ReadonlyArray<{
  readonly id: string
  readonly profileID: string
  readonly sessionID?: string
  readonly mode: "chat" | "unity"
  readonly gameID?: string
  readonly saveSlotID?: string
  readonly characterID?: string
  readonly objective: string
  readonly status: "pending" | "planning" | "active" | "suspended" | "completed" | "failed" | "cancelled"
  readonly suspensionReason?: string
  readonly worldRevision?: number
  readonly capabilityRevision?: string
  readonly actionCount: number
  readonly cycleStartedAt?: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly plan?: {
    readonly goal: string
    readonly steps: ReadonlyArray<{
      readonly id: string
      readonly goalID: string
      readonly position: number
      readonly action: string
      readonly arguments: { readonly [x: string]: JsonValue }
      readonly expectedPostconditions: ReadonlyArray<string>
      readonly status: "pending" | "running" | "completed" | "failed" | "suspended" | "cancelled"
      readonly attempts: number
      readonly lastError?: string
      readonly updatedAt: number
    }>
    readonly stopConditions: ReadonlyArray<string>
    readonly riskBudget: "ambient" | "interaction" | "critical"
    readonly replanConditions: ReadonlyArray<string>
  }
}>

export type ServerJarvisCreateGoalInput = {
  readonly profileID: {
    readonly profileID: string
    readonly sessionID?: string
    readonly mode: "chat" | "unity"
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly objective: string
    readonly worldRevision?: number
    readonly capabilityRevision?: string
  }["profileID"]
  readonly sessionID?: {
    readonly profileID: string
    readonly sessionID?: string
    readonly mode: "chat" | "unity"
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly objective: string
    readonly worldRevision?: number
    readonly capabilityRevision?: string
  }["sessionID"]
  readonly mode: {
    readonly profileID: string
    readonly sessionID?: string
    readonly mode: "chat" | "unity"
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly objective: string
    readonly worldRevision?: number
    readonly capabilityRevision?: string
  }["mode"]
  readonly gameID?: {
    readonly profileID: string
    readonly sessionID?: string
    readonly mode: "chat" | "unity"
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly objective: string
    readonly worldRevision?: number
    readonly capabilityRevision?: string
  }["gameID"]
  readonly saveSlotID?: {
    readonly profileID: string
    readonly sessionID?: string
    readonly mode: "chat" | "unity"
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly objective: string
    readonly worldRevision?: number
    readonly capabilityRevision?: string
  }["saveSlotID"]
  readonly characterID?: {
    readonly profileID: string
    readonly sessionID?: string
    readonly mode: "chat" | "unity"
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly objective: string
    readonly worldRevision?: number
    readonly capabilityRevision?: string
  }["characterID"]
  readonly objective: {
    readonly profileID: string
    readonly sessionID?: string
    readonly mode: "chat" | "unity"
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly objective: string
    readonly worldRevision?: number
    readonly capabilityRevision?: string
  }["objective"]
  readonly worldRevision?: {
    readonly profileID: string
    readonly sessionID?: string
    readonly mode: "chat" | "unity"
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly objective: string
    readonly worldRevision?: number
    readonly capabilityRevision?: string
  }["worldRevision"]
  readonly capabilityRevision?: {
    readonly profileID: string
    readonly sessionID?: string
    readonly mode: "chat" | "unity"
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly objective: string
    readonly worldRevision?: number
    readonly capabilityRevision?: string
  }["capabilityRevision"]
}

export type ServerJarvisCreateGoalOutput = {
  readonly id: string
  readonly profileID: string
  readonly sessionID?: string
  readonly mode: "chat" | "unity"
  readonly gameID?: string
  readonly saveSlotID?: string
  readonly characterID?: string
  readonly objective: string
  readonly status: "pending" | "planning" | "active" | "suspended" | "completed" | "failed" | "cancelled"
  readonly suspensionReason?: string
  readonly worldRevision?: number
  readonly capabilityRevision?: string
  readonly actionCount: number
  readonly cycleStartedAt?: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly plan?: {
    readonly goal: string
    readonly steps: ReadonlyArray<{
      readonly id: string
      readonly goalID: string
      readonly position: number
      readonly action: string
      readonly arguments: { readonly [x: string]: JsonValue }
      readonly expectedPostconditions: ReadonlyArray<string>
      readonly status: "pending" | "running" | "completed" | "failed" | "suspended" | "cancelled"
      readonly attempts: number
      readonly lastError?: string
      readonly updatedAt: number
    }>
    readonly stopConditions: ReadonlyArray<string>
    readonly riskBudget: "ambient" | "interaction" | "critical"
    readonly replanConditions: ReadonlyArray<string>
  }
}

export type ServerJarvisResumeGoalInput = {
  readonly goalID: { readonly goalID: string }["goalID"]
  readonly worldRevision: {
    readonly worldRevision: number
    readonly capabilityRevision: string
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
  }["worldRevision"]
  readonly capabilityRevision: {
    readonly worldRevision: number
    readonly capabilityRevision: string
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
  }["capabilityRevision"]
  readonly gameID?: {
    readonly worldRevision: number
    readonly capabilityRevision: string
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
  }["gameID"]
  readonly saveSlotID?: {
    readonly worldRevision: number
    readonly capabilityRevision: string
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
  }["saveSlotID"]
  readonly characterID?: {
    readonly worldRevision: number
    readonly capabilityRevision: string
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
  }["characterID"]
}

export type ServerJarvisResumeGoalOutput = {
  readonly id: string
  readonly profileID: string
  readonly sessionID?: string
  readonly mode: "chat" | "unity"
  readonly gameID?: string
  readonly saveSlotID?: string
  readonly characterID?: string
  readonly objective: string
  readonly status: "pending" | "planning" | "active" | "suspended" | "completed" | "failed" | "cancelled"
  readonly suspensionReason?: string
  readonly worldRevision?: number
  readonly capabilityRevision?: string
  readonly actionCount: number
  readonly cycleStartedAt?: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly plan?: {
    readonly goal: string
    readonly steps: ReadonlyArray<{
      readonly id: string
      readonly goalID: string
      readonly position: number
      readonly action: string
      readonly arguments: { readonly [x: string]: JsonValue }
      readonly expectedPostconditions: ReadonlyArray<string>
      readonly status: "pending" | "running" | "completed" | "failed" | "suspended" | "cancelled"
      readonly attempts: number
      readonly lastError?: string
      readonly updatedAt: number
    }>
    readonly stopConditions: ReadonlyArray<string>
    readonly riskBudget: "ambient" | "interaction" | "critical"
    readonly replanConditions: ReadonlyArray<string>
  }
} | null

export type ServerJarvisReplanGoalInput = {
  readonly goalID: { readonly goalID: string }["goalID"]
  readonly reason?: { readonly reason?: string }["reason"]
}

export type ServerJarvisReplanGoalOutput = {
  readonly id: string
  readonly profileID: string
  readonly sessionID?: string
  readonly mode: "chat" | "unity"
  readonly gameID?: string
  readonly saveSlotID?: string
  readonly characterID?: string
  readonly objective: string
  readonly status: "pending" | "planning" | "active" | "suspended" | "completed" | "failed" | "cancelled"
  readonly suspensionReason?: string
  readonly worldRevision?: number
  readonly capabilityRevision?: string
  readonly actionCount: number
  readonly cycleStartedAt?: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly plan?: {
    readonly goal: string
    readonly steps: ReadonlyArray<{
      readonly id: string
      readonly goalID: string
      readonly position: number
      readonly action: string
      readonly arguments: { readonly [x: string]: JsonValue }
      readonly expectedPostconditions: ReadonlyArray<string>
      readonly status: "pending" | "running" | "completed" | "failed" | "suspended" | "cancelled"
      readonly attempts: number
      readonly lastError?: string
      readonly updatedAt: number
    }>
    readonly stopConditions: ReadonlyArray<string>
    readonly riskBudget: "ambient" | "interaction" | "critical"
    readonly replanConditions: ReadonlyArray<string>
  }
} | null

export type ServerJarvisCancelGoalInput = {
  readonly goalID: { readonly goalID: string }["goalID"]
  readonly summary?: { readonly summary?: string; readonly changedEntityIDs?: ReadonlyArray<string> }["summary"]
  readonly changedEntityIDs?: {
    readonly summary?: string
    readonly changedEntityIDs?: ReadonlyArray<string>
  }["changedEntityIDs"]
}

export type ServerJarvisCancelGoalOutput = {
  readonly id: string
  readonly goalID: string
  readonly status: "completed" | "failed" | "cancelled"
  readonly summary: string
  readonly changedEntityIDs: ReadonlyArray<string>
  readonly createdAt: number
} | null

export type ServerJarvisRecordGoalStepInput = {
  readonly goalID: { readonly goalID: string }["goalID"]
  readonly stepID: { readonly stepID: string; readonly success: boolean; readonly error?: string }["stepID"]
  readonly success: { readonly stepID: string; readonly success: boolean; readonly error?: string }["success"]
  readonly error?: { readonly stepID: string; readonly success: boolean; readonly error?: string }["error"]
}

export type ServerJarvisRecordGoalStepOutput = {
  readonly id: string
  readonly profileID: string
  readonly sessionID?: string
  readonly mode: "chat" | "unity"
  readonly gameID?: string
  readonly saveSlotID?: string
  readonly characterID?: string
  readonly objective: string
  readonly status: "pending" | "planning" | "active" | "suspended" | "completed" | "failed" | "cancelled"
  readonly suspensionReason?: string
  readonly worldRevision?: number
  readonly capabilityRevision?: string
  readonly actionCount: number
  readonly cycleStartedAt?: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly plan?: {
    readonly goal: string
    readonly steps: ReadonlyArray<{
      readonly id: string
      readonly goalID: string
      readonly position: number
      readonly action: string
      readonly arguments: { readonly [x: string]: JsonValue }
      readonly expectedPostconditions: ReadonlyArray<string>
      readonly status: "pending" | "running" | "completed" | "failed" | "suspended" | "cancelled"
      readonly attempts: number
      readonly lastError?: string
      readonly updatedAt: number
    }>
    readonly stopConditions: ReadonlyArray<string>
    readonly riskBudget: "ambient" | "interaction" | "critical"
    readonly replanConditions: ReadonlyArray<string>
  }
} | null

export type ServerJarvisOutcomesInput = { readonly goalID?: { readonly goalID?: string | undefined }["goalID"] }

export type ServerJarvisOutcomesOutput = ReadonlyArray<{
  readonly id: string
  readonly goalID: string
  readonly status: "completed" | "failed" | "cancelled"
  readonly summary: string
  readonly changedEntityIDs: ReadonlyArray<string>
  readonly createdAt: number
}>

export type ServerJarvisCompleteGoalInput = {
  readonly goalID: { readonly goalID: string }["goalID"]
  readonly status: {
    readonly status: "completed" | "failed" | "cancelled"
    readonly summary: string
    readonly changedEntityIDs: ReadonlyArray<string>
  }["status"]
  readonly summary: {
    readonly status: "completed" | "failed" | "cancelled"
    readonly summary: string
    readonly changedEntityIDs: ReadonlyArray<string>
  }["summary"]
  readonly changedEntityIDs: {
    readonly status: "completed" | "failed" | "cancelled"
    readonly summary: string
    readonly changedEntityIDs: ReadonlyArray<string>
  }["changedEntityIDs"]
}

export type ServerJarvisCompleteGoalOutput = {
  readonly id: string
  readonly goalID: string
  readonly status: "completed" | "failed" | "cancelled"
  readonly summary: string
  readonly changedEntityIDs: ReadonlyArray<string>
  readonly createdAt: number
} | null

export type ServerJarvisSearchMemoryInput = {
  readonly query: {
    readonly query: string
    readonly profileID?: string
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly limit?: number
    readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
  }["query"]
  readonly profileID?: {
    readonly query: string
    readonly profileID?: string
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly limit?: number
    readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
  }["profileID"]
  readonly gameID?: {
    readonly query: string
    readonly profileID?: string
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly limit?: number
    readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
  }["gameID"]
  readonly saveSlotID?: {
    readonly query: string
    readonly profileID?: string
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly limit?: number
    readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
  }["saveSlotID"]
  readonly characterID?: {
    readonly query: string
    readonly profileID?: string
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly limit?: number
    readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
  }["characterID"]
  readonly limit?: {
    readonly query: string
    readonly profileID?: string
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly limit?: number
    readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
  }["limit"]
  readonly embedding?: {
    readonly query: string
    readonly profileID?: string
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly limit?: number
    readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
  }["embedding"]
}

export type ServerJarvisSearchMemoryOutput = ReadonlyArray<{
  readonly id: string
  readonly profileID?: string
  readonly scope: "user" | "profile" | "game" | "working"
  readonly gameID?: string
  readonly saveSlotID?: string
  readonly characterID?: string
  readonly kind: "preference" | "episode" | "relationship" | "promise" | "knowledge" | "correction" | "plan"
  readonly text: string
  readonly sourceID: string
  readonly confidence: number | "Infinity" | "-Infinity" | "NaN"
  readonly importance: number | "Infinity" | "-Infinity" | "NaN"
  readonly lifecycle: "candidate" | "verified" | "archived"
  readonly pinned: boolean
  readonly conflictsWith: ReadonlyArray<string>
  readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
  readonly embeddingModel?: { readonly providerID: string; readonly modelID: string }
  readonly createdAt: number
  readonly updatedAt: number
  readonly lastUsedAt?: number
}>

export type ServerJarvisRememberInput = {
  readonly id: {
    readonly id: string
    readonly profileID?: string
    readonly scope: "user" | "profile" | "game" | "working"
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly kind: "preference" | "episode" | "relationship" | "promise" | "knowledge" | "correction" | "plan"
    readonly text: string
    readonly sourceID: string
    readonly confidence: number | "Infinity" | "-Infinity" | "NaN"
    readonly importance: number | "Infinity" | "-Infinity" | "NaN"
    readonly lifecycle: "candidate" | "verified" | "archived"
    readonly pinned: boolean
    readonly conflictsWith: ReadonlyArray<string>
    readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
    readonly embeddingModel?: { readonly providerID: string; readonly modelID: string }
    readonly createdAt: number
    readonly updatedAt: number
    readonly lastUsedAt?: number
  }["id"]
  readonly profileID?: {
    readonly id: string
    readonly profileID?: string
    readonly scope: "user" | "profile" | "game" | "working"
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly kind: "preference" | "episode" | "relationship" | "promise" | "knowledge" | "correction" | "plan"
    readonly text: string
    readonly sourceID: string
    readonly confidence: number | "Infinity" | "-Infinity" | "NaN"
    readonly importance: number | "Infinity" | "-Infinity" | "NaN"
    readonly lifecycle: "candidate" | "verified" | "archived"
    readonly pinned: boolean
    readonly conflictsWith: ReadonlyArray<string>
    readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
    readonly embeddingModel?: { readonly providerID: string; readonly modelID: string }
    readonly createdAt: number
    readonly updatedAt: number
    readonly lastUsedAt?: number
  }["profileID"]
  readonly scope: {
    readonly id: string
    readonly profileID?: string
    readonly scope: "user" | "profile" | "game" | "working"
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly kind: "preference" | "episode" | "relationship" | "promise" | "knowledge" | "correction" | "plan"
    readonly text: string
    readonly sourceID: string
    readonly confidence: number | "Infinity" | "-Infinity" | "NaN"
    readonly importance: number | "Infinity" | "-Infinity" | "NaN"
    readonly lifecycle: "candidate" | "verified" | "archived"
    readonly pinned: boolean
    readonly conflictsWith: ReadonlyArray<string>
    readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
    readonly embeddingModel?: { readonly providerID: string; readonly modelID: string }
    readonly createdAt: number
    readonly updatedAt: number
    readonly lastUsedAt?: number
  }["scope"]
  readonly gameID?: {
    readonly id: string
    readonly profileID?: string
    readonly scope: "user" | "profile" | "game" | "working"
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly kind: "preference" | "episode" | "relationship" | "promise" | "knowledge" | "correction" | "plan"
    readonly text: string
    readonly sourceID: string
    readonly confidence: number | "Infinity" | "-Infinity" | "NaN"
    readonly importance: number | "Infinity" | "-Infinity" | "NaN"
    readonly lifecycle: "candidate" | "verified" | "archived"
    readonly pinned: boolean
    readonly conflictsWith: ReadonlyArray<string>
    readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
    readonly embeddingModel?: { readonly providerID: string; readonly modelID: string }
    readonly createdAt: number
    readonly updatedAt: number
    readonly lastUsedAt?: number
  }["gameID"]
  readonly saveSlotID?: {
    readonly id: string
    readonly profileID?: string
    readonly scope: "user" | "profile" | "game" | "working"
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly kind: "preference" | "episode" | "relationship" | "promise" | "knowledge" | "correction" | "plan"
    readonly text: string
    readonly sourceID: string
    readonly confidence: number | "Infinity" | "-Infinity" | "NaN"
    readonly importance: number | "Infinity" | "-Infinity" | "NaN"
    readonly lifecycle: "candidate" | "verified" | "archived"
    readonly pinned: boolean
    readonly conflictsWith: ReadonlyArray<string>
    readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
    readonly embeddingModel?: { readonly providerID: string; readonly modelID: string }
    readonly createdAt: number
    readonly updatedAt: number
    readonly lastUsedAt?: number
  }["saveSlotID"]
  readonly characterID?: {
    readonly id: string
    readonly profileID?: string
    readonly scope: "user" | "profile" | "game" | "working"
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly kind: "preference" | "episode" | "relationship" | "promise" | "knowledge" | "correction" | "plan"
    readonly text: string
    readonly sourceID: string
    readonly confidence: number | "Infinity" | "-Infinity" | "NaN"
    readonly importance: number | "Infinity" | "-Infinity" | "NaN"
    readonly lifecycle: "candidate" | "verified" | "archived"
    readonly pinned: boolean
    readonly conflictsWith: ReadonlyArray<string>
    readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
    readonly embeddingModel?: { readonly providerID: string; readonly modelID: string }
    readonly createdAt: number
    readonly updatedAt: number
    readonly lastUsedAt?: number
  }["characterID"]
  readonly kind: {
    readonly id: string
    readonly profileID?: string
    readonly scope: "user" | "profile" | "game" | "working"
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly kind: "preference" | "episode" | "relationship" | "promise" | "knowledge" | "correction" | "plan"
    readonly text: string
    readonly sourceID: string
    readonly confidence: number | "Infinity" | "-Infinity" | "NaN"
    readonly importance: number | "Infinity" | "-Infinity" | "NaN"
    readonly lifecycle: "candidate" | "verified" | "archived"
    readonly pinned: boolean
    readonly conflictsWith: ReadonlyArray<string>
    readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
    readonly embeddingModel?: { readonly providerID: string; readonly modelID: string }
    readonly createdAt: number
    readonly updatedAt: number
    readonly lastUsedAt?: number
  }["kind"]
  readonly text: {
    readonly id: string
    readonly profileID?: string
    readonly scope: "user" | "profile" | "game" | "working"
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly kind: "preference" | "episode" | "relationship" | "promise" | "knowledge" | "correction" | "plan"
    readonly text: string
    readonly sourceID: string
    readonly confidence: number | "Infinity" | "-Infinity" | "NaN"
    readonly importance: number | "Infinity" | "-Infinity" | "NaN"
    readonly lifecycle: "candidate" | "verified" | "archived"
    readonly pinned: boolean
    readonly conflictsWith: ReadonlyArray<string>
    readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
    readonly embeddingModel?: { readonly providerID: string; readonly modelID: string }
    readonly createdAt: number
    readonly updatedAt: number
    readonly lastUsedAt?: number
  }["text"]
  readonly sourceID: {
    readonly id: string
    readonly profileID?: string
    readonly scope: "user" | "profile" | "game" | "working"
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly kind: "preference" | "episode" | "relationship" | "promise" | "knowledge" | "correction" | "plan"
    readonly text: string
    readonly sourceID: string
    readonly confidence: number | "Infinity" | "-Infinity" | "NaN"
    readonly importance: number | "Infinity" | "-Infinity" | "NaN"
    readonly lifecycle: "candidate" | "verified" | "archived"
    readonly pinned: boolean
    readonly conflictsWith: ReadonlyArray<string>
    readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
    readonly embeddingModel?: { readonly providerID: string; readonly modelID: string }
    readonly createdAt: number
    readonly updatedAt: number
    readonly lastUsedAt?: number
  }["sourceID"]
  readonly confidence: {
    readonly id: string
    readonly profileID?: string
    readonly scope: "user" | "profile" | "game" | "working"
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly kind: "preference" | "episode" | "relationship" | "promise" | "knowledge" | "correction" | "plan"
    readonly text: string
    readonly sourceID: string
    readonly confidence: number | "Infinity" | "-Infinity" | "NaN"
    readonly importance: number | "Infinity" | "-Infinity" | "NaN"
    readonly lifecycle: "candidate" | "verified" | "archived"
    readonly pinned: boolean
    readonly conflictsWith: ReadonlyArray<string>
    readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
    readonly embeddingModel?: { readonly providerID: string; readonly modelID: string }
    readonly createdAt: number
    readonly updatedAt: number
    readonly lastUsedAt?: number
  }["confidence"]
  readonly importance: {
    readonly id: string
    readonly profileID?: string
    readonly scope: "user" | "profile" | "game" | "working"
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly kind: "preference" | "episode" | "relationship" | "promise" | "knowledge" | "correction" | "plan"
    readonly text: string
    readonly sourceID: string
    readonly confidence: number | "Infinity" | "-Infinity" | "NaN"
    readonly importance: number | "Infinity" | "-Infinity" | "NaN"
    readonly lifecycle: "candidate" | "verified" | "archived"
    readonly pinned: boolean
    readonly conflictsWith: ReadonlyArray<string>
    readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
    readonly embeddingModel?: { readonly providerID: string; readonly modelID: string }
    readonly createdAt: number
    readonly updatedAt: number
    readonly lastUsedAt?: number
  }["importance"]
  readonly lifecycle: {
    readonly id: string
    readonly profileID?: string
    readonly scope: "user" | "profile" | "game" | "working"
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly kind: "preference" | "episode" | "relationship" | "promise" | "knowledge" | "correction" | "plan"
    readonly text: string
    readonly sourceID: string
    readonly confidence: number | "Infinity" | "-Infinity" | "NaN"
    readonly importance: number | "Infinity" | "-Infinity" | "NaN"
    readonly lifecycle: "candidate" | "verified" | "archived"
    readonly pinned: boolean
    readonly conflictsWith: ReadonlyArray<string>
    readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
    readonly embeddingModel?: { readonly providerID: string; readonly modelID: string }
    readonly createdAt: number
    readonly updatedAt: number
    readonly lastUsedAt?: number
  }["lifecycle"]
  readonly pinned: {
    readonly id: string
    readonly profileID?: string
    readonly scope: "user" | "profile" | "game" | "working"
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly kind: "preference" | "episode" | "relationship" | "promise" | "knowledge" | "correction" | "plan"
    readonly text: string
    readonly sourceID: string
    readonly confidence: number | "Infinity" | "-Infinity" | "NaN"
    readonly importance: number | "Infinity" | "-Infinity" | "NaN"
    readonly lifecycle: "candidate" | "verified" | "archived"
    readonly pinned: boolean
    readonly conflictsWith: ReadonlyArray<string>
    readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
    readonly embeddingModel?: { readonly providerID: string; readonly modelID: string }
    readonly createdAt: number
    readonly updatedAt: number
    readonly lastUsedAt?: number
  }["pinned"]
  readonly conflictsWith: {
    readonly id: string
    readonly profileID?: string
    readonly scope: "user" | "profile" | "game" | "working"
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly kind: "preference" | "episode" | "relationship" | "promise" | "knowledge" | "correction" | "plan"
    readonly text: string
    readonly sourceID: string
    readonly confidence: number | "Infinity" | "-Infinity" | "NaN"
    readonly importance: number | "Infinity" | "-Infinity" | "NaN"
    readonly lifecycle: "candidate" | "verified" | "archived"
    readonly pinned: boolean
    readonly conflictsWith: ReadonlyArray<string>
    readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
    readonly embeddingModel?: { readonly providerID: string; readonly modelID: string }
    readonly createdAt: number
    readonly updatedAt: number
    readonly lastUsedAt?: number
  }["conflictsWith"]
  readonly embedding?: {
    readonly id: string
    readonly profileID?: string
    readonly scope: "user" | "profile" | "game" | "working"
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly kind: "preference" | "episode" | "relationship" | "promise" | "knowledge" | "correction" | "plan"
    readonly text: string
    readonly sourceID: string
    readonly confidence: number | "Infinity" | "-Infinity" | "NaN"
    readonly importance: number | "Infinity" | "-Infinity" | "NaN"
    readonly lifecycle: "candidate" | "verified" | "archived"
    readonly pinned: boolean
    readonly conflictsWith: ReadonlyArray<string>
    readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
    readonly embeddingModel?: { readonly providerID: string; readonly modelID: string }
    readonly createdAt: number
    readonly updatedAt: number
    readonly lastUsedAt?: number
  }["embedding"]
  readonly embeddingModel?: {
    readonly id: string
    readonly profileID?: string
    readonly scope: "user" | "profile" | "game" | "working"
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly kind: "preference" | "episode" | "relationship" | "promise" | "knowledge" | "correction" | "plan"
    readonly text: string
    readonly sourceID: string
    readonly confidence: number | "Infinity" | "-Infinity" | "NaN"
    readonly importance: number | "Infinity" | "-Infinity" | "NaN"
    readonly lifecycle: "candidate" | "verified" | "archived"
    readonly pinned: boolean
    readonly conflictsWith: ReadonlyArray<string>
    readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
    readonly embeddingModel?: { readonly providerID: string; readonly modelID: string }
    readonly createdAt: number
    readonly updatedAt: number
    readonly lastUsedAt?: number
  }["embeddingModel"]
  readonly createdAt: {
    readonly id: string
    readonly profileID?: string
    readonly scope: "user" | "profile" | "game" | "working"
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly kind: "preference" | "episode" | "relationship" | "promise" | "knowledge" | "correction" | "plan"
    readonly text: string
    readonly sourceID: string
    readonly confidence: number | "Infinity" | "-Infinity" | "NaN"
    readonly importance: number | "Infinity" | "-Infinity" | "NaN"
    readonly lifecycle: "candidate" | "verified" | "archived"
    readonly pinned: boolean
    readonly conflictsWith: ReadonlyArray<string>
    readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
    readonly embeddingModel?: { readonly providerID: string; readonly modelID: string }
    readonly createdAt: number
    readonly updatedAt: number
    readonly lastUsedAt?: number
  }["createdAt"]
  readonly updatedAt: {
    readonly id: string
    readonly profileID?: string
    readonly scope: "user" | "profile" | "game" | "working"
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly kind: "preference" | "episode" | "relationship" | "promise" | "knowledge" | "correction" | "plan"
    readonly text: string
    readonly sourceID: string
    readonly confidence: number | "Infinity" | "-Infinity" | "NaN"
    readonly importance: number | "Infinity" | "-Infinity" | "NaN"
    readonly lifecycle: "candidate" | "verified" | "archived"
    readonly pinned: boolean
    readonly conflictsWith: ReadonlyArray<string>
    readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
    readonly embeddingModel?: { readonly providerID: string; readonly modelID: string }
    readonly createdAt: number
    readonly updatedAt: number
    readonly lastUsedAt?: number
  }["updatedAt"]
  readonly lastUsedAt?: {
    readonly id: string
    readonly profileID?: string
    readonly scope: "user" | "profile" | "game" | "working"
    readonly gameID?: string
    readonly saveSlotID?: string
    readonly characterID?: string
    readonly kind: "preference" | "episode" | "relationship" | "promise" | "knowledge" | "correction" | "plan"
    readonly text: string
    readonly sourceID: string
    readonly confidence: number | "Infinity" | "-Infinity" | "NaN"
    readonly importance: number | "Infinity" | "-Infinity" | "NaN"
    readonly lifecycle: "candidate" | "verified" | "archived"
    readonly pinned: boolean
    readonly conflictsWith: ReadonlyArray<string>
    readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
    readonly embeddingModel?: { readonly providerID: string; readonly modelID: string }
    readonly createdAt: number
    readonly updatedAt: number
    readonly lastUsedAt?: number
  }["lastUsedAt"]
}

export type ServerJarvisRememberOutput = {
  readonly id: string
  readonly profileID?: string
  readonly scope: "user" | "profile" | "game" | "working"
  readonly gameID?: string
  readonly saveSlotID?: string
  readonly characterID?: string
  readonly kind: "preference" | "episode" | "relationship" | "promise" | "knowledge" | "correction" | "plan"
  readonly text: string
  readonly sourceID: string
  readonly confidence: number | "Infinity" | "-Infinity" | "NaN"
  readonly importance: number | "Infinity" | "-Infinity" | "NaN"
  readonly lifecycle: "candidate" | "verified" | "archived"
  readonly pinned: boolean
  readonly conflictsWith: ReadonlyArray<string>
  readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
  readonly embeddingModel?: { readonly providerID: string; readonly modelID: string }
  readonly createdAt: number
  readonly updatedAt: number
  readonly lastUsedAt?: number
}

export type ServerJarvisRemoveMemoryInput = { readonly memoryID: { readonly memoryID: string }["memoryID"] }

export type ServerJarvisRemoveMemoryOutput = { readonly changed: number }

export type ServerJarvisPatchMemoryInput = {
  readonly memoryID: { readonly memoryID: string }["memoryID"]
  readonly text?: {
    readonly text?: string
    readonly confidence?: number | "Infinity" | "-Infinity" | "NaN"
    readonly importance?: number | "Infinity" | "-Infinity" | "NaN"
    readonly lifecycle?: "candidate" | "verified" | "archived"
    readonly pinned?: boolean
  }["text"]
  readonly confidence?: {
    readonly text?: string
    readonly confidence?: number | "Infinity" | "-Infinity" | "NaN"
    readonly importance?: number | "Infinity" | "-Infinity" | "NaN"
    readonly lifecycle?: "candidate" | "verified" | "archived"
    readonly pinned?: boolean
  }["confidence"]
  readonly importance?: {
    readonly text?: string
    readonly confidence?: number | "Infinity" | "-Infinity" | "NaN"
    readonly importance?: number | "Infinity" | "-Infinity" | "NaN"
    readonly lifecycle?: "candidate" | "verified" | "archived"
    readonly pinned?: boolean
  }["importance"]
  readonly lifecycle?: {
    readonly text?: string
    readonly confidence?: number | "Infinity" | "-Infinity" | "NaN"
    readonly importance?: number | "Infinity" | "-Infinity" | "NaN"
    readonly lifecycle?: "candidate" | "verified" | "archived"
    readonly pinned?: boolean
  }["lifecycle"]
  readonly pinned?: {
    readonly text?: string
    readonly confidence?: number | "Infinity" | "-Infinity" | "NaN"
    readonly importance?: number | "Infinity" | "-Infinity" | "NaN"
    readonly lifecycle?: "candidate" | "verified" | "archived"
    readonly pinned?: boolean
  }["pinned"]
}

export type ServerJarvisPatchMemoryOutput = {
  readonly id: string
  readonly profileID?: string
  readonly scope: "user" | "profile" | "game" | "working"
  readonly gameID?: string
  readonly saveSlotID?: string
  readonly characterID?: string
  readonly kind: "preference" | "episode" | "relationship" | "promise" | "knowledge" | "correction" | "plan"
  readonly text: string
  readonly sourceID: string
  readonly confidence: number | "Infinity" | "-Infinity" | "NaN"
  readonly importance: number | "Infinity" | "-Infinity" | "NaN"
  readonly lifecycle: "candidate" | "verified" | "archived"
  readonly pinned: boolean
  readonly conflictsWith: ReadonlyArray<string>
  readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
  readonly embeddingModel?: { readonly providerID: string; readonly modelID: string }
  readonly createdAt: number
  readonly updatedAt: number
  readonly lastUsedAt?: number
} | null

export type ServerJarvisResolveMemoryConflictInput = {
  readonly memoryID: { readonly memoryID: string }["memoryID"]
  readonly action: {
    readonly action: "keep_both" | "choose_current" | "choose_other"
    readonly otherMemoryID: string
  }["action"]
  readonly otherMemoryID: {
    readonly action: "keep_both" | "choose_current" | "choose_other"
    readonly otherMemoryID: string
  }["otherMemoryID"]
}

export type ServerJarvisResolveMemoryConflictOutput = {
  readonly id: string
  readonly profileID?: string
  readonly scope: "user" | "profile" | "game" | "working"
  readonly gameID?: string
  readonly saveSlotID?: string
  readonly characterID?: string
  readonly kind: "preference" | "episode" | "relationship" | "promise" | "knowledge" | "correction" | "plan"
  readonly text: string
  readonly sourceID: string
  readonly confidence: number | "Infinity" | "-Infinity" | "NaN"
  readonly importance: number | "Infinity" | "-Infinity" | "NaN"
  readonly lifecycle: "candidate" | "verified" | "archived"
  readonly pinned: boolean
  readonly conflictsWith: ReadonlyArray<string>
  readonly embedding?: ReadonlyArray<number | "Infinity" | "-Infinity" | "NaN">
  readonly embeddingModel?: { readonly providerID: string; readonly modelID: string }
  readonly createdAt: number
  readonly updatedAt: number
  readonly lastUsedAt?: number
} | null

export type ServerJarvisReindexMemoryOutput = { readonly queued: number; readonly remaining: number }

export type ServerJarvisMemoryUsesInput = {
  readonly memoryID?: {
    readonly memoryID?: string | undefined
    readonly turnID?: string | undefined
    readonly limit?: number | undefined
  }["memoryID"]
  readonly turnID?: {
    readonly memoryID?: string | undefined
    readonly turnID?: string | undefined
    readonly limit?: number | undefined
  }["turnID"]
  readonly limit?: {
    readonly memoryID?: string | undefined
    readonly turnID?: string | undefined
    readonly limit?: number | undefined
  }["limit"]
}

export type ServerJarvisMemoryUsesOutput = ReadonlyArray<{
  readonly id: string
  readonly turnID: string
  readonly memoryID: string
  readonly rank: number
  readonly lexicalScore: number
  readonly semanticScore: number
  readonly reason: string
  readonly createdAt: number
}>

export type ServerJarvisRecordMemoryUseInput = {
  readonly turnID: {
    readonly turnID: string
    readonly memoryID: string
    readonly rank: number
    readonly lexicalScore?: number | "Infinity" | "-Infinity" | "NaN"
    readonly semanticScore?: number | "Infinity" | "-Infinity" | "NaN"
    readonly reason: string
  }["turnID"]
  readonly memoryID: {
    readonly turnID: string
    readonly memoryID: string
    readonly rank: number
    readonly lexicalScore?: number | "Infinity" | "-Infinity" | "NaN"
    readonly semanticScore?: number | "Infinity" | "-Infinity" | "NaN"
    readonly reason: string
  }["memoryID"]
  readonly rank: {
    readonly turnID: string
    readonly memoryID: string
    readonly rank: number
    readonly lexicalScore?: number | "Infinity" | "-Infinity" | "NaN"
    readonly semanticScore?: number | "Infinity" | "-Infinity" | "NaN"
    readonly reason: string
  }["rank"]
  readonly lexicalScore?: {
    readonly turnID: string
    readonly memoryID: string
    readonly rank: number
    readonly lexicalScore?: number | "Infinity" | "-Infinity" | "NaN"
    readonly semanticScore?: number | "Infinity" | "-Infinity" | "NaN"
    readonly reason: string
  }["lexicalScore"]
  readonly semanticScore?: {
    readonly turnID: string
    readonly memoryID: string
    readonly rank: number
    readonly lexicalScore?: number | "Infinity" | "-Infinity" | "NaN"
    readonly semanticScore?: number | "Infinity" | "-Infinity" | "NaN"
    readonly reason: string
  }["semanticScore"]
  readonly reason: {
    readonly turnID: string
    readonly memoryID: string
    readonly rank: number
    readonly lexicalScore?: number | "Infinity" | "-Infinity" | "NaN"
    readonly semanticScore?: number | "Infinity" | "-Infinity" | "NaN"
    readonly reason: string
  }["reason"]
}

export type ServerJarvisRecordMemoryUseOutput = {
  readonly id: string
  readonly turnID: string
  readonly memoryID: string
  readonly rank: number
  readonly lexicalScore: number
  readonly semanticScore: number
  readonly reason: string
  readonly createdAt: number
}

export type ServerJarvisReplaysInput = { readonly limit?: { readonly limit?: number | undefined }["limit"] }

export type ServerJarvisReplaysOutput = ReadonlyArray<{
  readonly id: string
  readonly turnID?: string
  readonly sessionID?: string
  readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
  readonly status: "recording" | "completed" | "cancelled" | "error"
  readonly events: ReadonlyArray<{
    readonly sequence: number
    readonly type: string
    readonly timestamp: number
    readonly data: { readonly [x: string]: JsonValue }
  }>
  readonly metrics: {
    readonly admittedAt?: number
    readonly providerStartedAt?: number
    readonly firstTextAt?: number
    readonly firstAudioAt?: number
    readonly completedAt?: number
    readonly sttMs?: number
    readonly ttftMs?: number
    readonly ttsMs?: number
    readonly cancelMs?: number
  }
  readonly error?: string
  readonly createdAt: number
  readonly updatedAt: number
}>

export type ServerJarvisRecordReplayInput = {
  readonly turnID?: {
    readonly turnID?: string
    readonly sessionID?: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly status?: "recording" | "completed" | "cancelled" | "error"
    readonly events: ReadonlyArray<{
      readonly sequence: number
      readonly type: string
      readonly timestamp: number
      readonly data: { readonly [x: string]: JsonValue }
    }>
    readonly metrics?: {
      readonly admittedAt?: number
      readonly providerStartedAt?: number
      readonly firstTextAt?: number
      readonly firstAudioAt?: number
      readonly completedAt?: number
      readonly sttMs?: number
      readonly ttftMs?: number
      readonly ttsMs?: number
      readonly cancelMs?: number
    }
    readonly error?: string
  }["turnID"]
  readonly sessionID?: {
    readonly turnID?: string
    readonly sessionID?: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly status?: "recording" | "completed" | "cancelled" | "error"
    readonly events: ReadonlyArray<{
      readonly sequence: number
      readonly type: string
      readonly timestamp: number
      readonly data: { readonly [x: string]: JsonValue }
    }>
    readonly metrics?: {
      readonly admittedAt?: number
      readonly providerStartedAt?: number
      readonly firstTextAt?: number
      readonly firstAudioAt?: number
      readonly completedAt?: number
      readonly sttMs?: number
      readonly ttftMs?: number
      readonly ttsMs?: number
      readonly cancelMs?: number
    }
    readonly error?: string
  }["sessionID"]
  readonly surface: {
    readonly turnID?: string
    readonly sessionID?: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly status?: "recording" | "completed" | "cancelled" | "error"
    readonly events: ReadonlyArray<{
      readonly sequence: number
      readonly type: string
      readonly timestamp: number
      readonly data: { readonly [x: string]: JsonValue }
    }>
    readonly metrics?: {
      readonly admittedAt?: number
      readonly providerStartedAt?: number
      readonly firstTextAt?: number
      readonly firstAudioAt?: number
      readonly completedAt?: number
      readonly sttMs?: number
      readonly ttftMs?: number
      readonly ttsMs?: number
      readonly cancelMs?: number
    }
    readonly error?: string
  }["surface"]
  readonly status?: {
    readonly turnID?: string
    readonly sessionID?: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly status?: "recording" | "completed" | "cancelled" | "error"
    readonly events: ReadonlyArray<{
      readonly sequence: number
      readonly type: string
      readonly timestamp: number
      readonly data: { readonly [x: string]: JsonValue }
    }>
    readonly metrics?: {
      readonly admittedAt?: number
      readonly providerStartedAt?: number
      readonly firstTextAt?: number
      readonly firstAudioAt?: number
      readonly completedAt?: number
      readonly sttMs?: number
      readonly ttftMs?: number
      readonly ttsMs?: number
      readonly cancelMs?: number
    }
    readonly error?: string
  }["status"]
  readonly events: {
    readonly turnID?: string
    readonly sessionID?: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly status?: "recording" | "completed" | "cancelled" | "error"
    readonly events: ReadonlyArray<{
      readonly sequence: number
      readonly type: string
      readonly timestamp: number
      readonly data: { readonly [x: string]: JsonValue }
    }>
    readonly metrics?: {
      readonly admittedAt?: number
      readonly providerStartedAt?: number
      readonly firstTextAt?: number
      readonly firstAudioAt?: number
      readonly completedAt?: number
      readonly sttMs?: number
      readonly ttftMs?: number
      readonly ttsMs?: number
      readonly cancelMs?: number
    }
    readonly error?: string
  }["events"]
  readonly metrics?: {
    readonly turnID?: string
    readonly sessionID?: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly status?: "recording" | "completed" | "cancelled" | "error"
    readonly events: ReadonlyArray<{
      readonly sequence: number
      readonly type: string
      readonly timestamp: number
      readonly data: { readonly [x: string]: JsonValue }
    }>
    readonly metrics?: {
      readonly admittedAt?: number
      readonly providerStartedAt?: number
      readonly firstTextAt?: number
      readonly firstAudioAt?: number
      readonly completedAt?: number
      readonly sttMs?: number
      readonly ttftMs?: number
      readonly ttsMs?: number
      readonly cancelMs?: number
    }
    readonly error?: string
  }["metrics"]
  readonly error?: {
    readonly turnID?: string
    readonly sessionID?: string
    readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
    readonly status?: "recording" | "completed" | "cancelled" | "error"
    readonly events: ReadonlyArray<{
      readonly sequence: number
      readonly type: string
      readonly timestamp: number
      readonly data: { readonly [x: string]: JsonValue }
    }>
    readonly metrics?: {
      readonly admittedAt?: number
      readonly providerStartedAt?: number
      readonly firstTextAt?: number
      readonly firstAudioAt?: number
      readonly completedAt?: number
      readonly sttMs?: number
      readonly ttftMs?: number
      readonly ttsMs?: number
      readonly cancelMs?: number
    }
    readonly error?: string
  }["error"]
}

export type ServerJarvisRecordReplayOutput = {
  readonly id: string
  readonly turnID?: string
  readonly sessionID?: string
  readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
  readonly status: "recording" | "completed" | "cancelled" | "error"
  readonly events: ReadonlyArray<{
    readonly sequence: number
    readonly type: string
    readonly timestamp: number
    readonly data: { readonly [x: string]: JsonValue }
  }>
  readonly metrics: {
    readonly admittedAt?: number
    readonly providerStartedAt?: number
    readonly firstTextAt?: number
    readonly firstAudioAt?: number
    readonly completedAt?: number
    readonly sttMs?: number
    readonly ttftMs?: number
    readonly ttsMs?: number
    readonly cancelMs?: number
  }
  readonly error?: string
  readonly createdAt: number
  readonly updatedAt: number
}

export type ServerJarvisReplayInput = { readonly replayID: { readonly replayID: string }["replayID"] }

export type ServerJarvisReplayOutput = {
  readonly id: string
  readonly turnID?: string
  readonly sessionID?: string
  readonly surface: "desktop" | "unity-editor" | "pcvr" | "quest"
  readonly status: "recording" | "completed" | "cancelled" | "error"
  readonly events: ReadonlyArray<{
    readonly sequence: number
    readonly type: string
    readonly timestamp: number
    readonly data: { readonly [x: string]: JsonValue }
  }>
  readonly metrics: {
    readonly admittedAt?: number
    readonly providerStartedAt?: number
    readonly firstTextAt?: number
    readonly firstAudioAt?: number
    readonly completedAt?: number
    readonly sttMs?: number
    readonly ttftMs?: number
    readonly ttsMs?: number
    readonly cancelMs?: number
  }
  readonly error?: string
  readonly createdAt: number
  readonly updatedAt: number
} | null

export type ServerJarvisRemoveReplayInput = { readonly replayID: { readonly replayID: string }["replayID"] }

export type ServerJarvisRemoveReplayOutput = { readonly changed: number }

export type ServerJarvisExecuteReplayInput = {
  readonly replayID: { readonly replayID: string }["replayID"]
  readonly fixtureOnly?: { readonly fixtureOnly?: boolean }["fixtureOnly"]
}

export type ServerJarvisExecuteReplayOutput = {
  readonly id: string
  readonly replayID: string
  readonly status: "queued" | "running" | "completed" | "error"
  readonly fixtureOnly: boolean
  readonly assertions: ReadonlyArray<{ readonly id: string; readonly passed: boolean; readonly detail?: string }>
  readonly metrics: {
    readonly admittedAt?: number
    readonly providerStartedAt?: number
    readonly firstTextAt?: number
    readonly firstAudioAt?: number
    readonly completedAt?: number
    readonly sttMs?: number
    readonly ttftMs?: number
    readonly ttsMs?: number
    readonly cancelMs?: number
  }
  readonly error?: string
  readonly createdAt: number
  readonly updatedAt: number
} | null

export type ServerJarvisReplayExecutionInput = { readonly executionID: { readonly executionID: string }["executionID"] }

export type ServerJarvisReplayExecutionOutput = {
  readonly id: string
  readonly replayID: string
  readonly status: "queued" | "running" | "completed" | "error"
  readonly fixtureOnly: boolean
  readonly assertions: ReadonlyArray<{ readonly id: string; readonly passed: boolean; readonly detail?: string }>
  readonly metrics: {
    readonly admittedAt?: number
    readonly providerStartedAt?: number
    readonly firstTextAt?: number
    readonly firstAudioAt?: number
    readonly completedAt?: number
    readonly sttMs?: number
    readonly ttftMs?: number
    readonly ttsMs?: number
    readonly cancelMs?: number
  }
  readonly error?: string
  readonly createdAt: number
  readonly updatedAt: number
} | null

export type ServerJarvisCompareReplaysInput = {
  readonly baselineExecutionID: {
    readonly baselineExecutionID: string
    readonly candidateExecutionID: string
  }["baselineExecutionID"]
  readonly candidateExecutionID: {
    readonly baselineExecutionID: string
    readonly candidateExecutionID: string
  }["candidateExecutionID"]
}

export type ServerJarvisCompareReplaysOutput = {
  readonly baselineExecutionID: string
  readonly candidateExecutionID: string
  readonly regressions: ReadonlyArray<string>
  readonly improvements: ReadonlyArray<string>
  readonly passed: boolean
} | null

export type ServerJarvisInboxOutput = ReadonlyArray<{
  readonly id: string
  readonly profileID: string
  readonly sessionID?: string
  readonly kind: "attention" | "goal" | "promise" | "model" | "reflection" | "manual"
  readonly topic: string
  readonly text: string
  readonly priority: number
  readonly status: "pending" | "admitted" | "dismissed" | "blocked"
  readonly notBefore: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly blockedReason?: string
}>

export type ServerJarvisWakeInput = {
  readonly sessionID?: {
    readonly sessionID?: string
    readonly kind: "attention" | "goal" | "promise" | "model" | "reflection" | "manual"
    readonly topic: string
    readonly text: string
    readonly priority: number
    readonly notBefore?: number
  }["sessionID"]
  readonly kind: {
    readonly sessionID?: string
    readonly kind: "attention" | "goal" | "promise" | "model" | "reflection" | "manual"
    readonly topic: string
    readonly text: string
    readonly priority: number
    readonly notBefore?: number
  }["kind"]
  readonly topic: {
    readonly sessionID?: string
    readonly kind: "attention" | "goal" | "promise" | "model" | "reflection" | "manual"
    readonly topic: string
    readonly text: string
    readonly priority: number
    readonly notBefore?: number
  }["topic"]
  readonly text: {
    readonly sessionID?: string
    readonly kind: "attention" | "goal" | "promise" | "model" | "reflection" | "manual"
    readonly topic: string
    readonly text: string
    readonly priority: number
    readonly notBefore?: number
  }["text"]
  readonly priority: {
    readonly sessionID?: string
    readonly kind: "attention" | "goal" | "promise" | "model" | "reflection" | "manual"
    readonly topic: string
    readonly text: string
    readonly priority: number
    readonly notBefore?: number
  }["priority"]
  readonly notBefore?: {
    readonly sessionID?: string
    readonly kind: "attention" | "goal" | "promise" | "model" | "reflection" | "manual"
    readonly topic: string
    readonly text: string
    readonly priority: number
    readonly notBefore?: number
  }["notBefore"]
}

export type ServerJarvisWakeOutput = {
  readonly id: string
  readonly profileID: string
  readonly sessionID?: string
  readonly kind: "attention" | "goal" | "promise" | "model" | "reflection" | "manual"
  readonly topic: string
  readonly text: string
  readonly priority: number
  readonly status: "pending" | "admitted" | "dismissed" | "blocked"
  readonly notBefore: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly blockedReason?: string
} | null

export type ServerJarvisDismissInboxInput = { readonly wakeID: { readonly wakeID: string }["wakeID"] }

export type ServerJarvisDismissInboxOutput = {
  readonly id: string
  readonly profileID: string
  readonly sessionID?: string
  readonly kind: "attention" | "goal" | "promise" | "model" | "reflection" | "manual"
  readonly topic: string
  readonly text: string
  readonly priority: number
  readonly status: "pending" | "admitted" | "dismissed" | "blocked"
  readonly notBefore: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly blockedReason?: string
} | null

export type ServerJarvisRetryInboxInput = { readonly wakeID: { readonly wakeID: string }["wakeID"] }

export type ServerJarvisRetryInboxOutput = {
  readonly id: string
  readonly profileID: string
  readonly sessionID?: string
  readonly kind: "attention" | "goal" | "promise" | "model" | "reflection" | "manual"
  readonly topic: string
  readonly text: string
  readonly priority: number
  readonly status: "pending" | "admitted" | "dismissed" | "blocked"
  readonly notBefore: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly blockedReason?: string
} | null

export type ServerJarvisCompanionStatusOutput = {
  readonly config: {
    readonly enabled: boolean
    readonly schedule: string
    readonly timezone: string
    readonly catchUpUntil: string
    readonly sources: {
      readonly gmail: boolean
      readonly calendar: boolean
      readonly drive: boolean
      readonly goals: boolean
      readonly promises: boolean
      readonly inbox: boolean
    }
    readonly updatedAt: number
  }
  readonly google: {
    readonly available: boolean
    readonly phase: "unavailable" | "disconnected" | "connecting" | "connected" | "expired" | "error"
    readonly accountID?: string
    readonly email?: string
    readonly scopes: ReadonlyArray<string>
    readonly writeScopes: ReadonlyArray<string>
    readonly checkedAt: number
    readonly error?: string
  }
  readonly lastRun?: {
    readonly id: string
    readonly briefingID?: string
    readonly trigger: "scheduled" | "catch_up" | "manual"
    readonly status: "queued" | "collecting" | "completed" | "partial" | "error" | "skipped"
    readonly localDate: string
    readonly accountID?: string
    readonly sourceCounts: { readonly [x: string]: number }
    readonly error?: string
    readonly startedAt: number
    readonly completedAt?: number
  }
  readonly nextRunAt?: number
  readonly catchUpAvailable: boolean
  readonly bridgeAvailable: boolean
  readonly error?: string
}

export type ServerJarvisCompanionConfigOutput = {
  readonly enabled: boolean
  readonly schedule: string
  readonly timezone: string
  readonly catchUpUntil: string
  readonly sources: {
    readonly gmail: boolean
    readonly calendar: boolean
    readonly drive: boolean
    readonly goals: boolean
    readonly promises: boolean
    readonly inbox: boolean
  }
  readonly updatedAt: number
}

export type ServerJarvisUpdateCompanionConfigInput = {
  readonly enabled: {
    readonly enabled: boolean
    readonly schedule: string
    readonly timezone: string
    readonly catchUpUntil: string
    readonly sources: {
      readonly gmail: boolean
      readonly calendar: boolean
      readonly drive: boolean
      readonly goals: boolean
      readonly promises: boolean
      readonly inbox: boolean
    }
    readonly updatedAt: number
  }["enabled"]
  readonly schedule: {
    readonly enabled: boolean
    readonly schedule: string
    readonly timezone: string
    readonly catchUpUntil: string
    readonly sources: {
      readonly gmail: boolean
      readonly calendar: boolean
      readonly drive: boolean
      readonly goals: boolean
      readonly promises: boolean
      readonly inbox: boolean
    }
    readonly updatedAt: number
  }["schedule"]
  readonly timezone: {
    readonly enabled: boolean
    readonly schedule: string
    readonly timezone: string
    readonly catchUpUntil: string
    readonly sources: {
      readonly gmail: boolean
      readonly calendar: boolean
      readonly drive: boolean
      readonly goals: boolean
      readonly promises: boolean
      readonly inbox: boolean
    }
    readonly updatedAt: number
  }["timezone"]
  readonly catchUpUntil: {
    readonly enabled: boolean
    readonly schedule: string
    readonly timezone: string
    readonly catchUpUntil: string
    readonly sources: {
      readonly gmail: boolean
      readonly calendar: boolean
      readonly drive: boolean
      readonly goals: boolean
      readonly promises: boolean
      readonly inbox: boolean
    }
    readonly updatedAt: number
  }["catchUpUntil"]
  readonly sources: {
    readonly enabled: boolean
    readonly schedule: string
    readonly timezone: string
    readonly catchUpUntil: string
    readonly sources: {
      readonly gmail: boolean
      readonly calendar: boolean
      readonly drive: boolean
      readonly goals: boolean
      readonly promises: boolean
      readonly inbox: boolean
    }
    readonly updatedAt: number
  }["sources"]
  readonly updatedAt: {
    readonly enabled: boolean
    readonly schedule: string
    readonly timezone: string
    readonly catchUpUntil: string
    readonly sources: {
      readonly gmail: boolean
      readonly calendar: boolean
      readonly drive: boolean
      readonly goals: boolean
      readonly promises: boolean
      readonly inbox: boolean
    }
    readonly updatedAt: number
  }["updatedAt"]
}

export type ServerJarvisUpdateCompanionConfigOutput = {
  readonly enabled: boolean
  readonly schedule: string
  readonly timezone: string
  readonly catchUpUntil: string
  readonly sources: {
    readonly gmail: boolean
    readonly calendar: boolean
    readonly drive: boolean
    readonly goals: boolean
    readonly promises: boolean
    readonly inbox: boolean
  }
  readonly updatedAt: number
}

export type ServerJarvisRunDailyBriefingInput = {
  readonly trigger?: { readonly trigger?: "scheduled" | "catch_up" | "manual"; readonly force?: boolean }["trigger"]
  readonly force?: { readonly trigger?: "scheduled" | "catch_up" | "manual"; readonly force?: boolean }["force"]
}

export type ServerJarvisRunDailyBriefingOutput = {
  readonly id: string
  readonly briefingID?: string
  readonly trigger: "scheduled" | "catch_up" | "manual"
  readonly status: "queued" | "collecting" | "completed" | "partial" | "error" | "skipped"
  readonly localDate: string
  readonly accountID?: string
  readonly sourceCounts: { readonly [x: string]: number }
  readonly error?: string
  readonly startedAt: number
  readonly completedAt?: number
}

export type ServerJarvisDailyBriefingsInput = { readonly limit?: { readonly limit?: number | undefined }["limit"] }

export type ServerJarvisDailyBriefingsOutput = ReadonlyArray<{
  readonly id: string
  readonly localDate: string
  readonly accountID: string
  readonly sessionID?: string
  readonly status: "collecting" | "ready" | "partial" | "error"
  readonly summary: string
  readonly schedule: ReadonlyArray<string>
  readonly importantMessages: ReadonlyArray<string>
  readonly goalsAndPromises: ReadonlyArray<string>
  readonly conflicts: ReadonlyArray<string>
  readonly risks: ReadonlyArray<string>
  readonly sources: ReadonlyArray<{
    readonly id: string
    readonly kind: "gmail" | "calendar" | "drive" | "goal" | "promise" | "inbox"
    readonly status: "ready" | "unavailable" | "error"
    readonly title: string
    readonly summary?: string
    readonly timestamp?: number
    readonly url?: string
    readonly error?: string
  }>
  readonly proposedActions: ReadonlyArray<{
    readonly id: string
    readonly briefingID?: string
    readonly kind: "gmail_draft" | "calendar_create" | "calendar_update" | "jarvis_reminder" | "jarvis_goal"
    readonly title: string
    readonly preview: string
    readonly access: "read" | "local_write" | "external_write"
    readonly input: { readonly [x: string]: JsonValue }
    readonly requiredScopes: ReadonlyArray<string>
    readonly idempotencyKey: string
    readonly externalRevision?: string
    readonly status: "prepared" | "approved" | "executing" | "completed" | "cancelled" | "conflict" | "error"
    readonly createdAt: number
    readonly updatedAt: number
  }>
  readonly createdAt: number
  readonly updatedAt: number
}>

export type ServerJarvisDailyBriefingInput = { readonly briefingID: { readonly briefingID: string }["briefingID"] }

export type ServerJarvisDailyBriefingOutput = {
  readonly id: string
  readonly localDate: string
  readonly accountID: string
  readonly sessionID?: string
  readonly status: "collecting" | "ready" | "partial" | "error"
  readonly summary: string
  readonly schedule: ReadonlyArray<string>
  readonly importantMessages: ReadonlyArray<string>
  readonly goalsAndPromises: ReadonlyArray<string>
  readonly conflicts: ReadonlyArray<string>
  readonly risks: ReadonlyArray<string>
  readonly sources: ReadonlyArray<{
    readonly id: string
    readonly kind: "gmail" | "calendar" | "drive" | "goal" | "promise" | "inbox"
    readonly status: "ready" | "unavailable" | "error"
    readonly title: string
    readonly summary?: string
    readonly timestamp?: number
    readonly url?: string
    readonly error?: string
  }>
  readonly proposedActions: ReadonlyArray<{
    readonly id: string
    readonly briefingID?: string
    readonly kind: "gmail_draft" | "calendar_create" | "calendar_update" | "jarvis_reminder" | "jarvis_goal"
    readonly title: string
    readonly preview: string
    readonly access: "read" | "local_write" | "external_write"
    readonly input: { readonly [x: string]: JsonValue }
    readonly requiredScopes: ReadonlyArray<string>
    readonly idempotencyKey: string
    readonly externalRevision?: string
    readonly status: "prepared" | "approved" | "executing" | "completed" | "cancelled" | "conflict" | "error"
    readonly createdAt: number
    readonly updatedAt: number
  }>
  readonly createdAt: number
  readonly updatedAt: number
} | null

export type ServerJarvisPrepareCompanionActionInput = {
  readonly briefingID?: {
    readonly briefingID?: string
    readonly kind: "gmail_draft" | "calendar_create" | "calendar_update" | "jarvis_reminder" | "jarvis_goal"
    readonly title: string
    readonly preview: string
    readonly input: { readonly [x: string]: JsonValue }
    readonly requiredScopes?: ReadonlyArray<string>
    readonly idempotencyKey: string
    readonly externalRevision?: string
  }["briefingID"]
  readonly kind: {
    readonly briefingID?: string
    readonly kind: "gmail_draft" | "calendar_create" | "calendar_update" | "jarvis_reminder" | "jarvis_goal"
    readonly title: string
    readonly preview: string
    readonly input: { readonly [x: string]: JsonValue }
    readonly requiredScopes?: ReadonlyArray<string>
    readonly idempotencyKey: string
    readonly externalRevision?: string
  }["kind"]
  readonly title: {
    readonly briefingID?: string
    readonly kind: "gmail_draft" | "calendar_create" | "calendar_update" | "jarvis_reminder" | "jarvis_goal"
    readonly title: string
    readonly preview: string
    readonly input: { readonly [x: string]: JsonValue }
    readonly requiredScopes?: ReadonlyArray<string>
    readonly idempotencyKey: string
    readonly externalRevision?: string
  }["title"]
  readonly preview: {
    readonly briefingID?: string
    readonly kind: "gmail_draft" | "calendar_create" | "calendar_update" | "jarvis_reminder" | "jarvis_goal"
    readonly title: string
    readonly preview: string
    readonly input: { readonly [x: string]: JsonValue }
    readonly requiredScopes?: ReadonlyArray<string>
    readonly idempotencyKey: string
    readonly externalRevision?: string
  }["preview"]
  readonly input: {
    readonly briefingID?: string
    readonly kind: "gmail_draft" | "calendar_create" | "calendar_update" | "jarvis_reminder" | "jarvis_goal"
    readonly title: string
    readonly preview: string
    readonly input: { readonly [x: string]: JsonValue }
    readonly requiredScopes?: ReadonlyArray<string>
    readonly idempotencyKey: string
    readonly externalRevision?: string
  }["input"]
  readonly requiredScopes?: {
    readonly briefingID?: string
    readonly kind: "gmail_draft" | "calendar_create" | "calendar_update" | "jarvis_reminder" | "jarvis_goal"
    readonly title: string
    readonly preview: string
    readonly input: { readonly [x: string]: JsonValue }
    readonly requiredScopes?: ReadonlyArray<string>
    readonly idempotencyKey: string
    readonly externalRevision?: string
  }["requiredScopes"]
  readonly idempotencyKey: {
    readonly briefingID?: string
    readonly kind: "gmail_draft" | "calendar_create" | "calendar_update" | "jarvis_reminder" | "jarvis_goal"
    readonly title: string
    readonly preview: string
    readonly input: { readonly [x: string]: JsonValue }
    readonly requiredScopes?: ReadonlyArray<string>
    readonly idempotencyKey: string
    readonly externalRevision?: string
  }["idempotencyKey"]
  readonly externalRevision?: {
    readonly briefingID?: string
    readonly kind: "gmail_draft" | "calendar_create" | "calendar_update" | "jarvis_reminder" | "jarvis_goal"
    readonly title: string
    readonly preview: string
    readonly input: { readonly [x: string]: JsonValue }
    readonly requiredScopes?: ReadonlyArray<string>
    readonly idempotencyKey: string
    readonly externalRevision?: string
  }["externalRevision"]
}

export type ServerJarvisPrepareCompanionActionOutput = {
  readonly id: string
  readonly briefingID?: string
  readonly kind: "gmail_draft" | "calendar_create" | "calendar_update" | "jarvis_reminder" | "jarvis_goal"
  readonly title: string
  readonly preview: string
  readonly access: "read" | "local_write" | "external_write"
  readonly input: { readonly [x: string]: JsonValue }
  readonly requiredScopes: ReadonlyArray<string>
  readonly idempotencyKey: string
  readonly externalRevision?: string
  readonly status: "prepared" | "approved" | "executing" | "completed" | "cancelled" | "conflict" | "error"
  readonly createdAt: number
  readonly updatedAt: number
}

export type ServerJarvisCompanionActionsInput = { readonly limit?: { readonly limit?: number | undefined }["limit"] }

export type ServerJarvisCompanionActionsOutput = ReadonlyArray<{
  readonly id: string
  readonly briefingID?: string
  readonly kind: "gmail_draft" | "calendar_create" | "calendar_update" | "jarvis_reminder" | "jarvis_goal"
  readonly title: string
  readonly preview: string
  readonly access: "read" | "local_write" | "external_write"
  readonly input: { readonly [x: string]: JsonValue }
  readonly requiredScopes: ReadonlyArray<string>
  readonly idempotencyKey: string
  readonly externalRevision?: string
  readonly status: "prepared" | "approved" | "executing" | "completed" | "cancelled" | "conflict" | "error"
  readonly createdAt: number
  readonly updatedAt: number
}>

export type ServerJarvisApproveCompanionActionInput = {
  readonly actionID: { readonly actionID: string }["actionID"]
  readonly externalRevision?: { readonly externalRevision?: string }["externalRevision"]
}

export type ServerJarvisApproveCompanionActionOutput = {
  readonly id: string
  readonly proposalID: string
  readonly status: "approved" | "executing" | "completed" | "cancelled" | "conflict" | "error"
  readonly result?: { readonly [x: string]: JsonValue }
  readonly error?: string
  readonly createdAt: number
  readonly updatedAt: number
} | null

export type ServerJarvisCancelCompanionActionInput = { readonly actionID: { readonly actionID: string }["actionID"] }

export type ServerJarvisCancelCompanionActionOutput = {
  readonly id: string
  readonly briefingID?: string
  readonly kind: "gmail_draft" | "calendar_create" | "calendar_update" | "jarvis_reminder" | "jarvis_goal"
  readonly title: string
  readonly preview: string
  readonly access: "read" | "local_write" | "external_write"
  readonly input: { readonly [x: string]: JsonValue }
  readonly requiredScopes: ReadonlyArray<string>
  readonly idempotencyKey: string
  readonly externalRevision?: string
  readonly status: "prepared" | "approved" | "executing" | "completed" | "cancelled" | "conflict" | "error"
  readonly createdAt: number
  readonly updatedAt: number
} | null

export type ServerJarvisCompanionActionAuditInput = {
  readonly limit?: { readonly limit?: number | undefined }["limit"]
}

export type ServerJarvisCompanionActionAuditOutput = ReadonlyArray<{
  readonly id: string
  readonly proposalID: string
  readonly status: "approved" | "executing" | "completed" | "cancelled" | "conflict" | "error"
  readonly result?: { readonly [x: string]: JsonValue }
  readonly error?: string
  readonly createdAt: number
  readonly updatedAt: number
}>
