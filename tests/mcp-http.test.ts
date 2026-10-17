import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { resolve } from "node:path";
import { startChatGptMcpHttpServer } from "../src/adapters/chatgpt-web/mcp-http-server";

async function runCli(args: string[]) {
  const child = Bun.spawn([
    process.execPath,
    resolve(import.meta.dir, "../src/cli.ts"),
    ...args,
  ], {
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

test("mcp-http CLI validates its configured port", async () => {
  const result = await runCli(["mcp-http", "--port", "0"]);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("--port must be an integer from 1 to 65535");
});

test("Streamable HTTP exposes the shared Codex Native2 MCP tools and health endpoint", async () => {
  const running = await startChatGptMcpHttpServer({
    brokerSocketPath: "/tmp/codex-web-gpt-mcp-http-smoke-unused.sock",
    host: "127.0.0.1",
    port: 0,
  });
  const client = new Client({ name: "codex-web-gpt-mcp-http-smoke", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${running.port}/mcp`));
  try {
    const health = await fetch(`http://127.0.0.1:${running.port}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools.map(tool => tool.name).sort()).toEqual([
      "codex_apply_patch",
      "codex_exec",
      "codex_tool_call",
      "codex_tool_inventory",
      "codex_view_image",
      "codex_write_stdin",
    ]);
    expect(listed.tools.find(tool => tool.name === "codex_exec")).toMatchObject({
      name: "codex_exec",
      description: expect.any(String),
      inputSchema: {
        type: "object",
        required: expect.arrayContaining(["turn_token", "cmd"]),
      },
    });
    expect(JSON.stringify(listed)).not.toContain("surface_nonce");
  } finally {
    await client.close();
    await running.close();
  }
});

test("Streamable HTTP preserves the Zero Risk request_id contract", async () => {
  const running = await startChatGptMcpHttpServer({
    brokerSocketPath: "/tmp/codex-web-gpt-mcp-http-safe-smoke-unused.sock",
    contract: "safe",
    host: "127.0.0.1",
    port: 0,
  });
  const client = new Client({ name: "codex-web-gpt-mcp-http-safe-smoke", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${running.port}/mcp`));
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools.map(tool => tool.name)).toContain("codex_turn_start");
    expect(listed.tools.map(tool => tool.name)).toContain("codex_turn_complete");
    const start = listed.tools.find(tool => tool.name === "codex_turn_start");
    expect(start?.inputSchema).toMatchObject({
      type: "object",
      required: ["request_id"],
    });
    expect(JSON.stringify(start?.inputSchema)).not.toContain("turn_token");
  } finally {
    await client.close();
    await running.close();
  }
});
