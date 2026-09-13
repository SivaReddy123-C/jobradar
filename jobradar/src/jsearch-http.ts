import type { IncomingMessage, ServerResponse } from "node:http";
import { JSearchService } from "./jsearch-service.js";

export function trustedLocalRequest(req: Pick<IncomingMessage, "headers">): boolean {
  const host = req.headers.host;
  if (!host || !["localhost:5174", "127.0.0.1:5174"].includes(host)) return false;
  return req.headers.origin === "http://" + host && (!req.headers["sec-fetch-site"] || req.headers["sec-fetch-site"] === "same-origin");
}
export function jsearchHandler(service: JSearchService, saveKey?: (key: unknown) => Promise<void>) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const respond = (status: number, value: unknown) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(value)); };
    if (!trustedLocalRequest(req)) { respond(403, { error: "Discovery accepts same-origin localhost requests only." }); return; }
    if (req.method !== "POST") { respond(405, { error: "Use POST." }); return; }
    try {
      let body = "";
      for await (const chunk of req) { body += chunk.toString(); if (Buffer.byteLength(body) > 12000) { respond(413, { error: "Request too large." }); return; } }
      const payload = JSON.parse(body) as Record<string, unknown>;
      if (payload.action === "configure" && saveKey) { await saveKey(payload.key); respond(200, await service.status()); return; }
      if (payload.action === "status") { respond(200, await service.status()); return; }
      if (payload.action !== "search" || typeof payload.roleId !== "string") { respond(400, { error: "Choose a discovery role." }); return; }
      respond(200, await service.search(payload.preferences, payload.roleId));
    } catch (e) { respond(400, { error: e instanceof SyntaxError ? "Invalid request JSON." : (e as Error).message }); }
  };
}
