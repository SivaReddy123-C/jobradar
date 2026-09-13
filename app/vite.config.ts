import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), {
    name: "local-job-feed",
    configureServer(server) {
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
