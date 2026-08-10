export * as ServerEvent from "./server-event"

import { Event } from "./event"

export const Connected = Event.define({ type: "server.connected", schema: {} })
export const Heartbeat = Event.define({ type: "server.heartbeat", schema: {} })
export const Disposed = Event.define({ type: "global.disposed", schema: {} })

export const Definitions = Event.inventory(Connected, Heartbeat, Disposed)
