#!/usr/bin/env bun
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { $ } from "bun"

const source = join(import.meta.dir, "../native/voice-agent")
const bundle = join(import.meta.dir, "../native/swift-build/OpenCode Customs Voice Agent.app")
const executable = join(bundle, "Contents/MacOS/OpenCode Customs Voice Agent")
const cache = await mkdtemp(join(tmpdir(), "opencode-customs-voice-"))

await rm(bundle, { recursive: true, force: true })
await mkdir(join(bundle, "Contents/MacOS"), { recursive: true })
await copyFile(join(source, "Info.plist"), join(bundle, "Contents/Info.plist"))
await $`/usr/bin/swiftc -module-cache-path ${cache} ${join(source, "main.swift")} -framework AVFoundation -framework Speech -o ${executable}`
await rm(cache, { recursive: true, force: true })
