import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { JSearchService, readJSearchKey } from "./jsearch-service.js";
import { ROLES, type Market } from "../../shared/search.js";
import { additionalJobs } from "../../shared/discovery.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const service = new JSearchService({ directory: join(root, "data/jsearch"), getKey: () => readJSearchKey(join(root, ".env.local")) });
if (process.argv.includes("--status")) console.log(JSON.stringify(await service.status(), null, 2));
else {
  const roleId = process.argv[2], market = process.argv[3] as Market;
  const role = ROLES.find(r => r.id === roleId);
  if (!role || !["us", "in"].includes(market)) throw new Error("Usage: npm run jsearch -- <role-id> <us|in>, or --status. One page, at most one provider request.");
  const result = await service.search({ version: 1, roles: [{ id: role.id, label: role.label }], markets: [market], location: "", workplace: "any", level: "any" }, role.id);
  const shard = JSON.parse(await readFile(join(root, "data/feed", market + ".json"), "utf8"));
  const additional = additionalJobs(shard.jobs, result.jobs);
  const summary = { role: role.label, market, requestsUsed: result.requestsUsed, localMonthlyRequests: result.localMonthlyRequests,
    queries: result.queries, matched: result.jobs.length, additional: additional.length, exactDuplicates: result.jobs.length - additional.length, warnings: result.warnings };
  await writeFile(join(root, "data/jsearch", `trial-${roleId}-${market}.json`), JSON.stringify({ summary, jobs: result.jobs }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}
