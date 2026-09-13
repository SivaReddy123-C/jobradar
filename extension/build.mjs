import { build } from "esbuild";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await build({ entryPoints: ["src/background.ts"], bundle: true, format: "esm", target: "chrome120", outdir: "dist", sourcemap: false });
for (const file of ["sync.js", "popup.js", "popup.html", "manifest.json"]) await copyFile(file, "dist/" + file);
