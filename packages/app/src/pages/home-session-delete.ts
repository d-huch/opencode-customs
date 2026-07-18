import { notifySessionTabsRemoved } from "@/components/titlebar-session-events"
import type { ServerConnection } from "@/context/server"

type HomeSession = {
  id: string
  directory: string
  parentID?: string
}

export async function deleteHomeSession(input: {
  server: ServerConnection.Key
  session: HomeSession
  sessions: HomeSession[]
  request: () => Promise<boolean | undefined>
  remove: (sessionIDs: string[]) => void
  evict: (sessionID: string) => void
  isAlreadyDeleted?: (error: unknown) => boolean
  onError?: (error: unknown) => void
}) {
  const deleted = await input.request().catch((error) => {
    if (input.isAlreadyDeleted?.(error)) return true
    input.onError?.(error)
    return false
  })
  if (!deleted) return false

  const sessionIDs = [input.session.id, ...descendantIDs(input.sessions, input.session.id)]
  input.remove(sessionIDs)
  sessionIDs.forEach(input.evict)
  notifySessionTabsRemoved({
    server: input.server,
    directory: input.session.directory,
    sessionIDs,
  })
  return true
}

function descendantIDs(sessions: HomeSession[], parentID: string): string[] {
  return sessions
    .filter((session) => session.parentID === parentID)
    .flatMap((session) => [session.id, ...descendantIDs(sessions, session.id)])
}
