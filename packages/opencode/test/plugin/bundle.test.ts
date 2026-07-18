import { expect, test } from "bun:test"
import path from "path"
import { mkdir, mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import { PluginBundle } from "@/plugin/bundle"

test("discovers enabled Codex plugin skills and MCP servers", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "opencode-plugin-bundle-"))
  const alpha = path.join(home, ".codex/plugins/cache/local/alpha/1.0.0")
  const beta = path.join(home, ".codex/plugins/cache/local/beta/1.0.0")

  try {
    await mkdir(path.join(alpha, ".codex-plugin"), { recursive: true })
    await mkdir(path.join(alpha, "skills/review"), { recursive: true })
    await mkdir(path.join(alpha, "mcp"), { recursive: true })
    await mkdir(path.join(beta, ".codex-plugin"), { recursive: true })
    await mkdir(path.join(beta, "skills/hidden"), { recursive: true })
    await mkdir(path.join(home, ".codex"), { recursive: true })

    await Bun.write(
      path.join(home, ".codex/config.toml"),
      ['[plugins."alpha@local"]', "enabled = true", "", '[plugins."beta@local"]', "enabled = false"].join("\n"),
    )
    await Bun.write(
      path.join(alpha, ".codex-plugin/plugin.json"),
      JSON.stringify({
        name: "alpha",
        version: "1.0.0",
        description: "Alpha workflow",
        skills: "./skills",
        mcpServers: "./.mcp.json",
        interface: { displayName: "Alpha" },
      }),
    )
    await Bun.write(
      path.join(alpha, "skills/review/SKILL.md"),
      "---\nname: review\ndescription: Review changes\n---\nReview the change.",
    )
    await Bun.write(
      path.join(alpha, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          review: { command: "node", args: ["./mcp/server.mjs"], cwd: ".", tool_timeout_sec: 12 },
        },
      }),
    )
    await Bun.write(path.join(beta, ".codex-plugin/plugin.json"), JSON.stringify({ name: "beta", skills: "./skills" }))
    await Bun.write(
      path.join(beta, "skills/hidden/SKILL.md"),
      "---\nname: hidden\ndescription: Hidden skill\n---\nHidden.",
    )

    const plugins = await PluginBundle.list({ home, refresh: true })
    expect(plugins).toHaveLength(2)
    expect(plugins.find((plugin) => plugin.name === "alpha")).toMatchObject({
      displayName: "Alpha",
      enabled: true,
      skills: 1,
      mcp: true,
    })
    expect(plugins.find((plugin) => plugin.name === "beta")?.enabled).toBe(false)

    expect(await PluginBundle.skillDirectories({ home })).toEqual([path.join(alpha, "skills")])
    expect(await PluginBundle.mcpServers({ home })).toEqual({
      "alpha/review": {
        type: "local",
        command: ["node", "./mcp/server.mjs"],
        cwd: alpha,
        environment: undefined,
        timeout: 12_000,
      },
    })
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
