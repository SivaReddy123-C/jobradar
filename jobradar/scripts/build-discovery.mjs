import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
await build({ entryPoints: [fileURLToPath(new URL('../src/hosted-discovery.ts', import.meta.url))], outfile: fileURLToPath(new URL('../../supabase/functions/job-discovery/core.js', import.meta.url)), bundle: true, format: 'esm', platform: 'node', target: 'es2022', external: ['node:crypto'] });
console.log('Built the discovery Edge Function core from shared matching rules.');
