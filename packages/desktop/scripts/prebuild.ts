#!/usr/bin/env bun
import { $ } from "bun"

import { resolveChannel } from "./utils"

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_ICON_CHANNEL ?? channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`
if (process.platform === "darwin") await $`bun ./scripts/build-voice-agent.ts`

await $`cd ../opencode && bun script/build-node.ts`
