import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createChatGptMcpServer, type ChatGptMcpServerOptions } from "./mcp-server";

export interface ChatGptMcpHttpServerOptions extends ChatGptMcpServerOptions {
  host?: string;
  port?: number;
}

export interface RunningChatGptMcpHttpServer {
  server: Server;
  host: string;
  port: number;
  close(): Promise<void>;
}

function sendJson(response: ServerResponse, status: number, value: Record<string, unknown>): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

async function handleMcpPost(
  request: IncomingMessage,
  response: ServerResponse,
  options: ChatGptMcpServerOptions,
): Promise<void> {
  const mcpServer = createChatGptMcpServer(options);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  let connected = false;
  try {
    await mcpServer.connect(transport);
    connected = true;
    await transport.handleRequest(request, response);
  } catch {
    // Request bodies and SDK errors can contain caller supplied values. Keep the HTTP boundary
    // content-free and avoid logging them.
    if (!response.headersSent) sendJson(response, 500, { error: "MCP request failed" });
    else response.destroy();
  } finally {
    try {
      if (connected) await mcpServer.close();
      else await transport.close();
    } catch {
      // Cleanup must not expose a request body or replace an already-sent MCP response.
    }
  }
}

export async function startChatGptMcpHttpServer(
  options: ChatGptMcpHttpServerOptions,
): Promise<RunningChatGptMcpHttpServer> {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 17_843;
  const mcpOptions: ChatGptMcpServerOptions = {
    brokerSocketPath: options.brokerSocketPath,
    ...(options.contract !== undefined ? { contract: options.contract } : {}),
  };

  const server = createServer((request, response) => {
    let pathname: string;
    try {
      pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    } catch {
      sendJson(response, 400, { error: "Invalid request path" });
      return;
    }
    if (pathname === "/healthz") {
      if (request.method !== "GET") {
        response.setHeader("allow", "GET");
        sendJson(response, 405, { error: "Method not allowed" });
        return;
      }
      sendJson(response, 200, { status: "ok" });
      return;
    }
    if (pathname !== "/mcp") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (request.method !== "POST") {
      response.setHeader("allow", "POST");
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }
    void handleMcpPost(request, response, mcpOptions).catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: "MCP request failed" });
      else response.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(requestedPort, host, () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>(resolve => server.close(() => resolve()));
    throw new Error("MCP HTTP server did not bind a TCP address");
  }
  const bound = address as AddressInfo;
  return {
    server,
    host,
    port: bound.port,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    }),
  };
}
