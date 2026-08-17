export * as Database from "./database"

import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { layer as sqliteLayer } from "#sqlite"
import { Context, Effect, Layer } from "effect"
import { Global } from "../global"
import { Flag } from "../flag/flag"
import { isAbsolute, join } from "path"
import { DatabaseMigration } from "./migration"
import { InstallationChannel } from "../installation/version"
import { makeGlobalNode } from "../effect/app-node"

const makeDatabase = EffectDrizzleSqlite.makeWithDefaults()
type DatabaseShape = Effect.Success<typeof makeDatabase>

export interface Interface {
  db: DatabaseShape
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/storage/Database") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* makeDatabase

    yield* db.run("PRAGMA journal_mode = WAL")
    yield* db.run("PRAGMA synchronous = NORMAL")
    yield* db.run("PRAGMA busy_timeout = 5000")
    yield* db.run("PRAGMA cache_size = -64000")
    yield* db.run("PRAGMA foreign_keys = ON")
    yield* db.run("PRAGMA wal_checkpoint(PASSIVE)")
    yield* DatabaseMigration.apply(db)
    // Virtual FTS tables are not represented by Drizzle's schema snapshot, so
    // fresh databases create this companion index after the canonical schema.
    yield* db.run(
      "CREATE VIRTUAL TABLE IF NOT EXISTS jarvis_memory_fts USING fts5(body, content='jarvis_memory', content_rowid='rowid', tokenize='unicode61')",
    )
    yield* db.run(
      "CREATE TRIGGER IF NOT EXISTS jarvis_memory_fts_insert AFTER INSERT ON jarvis_memory BEGIN INSERT INTO jarvis_memory_fts(rowid, body) VALUES (new.rowid, new.body); END",
    )
    yield* db.run(
      "CREATE TRIGGER IF NOT EXISTS jarvis_memory_fts_delete AFTER DELETE ON jarvis_memory BEGIN INSERT INTO jarvis_memory_fts(jarvis_memory_fts, rowid, body) VALUES ('delete', old.rowid, old.body); END",
    )
    yield* db.run(
      "CREATE TRIGGER IF NOT EXISTS jarvis_memory_fts_update AFTER UPDATE OF body ON jarvis_memory BEGIN INSERT INTO jarvis_memory_fts(jarvis_memory_fts, rowid, body) VALUES ('delete', old.rowid, old.body); INSERT INTO jarvis_memory_fts(rowid, body) VALUES (new.rowid, new.body); END",
    )

    return { db }
  }).pipe(Effect.orDie),
)

export function layerFromPath(filename: string) {
  return layer.pipe(Layer.provide(sqliteLayer({ filename })))
}

export function path() {
  if (Flag.OPENCODE_DB) {
    if (Flag.OPENCODE_DB === ":memory:" || isAbsolute(Flag.OPENCODE_DB)) return Flag.OPENCODE_DB
    return join(Global.Path.data, Flag.OPENCODE_DB)
  }
  if (
    ["latest", "beta", "prod"].includes(InstallationChannel) ||
    process.env.OPENCODE_DISABLE_CHANNEL_DB === "1" ||
    process.env.OPENCODE_DISABLE_CHANNEL_DB === "true"
  )
    return join(Global.Path.data, "opencode.db")
  return join(Global.Path.data, `opencode-${InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
}

export const node = makeGlobalNode({ service: Service, layer: layerFromPath(path()), deps: [] })
