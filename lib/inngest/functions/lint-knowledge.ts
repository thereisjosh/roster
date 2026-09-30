import { inngest } from "../client";
import type { InngestFunction } from "inngest";
import { db } from "@/lib/db";
import { lintKnowledgeBase } from "@/lib/knowledge/lint";
import { createLogger } from "@/lib/logging";

const logger = createLogger("lint-knowledge");

export const lintKnowledge: InngestFunction.Any = inngest.createFunction(
  {
    id: "lint-knowledge",
    triggers: [{ cron: "0 4 * * 1" }], // Monday 4am, after pattern mining
  },
  async ({ step }: { step: any }) => {
    const businesses = await step.run("load-businesses", async () => {
      return db.query.business.findMany();
    });

    const results = [];

    for (const biz of businesses) {
      const result = await step.run(`lint-${biz.id}`, async () => {
        return lintKnowledgeBase(biz.id);
      });
      results.push({ businessId: biz.id, ...result });
    }

    const totalIssues = results.reduce(
      (sum, r) =>
        sum +
        r.staleRules.length +
        r.orphanedRefs.length +
        r.contradictions.length +
        r.decayedPairs.length +
        r.inactiveStaffRefs.length,
      0,
    );

    logger.info({ totalIssues, businesses: results.length }, "knowledge lint complete");
    return { totalIssues, results };
  },
);
