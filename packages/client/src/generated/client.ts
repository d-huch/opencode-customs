import type {
  HealthGetOutput,
  LocationGetInput,
  LocationGetOutput,
  AgentsListInput,
  AgentsListOutput,
  SessionsListInput,
  SessionsListOutput,
  SessionsCreateInput,
  SessionsCreateOutput,
  SessionsActiveOutput,
  SessionsGetInput,
  SessionsGetOutput,
  SessionsUpdateJarvisInput,
  SessionsUpdateJarvisOutput,
  SessionsRemoveInput,
  SessionsRemoveOutput,
  SessionsSwitchAgentInput,
  SessionsSwitchAgentOutput,
  SessionsSwitchModelInput,
  SessionsSwitchModelOutput,
  SessionsPromptInput,
  SessionsPromptOutput,
  SessionsExternalTurnInput,
  SessionsExternalTurnOutput,
  SessionsCompactInput,
  SessionsCompactOutput,
  SessionsWaitInput,
  SessionsWaitOutput,
  SessionsStageInput,
  SessionsStageOutput,
  SessionsClearInput,
  SessionsClearOutput,
  SessionsCommitInput,
  SessionsCommitOutput,
  SessionsContextInput,
  SessionsContextOutput,
  SessionsHistoryInput,
  SessionsHistoryOutput,
  SessionsEventsInput,
  SessionsEventsOutput,
  SessionsInterruptInput,
  SessionsInterruptOutput,
  SessionsMessageInput,
  SessionsMessageOutput,
  MessagesListInput,
  MessagesListOutput,
  ModelsListInput,
  ModelsListOutput,
  ProvidersListInput,
  ProvidersListOutput,
  ProvidersGetInput,
  ProvidersGetOutput,
  IntegrationsListInput,
  IntegrationsListOutput,
  IntegrationsGetInput,
  IntegrationsGetOutput,
  IntegrationsConnectKeyInput,
  IntegrationsConnectKeyOutput,
  IntegrationsConnectOauthInput,
  IntegrationsConnectOauthOutput,
  IntegrationsAttemptStatusInput,
  IntegrationsAttemptStatusOutput,
  IntegrationsAttemptCompleteInput,
  IntegrationsAttemptCompleteOutput,
  IntegrationsAttemptCancelInput,
  IntegrationsAttemptCancelOutput,
  CredentialsUpdateInput,
  CredentialsUpdateOutput,
  CredentialsRemoveInput,
  CredentialsRemoveOutput,
  PermissionsListRequestsInput,
  PermissionsListRequestsOutput,
  PermissionsListSavedInput,
  PermissionsListSavedOutput,
  PermissionsRemoveSavedInput,
  PermissionsRemoveSavedOutput,
  PermissionsCreateInput,
  PermissionsCreateOutput,
  PermissionsListInput,
  PermissionsListOutput,
  PermissionsGetInput,
  PermissionsGetOutput,
  PermissionsReplyInput,
  PermissionsReplyOutput,
  FilesListInput,
  FilesListOutput,
  FilesFindInput,
  FilesFindOutput,
  CommandsListInput,
  CommandsListOutput,
  SkillsListInput,
  SkillsListOutput,
  EventsSubscribeOutput,
  PtysListInput,
  PtysListOutput,
  PtysCreateInput,
  PtysCreateOutput,
  PtysGetInput,
  PtysGetOutput,
  PtysUpdateInput,
  PtysUpdateOutput,
  PtysRemoveInput,
  PtysRemoveOutput,
  QuestionsListRequestsInput,
  QuestionsListRequestsOutput,
  QuestionsListInput,
  QuestionsListOutput,
  QuestionsReplyInput,
  QuestionsReplyOutput,
  QuestionsRejectInput,
  QuestionsRejectOutput,
  ReferencesListInput,
  ReferencesListOutput,
  ProjectCopiesCreateInput,
  ProjectCopiesCreateOutput,
  ProjectCopiesRemoveInput,
  ProjectCopiesRemoveOutput,
  ProjectCopiesRefreshInput,
  ProjectCopiesRefreshOutput,
  RepositoryMapGetInput,
  RepositoryMapGetOutput,
  RepositoryMapRefreshInput,
  RepositoryMapRefreshOutput,
  RepositoryMapDiagnosticsInput,
  RepositoryMapDiagnosticsOutput,
  RepositoryMapConfigureDiagnosticsInput,
  RepositoryMapConfigureDiagnosticsOutput,
  RepositoryMapKnowledgeInput,
  RepositoryMapKnowledgeOutput,
  RepositoryMapRemoveKnowledgeInput,
  RepositoryMapRemoveKnowledgeOutput,
  RepositoryMapUpdateMemoryInput,
  RepositoryMapUpdateMemoryOutput,
  RepositoryMapPreviewMemoryConsolidationInput,
  RepositoryMapPreviewMemoryConsolidationOutput,
  RepositoryMapApplyMemoryConsolidationInput,
  RepositoryMapApplyMemoryConsolidationOutput,
  RepositoryMapFeedbackRetrievalInput,
  RepositoryMapFeedbackRetrievalOutput,
  RepositoryMapClearKnowledgeInput,
  RepositoryMapClearKnowledgeOutput,
  ServerJarvisStatusOutput,
  ServerJarvisConfigOutput,
  ServerJarvisUpdateConfigInput,
  ServerJarvisUpdateConfigOutput,
  ServerJarvisBenchmarkStatusOutput,
  ServerJarvisRunBenchmarkInput,
  ServerJarvisRunBenchmarkOutput,
  ServerJarvisCancelBenchmarkOutput,
  ServerJarvisProfilesOutput,
  ServerJarvisSyncProfilesInput,
  ServerJarvisSyncProfilesOutput,
  ServerJarvisGoalsInput,
  ServerJarvisGoalsOutput,
  ServerJarvisCreateGoalInput,
  ServerJarvisCreateGoalOutput,
  ServerJarvisResumeGoalInput,
  ServerJarvisResumeGoalOutput,
  ServerJarvisReplanGoalInput,
  ServerJarvisReplanGoalOutput,
  ServerJarvisCancelGoalInput,
  ServerJarvisCancelGoalOutput,
  ServerJarvisRecordGoalStepInput,
  ServerJarvisRecordGoalStepOutput,
  ServerJarvisOutcomesInput,
  ServerJarvisOutcomesOutput,
  ServerJarvisCompleteGoalInput,
  ServerJarvisCompleteGoalOutput,
  ServerJarvisSearchMemoryInput,
  ServerJarvisSearchMemoryOutput,
  ServerJarvisRememberInput,
  ServerJarvisRememberOutput,
  ServerJarvisRemoveMemoryInput,
  ServerJarvisRemoveMemoryOutput,
  ServerJarvisPatchMemoryInput,
  ServerJarvisPatchMemoryOutput,
  ServerJarvisResolveMemoryConflictInput,
  ServerJarvisResolveMemoryConflictOutput,
  ServerJarvisReindexMemoryOutput,
  ServerJarvisInboxOutput,
  ServerJarvisWakeInput,
  ServerJarvisWakeOutput,
  ServerJarvisDismissInboxInput,
  ServerJarvisDismissInboxOutput,
  ServerJarvisRetryInboxInput,
  ServerJarvisRetryInboxOutput,
} from "./types"
import { ClientError } from "./client-error"

