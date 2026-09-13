import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
await mkdir('.test-profiles',{recursive:true});
await build({entryPoints:['tests/browser.mts'],bundle:true,platform:'node',format:'esm',target:'node22',external:['playwright'],outfile:'.test-profiles/browser.mjs'});
const run=spawnSync(process.execPath,['.test-profiles/browser.mjs'],{stdio:'inherit'});
process.exit(run.status ?? 1);
