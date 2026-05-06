import { createServer } from "node:http";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const host = process.env.GRANTPILOT_DEBUG_HOST ?? "127.0.0.1";
const port = Number(process.env.GRANTPILOT_DEBUG_PORT ?? 17762);
const logPath = resolve(process.env.GRANTPILOT_DEBUG_LOG ?? "tmp/grantpilot/events.jsonl");

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type"
};

function send(response, statusCode, body = "") {
  response.writeHead(statusCode, {
    ...corsHeaders,
    "content-type": "text/plain; charset=utf-8"
  });
  response.end(body);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : null;
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") {
      send(response, 204);
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      send(response, 200, "ok\n");
      return;
    }

    if (request.method !== "POST" || request.url !== "/events") {
      send(response, 404, "not found\n");
      return;
    }

    const event = await readJsonBody(request);
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(
      logPath,
      `${JSON.stringify({ receivedAt: new Date().toISOString(), event })}\n`,
      "utf8"
    );
    send(response, 204);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send(response, 500, `${message}\n`);
  }
});

server.listen(port, host, () => {
  console.log(`GrantPilot debug log server listening at http://${host}:${port}/events`);
  console.log(`Writing JSONL events to ${logPath}`);
});
