import { defaultBrokerEndpoint, resolveBrokerEndpoint } from "../../config";
import { startChatGptMcpHttpServer } from "./mcp-http-server";
import type { ChatGptMcpContract } from "./mcp-server";

function option(args: string[], name: string, fallback: string): string {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1]?.trim();
  if (!value) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}

export async function runChatGptMcpHttpMain(args: string[]): Promise<void> {
  const remaining = [...args];
  const brokerSocketPath = resolveBrokerEndpoint(option(remaining, "--broker-socket", defaultBrokerEndpoint()));
  const requestedContract = option(remaining, "--contract", "native");
  if (requestedContract !== "native" && requestedContract !== "safe") {
    throw new Error(`--contract must be native or safe, received ${requestedContract}`);
  }
  const host = option(remaining, "--host", "127.0.0.1");
  const portText = option(remaining, "--port", "17843");
  if (!/^\d+$/.test(portText)) throw new Error("--port must be an integer from 1 to 65535");
  const port = Number(portText);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("--port must be an integer from 1 to 65535");
  }
  if (remaining.length > 0) throw new Error(`Unknown MCP HTTP arguments: ${remaining.join(" ")}`);

  const running = await startChatGptMcpHttpServer({
    brokerSocketPath,
    contract: requestedContract as ChatGptMcpContract,
    host,
    port,
  });
  const displayHost = host.includes(":") ? `[${host}]` : host;
  process.stdout.write(`Codex Web GPT MCP HTTP listening on http://${displayHost}:${running.port}/mcp\n`);
  await new Promise<void>(() => {});
}
