// Bundling boundary for the closed runtime. TypeScript consumes the adjacent
// declaration while Bun follows these static imports into the executable.
import { Server } from "opencode/server/server"
import { startAvatarBridge } from "@opencode-ai/desktop/avatar-bridge"

export { Server, startAvatarBridge }