export interface ClientOptions {
  readonly baseUrl: string
  readonly fetch?: typeof globalThis.fetch
  readonly headers?: HeadersInit
}

export interface RequestOptions {
  readonly signal?: AbortSignal
  readonly headers?: HeadersInit
}

interface RequestDescriptor {
  readonly method: string
  readonly path: string
  readonly query?: Record<string, unknown>
  readonly headers?: Record<string, unknown>
  readonly body?: unknown
  readonly successStatus: number
  readonly declaredStatuses: ReadonlyArray<number>
  readonly empty: boolean
}

export function make(options: ClientOptions) {
  const fetch = options.fetch ?? globalThis.fetch

  const prepare = (descriptor: RequestDescriptor, requestOptions?: RequestOptions) => {
    const url = new URL(descriptor.path, options.baseUrl)
    for (const [key, value] of Object.entries(descriptor.query ?? {})) appendQuery(url.searchParams, key, value)
    const headers = new Headers(options.headers)
    for (const [key, value] of Object.entries(descriptor.headers ?? {})) {
      if (value !== undefined && value !== null) headers.set(key, String(value))
    }
    for (const [key, value] of new Headers(requestOptions?.headers)) headers.set(key, value)
    if (descriptor.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json")
    return {
      url,
      init: {
        method: descriptor.method,
        signal: requestOptions?.signal,
        headers,
        body: descriptor.body === undefined ? undefined : JSON.stringify(descriptor.body),
      } satisfies RequestInit,
    }
  }

  const execute = async (descriptor: RequestDescriptor, requestOptions?: RequestOptions) => {
    try {
      const prepared = prepare(descriptor, requestOptions)
      return await fetch(prepared.url, prepared.init)
    } catch (cause) {
      throw new ClientError("Transport", { cause })
    }
  }

  const responseError = async (response: Response, descriptor: RequestDescriptor): Promise<never> => {
    if (descriptor.declaredStatuses.includes(response.status)) throw await json(response)
    try {
      await response.body?.cancel()
    } catch {}
    throw new ClientError("UnexpectedStatus", { cause: { status: response.status } })
  }

  const request = async <A>(descriptor: RequestDescriptor, requestOptions?: RequestOptions): Promise<A> => {
    const response = await execute(descriptor, requestOptions)
    if (response.status !== descriptor.successStatus) return responseError(response, descriptor)
    if (descriptor.empty) {
      try {
        await response.body?.cancel()
      } catch {}
      return undefined as A
    }
    return (await json(response)) as A
  }

  const sse = <A>(descriptor: RequestDescriptor, requestOptions?: RequestOptions): AsyncIterable<A> => ({
    async *[Symbol.asyncIterator]() {
      const response = await execute(descriptor, requestOptions)
      if (response.status !== descriptor.successStatus) await responseError(response, descriptor)
      if (!isContentType(response, "text/event-stream")) {
        try {
          await response.body?.cancel()
        } catch {}
        throw new ClientError("UnsupportedContentType")
      }
      if (response.body === null) throw new ClientError("MalformedResponse")
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      try {
        while (true) {
          let next
          try {
            next = await reader.read()
          } catch (cause) {
            throw new ClientError("Transport", { cause })
          }
          buffer += decoder.decode(next.value, { stream: !next.done })
          if (buffer.length > 1_048_576) throw new ClientError("MalformedResponse")
          const trailingCarriageReturn = !next.done && buffer.endsWith("\r")
          if (trailingCarriageReturn) buffer = buffer.slice(0, -1)
          buffer = buffer.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
          if (trailingCarriageReturn) buffer += "\r"
          if (next.done && buffer !== "") buffer += "\n\n"
          let boundary = buffer.indexOf("\n\n")
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            const data = block
              .split("\n")
              .flatMap((line) => (line.startsWith("data:") ? [line.slice(5).trimStart()] : []))
              .join("\n")
            if (data !== "") {
              try {
                yield JSON.parse(data) as A
              } catch (cause) {
                throw new ClientError("MalformedResponse", { cause })
              }
            }
            boundary = buffer.indexOf("\n\n")
          }
          if (next.done) return
        }
      } finally {
        try {
          await reader.cancel()
        } catch {}
        reader.releaseLock()
      }
    },
  })

  return {
    health: {
      get: (requestOptions?: RequestOptions) =>
        request<HealthGetOutput>(
          { method: "GET", path: `/api/health`, successStatus: 200, declaredStatuses: [401, 400], empty: false },
          requestOptions,
        ),
    },
    location: {
      get: (input?: LocationGetInput, requestOptions?: RequestOptions) =>
        request<LocationGetOutput>(
          {
            method: "GET",
            path: `/api/location`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    agents: {
      list: (input?: AgentsListInput, requestOptions?: RequestOptions) =>
        request<AgentsListOutput>(
          {
            method: "GET",
            path: `/api/agent`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    sessions: {
      list: (input?: SessionsListInput, requestOptions?: RequestOptions) =>
        request<SessionsListOutput>(
          {
            method: "GET",
            path: `/api/session`,
            query: {
              workspace: input?.["workspace"],
              limit: input?.["limit"],
              order: input?.["order"],
              search: input?.["search"],
              directory: input?.["directory"],
              project: input?.["project"],
              subpath: input?.["subpath"],
              cursor: input?.["cursor"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      create: (input?: SessionsCreateInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsCreateOutput }>(
          {
            method: "POST",
            path: `/api/session`,
            body: {
              id: input?.["id"],
              agent: input?.["agent"],
              model: input?.["model"],
              location: input?.["location"],
              mode: input?.["mode"],
              jarvis: input?.["jarvis"],
            },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      active: (requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsActiveOutput }>(
          {
            method: "GET",
            path: `/api/session/active`,
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      get: (input: SessionsGetInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsGetOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      updateJarvis: (input: SessionsUpdateJarvisInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsUpdateJarvisOutput }>(
          {
            method: "PATCH",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/jarvis`,
            body: {
              profileID: input["profileID"],
              profileRevision: input["profileRevision"],
              mode: input["mode"],
              inbox: input["inbox"],
            },
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      remove: (input: SessionsRemoveInput, requestOptions?: RequestOptions) =>
        request<SessionsRemoveOutput>(
          {
            method: "DELETE",
            path: `/api/session/${encodeURIComponent(input.sessionID)}`,
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      switchAgent: (input: SessionsSwitchAgentInput, requestOptions?: RequestOptions) =>
        request<SessionsSwitchAgentOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/agent`,
            body: { agent: input["agent"] },
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      switchModel: (input: SessionsSwitchModelInput, requestOptions?: RequestOptions) =>
        request<SessionsSwitchModelOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/model`,
            body: { model: input["model"] },
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      prompt: (input: SessionsPromptInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsPromptOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/prompt`,
            body: { id: input["id"], prompt: input["prompt"], delivery: input["delivery"], resume: input["resume"] },
            successStatus: 200,
            declaredStatuses: [409, 404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      externalTurn: (input: SessionsExternalTurnInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsExternalTurnOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/external-turn`,
            body: {
              idempotencyKey: input["idempotencyKey"],
              userText: input["userText"],
              assistantText: input["assistantText"],
              model: input["model"],
            },
            successStatus: 200,
            declaredStatuses: [409, 404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      compact: (input: SessionsCompactInput, requestOptions?: RequestOptions) =>
        request<SessionsCompactOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/compact`,
            successStatus: 204,
            declaredStatuses: [404, 503, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      wait: (input: SessionsWaitInput, requestOptions?: RequestOptions) =>
        request<SessionsWaitOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/wait`,
            successStatus: 204,
            declaredStatuses: [404, 503, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      stage: (input: SessionsStageInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsStageOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/revert/stage`,
            body: { messageID: input["messageID"], files: input["files"] },
            successStatus: 200,
            declaredStatuses: [404, 500, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      clear: (input: SessionsClearInput, requestOptions?: RequestOptions) =>
        request<SessionsClearOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/revert/clear`,
            successStatus: 204,
            declaredStatuses: [404, 500, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      commit: (input: SessionsCommitInput, requestOptions?: RequestOptions) =>
        request<SessionsCommitOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/revert/commit`,
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      context: (input: SessionsContextInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsContextOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/context`,
            successStatus: 200,
            declaredStatuses: [404, 500, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      history: (input: SessionsHistoryInput, requestOptions?: RequestOptions) =>
        request<SessionsHistoryOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/history`,
            query: { limit: input["limit"], after: input["after"] },
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ),
      events: (input: SessionsEventsInput, requestOptions?: RequestOptions): AsyncIterable<SessionsEventsOutput> =>
        sse<SessionsEventsOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/event`,
            query: { after: input["after"] },
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ),
      interrupt: (input: SessionsInterruptInput, requestOptions?: RequestOptions) =>
        request<SessionsInterruptOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/interrupt`,
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      message: (input: SessionsMessageInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsMessageOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/message/${encodeURIComponent(input.messageID)}`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
    },
    messages: {
      list: (input: MessagesListInput, requestOptions?: RequestOptions) =>
        request<MessagesListOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/message`,
            query: { limit: input["limit"], order: input["order"], cursor: input["cursor"] },
            successStatus: 200,
            declaredStatuses: [400, 404, 500, 401],
            empty: false,
          },
          requestOptions,
        ),
    },
    models: {
      list: (input?: ModelsListInput, requestOptions?: RequestOptions) =>
        request<ModelsListOutput>(
          {
            method: "GET",
            path: `/api/model`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    providers: {
      list: (input?: ProvidersListInput, requestOptions?: RequestOptions) =>
        request<ProvidersListOutput>(
          {
            method: "GET",
            path: `/api/provider`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: ProvidersGetInput, requestOptions?: RequestOptions) =>
        request<ProvidersGetOutput>(
          {
            method: "GET",
            path: `/api/provider/${encodeURIComponent(input.providerID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    integrations: {
      list: (input?: IntegrationsListInput, requestOptions?: RequestOptions) =>
        request<IntegrationsListOutput>(
          {
            method: "GET",
            path: `/api/integration`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: IntegrationsGetInput, requestOptions?: RequestOptions) =>
        request<IntegrationsGetOutput>(
          {
            method: "GET",
            path: `/api/integration/${encodeURIComponent(input.integrationID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      connectKey: (input: IntegrationsConnectKeyInput, requestOptions?: RequestOptions) =>
        request<IntegrationsConnectKeyOutput>(
          {
            method: "POST",
            path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/key`,
            query: { location: input["location"] },
            body: { key: input["key"], label: input["label"] },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
      connectOauth: (input: IntegrationsConnectOauthInput, requestOptions?: RequestOptions) =>
        request<IntegrationsConnectOauthOutput>(
          {
            method: "POST",
            path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/oauth`,
            query: { location: input["location"] },
            body: { methodID: input["methodID"], inputs: input["inputs"], label: input["label"] },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      attemptStatus: (input: IntegrationsAttemptStatusInput, requestOptions?: RequestOptions) =>
        request<IntegrationsAttemptStatusOutput>(
          {
            method: "GET",
            path: `/api/integration/attempt/${encodeURIComponent(input.attemptID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      attemptComplete: (input: IntegrationsAttemptCompleteInput, requestOptions?: RequestOptions) =>
        request<IntegrationsAttemptCompleteOutput>(
          {
            method: "POST",
            path: `/api/integration/attempt/${encodeURIComponent(input.attemptID)}/complete`,
            query: { location: input["location"] },
            body: { code: input["code"] },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
      attemptCancel: (input: IntegrationsAttemptCancelInput, requestOptions?: RequestOptions) =>
        request<IntegrationsAttemptCancelOutput>(
          {
            method: "DELETE",
            path: `/api/integration/attempt/${encodeURIComponent(input.attemptID)}`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [401, 400],
            empty: true,
          },
          requestOptions,
        ),
    },
    credentials: {
      update: (input: CredentialsUpdateInput, requestOptions?: RequestOptions) =>
        request<CredentialsUpdateOutput>(
          {
            method: "PATCH",
            path: `/api/credential/${encodeURIComponent(input.credentialID)}`,
            query: { location: input["location"] },
            body: { label: input["label"] },
            successStatus: 204,
            declaredStatuses: [401, 400],
            empty: true,
          },
          requestOptions,
        ),
      remove: (input: CredentialsRemoveInput, requestOptions?: RequestOptions) =>
        request<CredentialsRemoveOutput>(
          {
            method: "DELETE",
            path: `/api/credential/${encodeURIComponent(input.credentialID)}`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [401, 400],
            empty: true,
          },
          requestOptions,
        ),
    },
    permissions: {
      listRequests: (input?: PermissionsListRequestsInput, requestOptions?: RequestOptions) =>
        request<PermissionsListRequestsOutput>(
          {
            method: "GET",
            path: `/api/permission/request`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      listSaved: (input?: PermissionsListSavedInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: PermissionsListSavedOutput }>(
          {
            method: "GET",
            path: `/api/permission/saved`,
            query: { projectID: input?.["projectID"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      removeSaved: (input: PermissionsRemoveSavedInput, requestOptions?: RequestOptions) =>
        request<PermissionsRemoveSavedOutput>(
          {
            method: "DELETE",
            path: `/api/permission/saved/${encodeURIComponent(input.id)}`,
            successStatus: 204,
            declaredStatuses: [401, 400],
            empty: true,
          },
          requestOptions,
        ),
      create: (input: PermissionsCreateInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: PermissionsCreateOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/permission`,
            body: {
              id: input["id"],
              action: input["action"],
              resources: input["resources"],
              save: input["save"],
              metadata: input["metadata"],
              source: input["source"],
              agent: input["agent"],
            },
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      list: (input: PermissionsListInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: PermissionsListOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/permission`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      get: (input: PermissionsGetInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: PermissionsGetOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/permission/${encodeURIComponent(input.requestID)}`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      reply: (input: PermissionsReplyInput, requestOptions?: RequestOptions) =>
        request<PermissionsReplyOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/permission/${encodeURIComponent(input.requestID)}/reply`,
            body: { reply: input["reply"], message: input["message"] },
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
    },
    files: {
      list: (input?: FilesListInput, requestOptions?: RequestOptions) =>
        request<FilesListOutput>(
          {
            method: "GET",
            path: `/api/fs/list`,
            query: { location: input?.["location"], path: input?.["path"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      find: (input: FilesFindInput, requestOptions?: RequestOptions) =>
        request<FilesFindOutput>(
          {
            method: "GET",
            path: `/api/fs/find`,
            query: { location: input["location"], query: input["query"], type: input["type"], limit: input["limit"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    commands: {
      list: (input?: CommandsListInput, requestOptions?: RequestOptions) =>
        request<CommandsListOutput>(
          {
            method: "GET",
            path: `/api/command`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    skills: {
      list: (input?: SkillsListInput, requestOptions?: RequestOptions) =>
        request<SkillsListOutput>(
          {
            method: "GET",
            path: `/api/skill`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    events: {
      subscribe: (requestOptions?: RequestOptions): AsyncIterable<EventsSubscribeOutput> =>
        sse<EventsSubscribeOutput>(
          { method: "GET", path: `/api/event`, successStatus: 200, declaredStatuses: [401, 400], empty: false },
          requestOptions,
        ),
    },
    ptys: {
      list: (input?: PtysListInput, requestOptions?: RequestOptions) =>
        request<PtysListOutput>(
          {
            method: "GET",
            path: `/api/pty`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      create: (input?: PtysCreateInput, requestOptions?: RequestOptions) =>
        request<PtysCreateOutput>(
          {
            method: "POST",
            path: `/api/pty`,
            query: { location: input?.["location"] },
            body: {
              command: input?.["command"],
              args: input?.["args"],
              cwd: input?.["cwd"],
              title: input?.["title"],
              env: input?.["env"],
            },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: PtysGetInput, requestOptions?: RequestOptions) =>
        request<PtysGetOutput>(
          {
            method: "GET",
            path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: PtysUpdateInput, requestOptions?: RequestOptions) =>
        request<PtysUpdateOutput>(
          {
            method: "PUT",
            path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
            query: { location: input["location"] },
            body: { title: input["title"], size: input["size"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: PtysRemoveInput, requestOptions?: RequestOptions) =>
        request<PtysRemoveOutput>(
          {
            method: "DELETE",
            path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [404, 401, 400],
            empty: true,
          },
          requestOptions,
        ),
    },
    questions: {
      listRequests: (input?: QuestionsListRequestsInput, requestOptions?: RequestOptions) =>
        request<QuestionsListRequestsOutput>(
          {
            method: "GET",
            path: `/api/question/request`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      list: (input: QuestionsListInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: QuestionsListOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/question`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      reply: (input: QuestionsReplyInput, requestOptions?: RequestOptions) =>
        request<QuestionsReplyOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/question/${encodeURIComponent(input.requestID)}/reply`,
            body: { answers: input["answers"] },
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      reject: (input: QuestionsRejectInput, requestOptions?: RequestOptions) =>
        request<QuestionsRejectOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/question/${encodeURIComponent(input.requestID)}/reject`,
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
    },
    references: {
      list: (input?: ReferencesListInput, requestOptions?: RequestOptions) =>
        request<ReferencesListOutput>(
          {
            method: "GET",
            path: `/api/reference`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    projectCopies: {
      create: (input: ProjectCopiesCreateInput, requestOptions?: RequestOptions) =>
        request<ProjectCopiesCreateOutput>(
          {
            method: "POST",
            path: `/experimental/project/${encodeURIComponent(input.projectID)}/copy`,
            query: { location: input["location"] },
            body: { strategy: input["strategy"], directory: input["directory"], name: input["name"] },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: ProjectCopiesRemoveInput, requestOptions?: RequestOptions) =>
        request<ProjectCopiesRemoveOutput>(
          {
            method: "DELETE",
            path: `/experimental/project/${encodeURIComponent(input.projectID)}/copy`,
            query: { location: input["location"] },
            body: { directory: input["directory"], force: input["force"] },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
      refresh: (input: ProjectCopiesRefreshInput, requestOptions?: RequestOptions) =>
        request<ProjectCopiesRefreshOutput>(
          {
            method: "POST",
            path: `/experimental/project/${encodeURIComponent(input.projectID)}/copy/refresh`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
    },
    repositoryMap: {
      get: (input?: RepositoryMapGetInput, requestOptions?: RequestOptions) =>
        request<RepositoryMapGetOutput>(
          {
            method: "GET",
            path: `/api/repository-map`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      refresh: (input?: RepositoryMapRefreshInput, requestOptions?: RequestOptions) =>
        request<RepositoryMapRefreshOutput>(
          {
            method: "POST",
            path: `/api/repository-map/refresh`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      diagnostics: (input?: RepositoryMapDiagnosticsInput, requestOptions?: RequestOptions) =>
        request<RepositoryMapDiagnosticsOutput>(
          {
            method: "GET",
            path: `/api/repository-map/diagnostics`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      configureDiagnostics: (input: RepositoryMapConfigureDiagnosticsInput, requestOptions?: RequestOptions) =>
        request<RepositoryMapConfigureDiagnosticsOutput>(
          {
            method: "POST",
            path: `/api/repository-map/diagnostics`,
            query: { location: input["location"] },
            body: { enabled: input["enabled"], clear: input["clear"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      knowledge: (input?: RepositoryMapKnowledgeInput, requestOptions?: RequestOptions) =>
        request<RepositoryMapKnowledgeOutput>(
          {
            method: "GET",
            path: `/api/repository-map/knowledge`,
            query: { location: input?.["location"], search: input?.["search"], limit: input?.["limit"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      removeKnowledge: (input: RepositoryMapRemoveKnowledgeInput, requestOptions?: RequestOptions) =>
        request<RepositoryMapRemoveKnowledgeOutput>(
          {
            method: "DELETE",
            path: `/api/repository-map/knowledge/${encodeURIComponent(input.scope)}/${encodeURIComponent(input.id)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      updateMemory: (input: RepositoryMapUpdateMemoryInput, requestOptions?: RequestOptions) =>
        request<RepositoryMapUpdateMemoryOutput>(
          {
            method: "PATCH",
            path: `/api/repository-map/knowledge/memory/${encodeURIComponent(input.id)}`,
            query: { location: input["location"] },
            body: {
              pinned: input["pinned"],
              expiresAt: input["expiresAt"],
              clearExpiration: input["clearExpiration"],
              resolve: input["resolve"],
              lifecycle: input["lifecycle"],
            },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      previewMemoryConsolidation: (
        input?: RepositoryMapPreviewMemoryConsolidationInput,
        requestOptions?: RequestOptions,
      ) =>
        request<RepositoryMapPreviewMemoryConsolidationOutput>(
          {
            method: "GET",
            path: `/api/repository-map/knowledge/memory/consolidation`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      applyMemoryConsolidation: (input: RepositoryMapApplyMemoryConsolidationInput, requestOptions?: RequestOptions) =>
        request<RepositoryMapApplyMemoryConsolidationOutput>(
          {
            method: "POST",
            path: `/api/repository-map/knowledge/memory/consolidation`,
            query: { location: input["location"] },
            body: { fingerprint: input["fingerprint"], generatedAt: input["generatedAt"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      feedbackRetrieval: (input: RepositoryMapFeedbackRetrievalInput, requestOptions?: RequestOptions) =>
        request<RepositoryMapFeedbackRetrievalOutput>(
          {
            method: "PATCH",
            path: `/api/repository-map/knowledge/retrieval/${encodeURIComponent(input.id)}`,
            query: { location: input["location"] },
            body: { path: input["path"], relevance: input["relevance"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      clearKnowledge: (input: RepositoryMapClearKnowledgeInput, requestOptions?: RequestOptions) =>
        request<RepositoryMapClearKnowledgeOutput>(
          {
            method: "DELETE",
            path: `/api/repository-map/knowledge/${encodeURIComponent(input.scope)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    "server.jarvis": {
      status: (requestOptions?: RequestOptions) =>
        request<ServerJarvisStatusOutput>(
          { method: "GET", path: `/api/jarvis/status`, successStatus: 200, declaredStatuses: [401, 400], empty: false },
          requestOptions,
        ),
      config: (requestOptions?: RequestOptions) =>
        request<ServerJarvisConfigOutput>(
          { method: "GET", path: `/api/jarvis/config`, successStatus: 200, declaredStatuses: [401, 400], empty: false },
          requestOptions,
        ),
      updateConfig: (input: ServerJarvisUpdateConfigInput, requestOptions?: RequestOptions) =>
        request<ServerJarvisUpdateConfigOutput>(
          {
            method: "PUT",
            path: `/api/jarvis/config`,
            body: {
              primaryProfileID: input["primaryProfileID"],
              inboxSessionID: input["inboxSessionID"],
              models: input["models"],
              plannerTimeoutMs: input["plannerTimeoutMs"],
              plannerIdleUnloadMs: input["plannerIdleUnloadMs"],
              plannerEscalationMinWords: input["plannerEscalationMinWords"],
              reactor: input["reactor"],
              benchmark: input["benchmark"],
              initiative: input["initiative"],
              updatedAt: input["updatedAt"],
            },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      benchmarkStatus: (requestOptions?: RequestOptions) =>
        request<ServerJarvisBenchmarkStatusOutput>(
          {
            method: "GET",
            path: `/api/jarvis/benchmark`,
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      runBenchmark: (input: ServerJarvisRunBenchmarkInput, requestOptions?: RequestOptions) =>
        request<ServerJarvisRunBenchmarkOutput>(
          {
            method: "POST",
            path: `/api/jarvis/benchmark`,
            body: { profile: input["profile"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      cancelBenchmark: (requestOptions?: RequestOptions) =>
        request<ServerJarvisCancelBenchmarkOutput>(
          {
            method: "POST",
            path: `/api/jarvis/benchmark/cancel`,
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      profiles: (requestOptions?: RequestOptions) =>
        request<ServerJarvisProfilesOutput>(
          {
            method: "GET",
            path: `/api/jarvis/profiles`,
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      syncProfiles: (input: ServerJarvisSyncProfilesInput, requestOptions?: RequestOptions) =>
        request<ServerJarvisSyncProfilesOutput>(
          {
            method: "PUT",
            path: `/api/jarvis/profiles`,
            body: { profiles: input["profiles"], primaryProfileID: input["primaryProfileID"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      goals: (input?: ServerJarvisGoalsInput, requestOptions?: RequestOptions) =>
        request<ServerJarvisGoalsOutput>(
          {
            method: "GET",
            path: `/api/jarvis/goals`,
            query: { status: input?.["status"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      createGoal: (input: ServerJarvisCreateGoalInput, requestOptions?: RequestOptions) =>
        request<ServerJarvisCreateGoalOutput>(
          {
            method: "POST",
            path: `/api/jarvis/goals`,
            body: {
              profileID: input["profileID"],
              sessionID: input["sessionID"],
              mode: input["mode"],
              gameID: input["gameID"],
              saveSlotID: input["saveSlotID"],
              characterID: input["characterID"],
              objective: input["objective"],
              worldRevision: input["worldRevision"],
              capabilityRevision: input["capabilityRevision"],
            },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      resumeGoal: (input: ServerJarvisResumeGoalInput, requestOptions?: RequestOptions) =>
        request<ServerJarvisResumeGoalOutput>(
          {
            method: "POST",
            path: `/api/jarvis/goals/${encodeURIComponent(input.goalID)}/resume`,
            body: {
              worldRevision: input["worldRevision"],
              capabilityRevision: input["capabilityRevision"],
              gameID: input["gameID"],
              saveSlotID: input["saveSlotID"],
              characterID: input["characterID"],
            },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      replanGoal: (input: ServerJarvisReplanGoalInput, requestOptions?: RequestOptions) =>
        request<ServerJarvisReplanGoalOutput>(
          {
            method: "POST",
            path: `/api/jarvis/goals/${encodeURIComponent(input.goalID)}/replan`,
            body: { reason: input["reason"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      cancelGoal: (input: ServerJarvisCancelGoalInput, requestOptions?: RequestOptions) =>
        request<ServerJarvisCancelGoalOutput>(
          {
            method: "POST",
            path: `/api/jarvis/goals/${encodeURIComponent(input.goalID)}/cancel`,
            body: { summary: input["summary"], changedEntityIDs: input["changedEntityIDs"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      recordGoalStep: (input: ServerJarvisRecordGoalStepInput, requestOptions?: RequestOptions) =>
        request<ServerJarvisRecordGoalStepOutput>(
          {
            method: "POST",
            path: `/api/jarvis/goals/${encodeURIComponent(input.goalID)}/steps/result`,
            body: { stepID: input["stepID"], success: input["success"], error: input["error"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      outcomes: (input?: ServerJarvisOutcomesInput, requestOptions?: RequestOptions) =>
        request<ServerJarvisOutcomesOutput>(
          {
            method: "GET",
            path: `/api/jarvis/outcomes`,
            query: { goalID: input?.["goalID"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      completeGoal: (input: ServerJarvisCompleteGoalInput, requestOptions?: RequestOptions) =>
        request<ServerJarvisCompleteGoalOutput>(
          {
            method: "POST",
            path: `/api/jarvis/goals/${encodeURIComponent(input.goalID)}/outcome`,
            body: { status: input["status"], summary: input["summary"], changedEntityIDs: input["changedEntityIDs"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      searchMemory: (input: ServerJarvisSearchMemoryInput, requestOptions?: RequestOptions) =>
        request<ServerJarvisSearchMemoryOutput>(
          {
            method: "POST",
            path: `/api/jarvis/memory/search`,
            body: {
              query: input["query"],
              profileID: input["profileID"],
              gameID: input["gameID"],
              saveSlotID: input["saveSlotID"],
              characterID: input["characterID"],
              limit: input["limit"],
              embedding: input["embedding"],
            },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      remember: (input: ServerJarvisRememberInput, requestOptions?: RequestOptions) =>
        request<ServerJarvisRememberOutput>(
          {
            method: "POST",
            path: `/api/jarvis/memory`,
            body: {
              id: input["id"],
              profileID: input["profileID"],
              scope: input["scope"],
              gameID: input["gameID"],
              saveSlotID: input["saveSlotID"],
              characterID: input["characterID"],
              kind: input["kind"],
              text: input["text"],
              sourceID: input["sourceID"],
              confidence: input["confidence"],
              importance: input["importance"],
              lifecycle: input["lifecycle"],
              pinned: input["pinned"],
              conflictsWith: input["conflictsWith"],
              embedding: input["embedding"],
              embeddingModel: input["embeddingModel"],
              createdAt: input["createdAt"],
              updatedAt: input["updatedAt"],
              lastUsedAt: input["lastUsedAt"],
            },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      removeMemory: (input: ServerJarvisRemoveMemoryInput, requestOptions?: RequestOptions) =>
        request<ServerJarvisRemoveMemoryOutput>(
          {
            method: "DELETE",
            path: `/api/jarvis/memory/${encodeURIComponent(input.memoryID)}`,
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      patchMemory: (input: ServerJarvisPatchMemoryInput, requestOptions?: RequestOptions) =>
        request<ServerJarvisPatchMemoryOutput>(
          {
            method: "PATCH",
            path: `/api/jarvis/memory/${encodeURIComponent(input.memoryID)}`,
            body: {
              text: input["text"],
              confidence: input["confidence"],
              importance: input["importance"],
              lifecycle: input["lifecycle"],
              pinned: input["pinned"],
            },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      resolveMemoryConflict: (input: ServerJarvisResolveMemoryConflictInput, requestOptions?: RequestOptions) =>
        request<ServerJarvisResolveMemoryConflictOutput>(
          {
            method: "POST",
            path: `/api/jarvis/memory/${encodeURIComponent(input.memoryID)}/conflict`,
            body: { action: input["action"], otherMemoryID: input["otherMemoryID"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      reindexMemory: (requestOptions?: RequestOptions) =>
        request<ServerJarvisReindexMemoryOutput>(
          {
            method: "POST",
            path: `/api/jarvis/memory/reindex`,
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      inbox: (requestOptions?: RequestOptions) =>
        request<ServerJarvisInboxOutput>(
          { method: "GET", path: `/api/jarvis/inbox`, successStatus: 200, declaredStatuses: [401, 400], empty: false },
          requestOptions,
        ),
      wake: (input: ServerJarvisWakeInput, requestOptions?: RequestOptions) =>
        request<ServerJarvisWakeOutput>(
          {
            method: "POST",
            path: `/api/jarvis/wake`,
            body: {
              sessionID: input["sessionID"],
              kind: input["kind"],
              topic: input["topic"],
              text: input["text"],
              priority: input["priority"],
              notBefore: input["notBefore"],
            },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      dismissInbox: (input: ServerJarvisDismissInboxInput, requestOptions?: RequestOptions) =>
        request<ServerJarvisDismissInboxOutput>(
          {
            method: "POST",
            path: `/api/jarvis/inbox/${encodeURIComponent(input.wakeID)}/dismiss`,
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      retryInbox: (input: ServerJarvisRetryInboxInput, requestOptions?: RequestOptions) =>
        request<ServerJarvisRetryInboxOutput>(
          {
            method: "POST",
            path: `/api/jarvis/inbox/${encodeURIComponent(input.wakeID)}/retry`,
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
  }
}

function appendQuery(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return
  if (Array.isArray(value)) {
    for (const item of value) appendQuery(params, key, item)
    return
  }
  if (typeof value === "object") {
    for (const [child, item] of Object.entries(value)) appendQuery(params, `${key}[${child}]`, item)
    return
  }
  params.append(key, String(value))
}

async function json(response: Response): Promise<unknown> {
  if (!isContentType(response, "application/json") && !response.headers.get("content-type")?.includes("+json")) {
    try {
      await response.body?.cancel()
    } catch {}
    throw new ClientError("UnsupportedContentType")
  }
  let text: string
  try {
    text = await response.text()
  } catch (cause) {
    throw new ClientError("Transport", { cause })
  }
  if (text === "") throw new ClientError("MalformedResponse")
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new ClientError("MalformedResponse", { cause })
  }
}

function isContentType(response: Response, expected: string) {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === expected
}
