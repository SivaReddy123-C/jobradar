import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { JSearchService, readJSearchKey, saveJSearchKey } from "../jobradar/src/jsearch-service.js";
import { jsearchHandler } from "../jobradar/src/jsearch-http.js";

export default defineConfig({
  server: { host: "127.0.0.1", port: 5174, strictPort: true, fs: { deny: [".env", ".env.*", "**/data/jsearch/**", "*.{crt,pem}", "**/.git/**"] } },
  plugins: [react(), {
    name: "local-job-feed",
    async generateBundle() {
      // Publish only the public market shards with the app, never local keys or
      // discovery caches. The site and its feed now come from the same release.
      for (const file of ["index.json", "us.json", "in.json"]) {
        this.emitFile({ type: "asset", fileName: `feed/${file}`, source: await readFile(fileURLToPath(new URL(`../jobradar/data/feed/${file}`, import.meta.url))) });
      }
    },
    configureServer(server) {
      if (process.env.VITE_LOCAL_DISCOVERY === "true") {
        const discovery = new JSearchService({
          directory: fileURLToPath(new URL("../jobradar/data/jsearch/", import.meta.url)),
          getKey: () => readJSearchKey(fileURLToPath(new URL("../jobradar/.env.local", import.meta.url))),
        });
        server.middlewares.use("/__discovery", jsearchHandler(discovery, key => saveJSearchKey(fileURLToPath(new URL("../jobradar/.env.local", import.meta.url)), key)));
      }
      server.middlewares.use("/__feed", async (req, res) => {
        const file = req.url?.split("?")[0]?.slice(1);
        if (!file || !["index.json", "us.json", "in.json"].includes(file)) { res.statusCode = 404; res.end(); return; }
        try {
          const body = await readFile(fileURLToPath(new URL(`../jobradar/data/feed/${file}`, import.meta.url)));
          res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store"); res.end(body);
        } catch { res.statusCode = 503; res.end("Local feed unavailable. Run the collector and feed publisher."); }
      });
    },
  }],
  // Relative base so the same build works on GitHub Pages (/sivareddy/),
  // Vercel, or any static host.
  base: "./",
});
