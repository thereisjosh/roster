/**
 * Knowledge base initializer — bootstraps KB for existing businesses.
 * Creates staff pages from the staff table and rule pages from preferenceRule rows.
 */

import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { staff as staffTable, preferenceRule } from "@/lib/db/schema";
import { upsertPage, getPagesByType } from "./store";
import type { PageMetadata } from "./types";
import { createLogger } from "@/lib/logging";

const logger = createLogger("knowledge-init");

/**
 * Initialize (or refresh) the knowledge base for a business.
 * Idempotent — safe to run multiple times.
 */
export async function initializeKnowledgeBase(businessId: string): Promise<{
  staffPages: number;
  rulePages: number;
}> {
  // 1. Create staff pages
  const activeStaff = await db.query.staff.findMany({
    where: and(eq(staffTable.businessId, businessId), eq(staffTable.isActive, true)),
  });

  let staffPages = 0;
  for (const s of activeStaff) {
    const slug = `staff/${s.name.toLowerCase().replace(/\s+/g, "-")}`;
    const roles = (s.roles as string[]) ?? [];
    const content = [
      `# ${s.name}`,
      "",
      `- **Employment:** ${s.employmentType.replace("_", " ")}`,
      `- **Level:** ${s.level}`,
      `- **Roles:** ${roles.join(", ") || "none"}`,
      roles.length > 0 ? `- **Qualifications:** ${roles.join(", ")}` : "",
      "",
      "## Shift History",
      "",
      "_No history yet — will be populated after schedule approvals._",
      "",
      "## Observed Patterns",
      "",
      "_No patterns detected yet._",
      "",
      "## Related Rules",
      "",
      "_No rules linked yet._",
    ]
      .filter(Boolean)
      .join("\n");

    const metadata: PageMetadata = {
      staffIds: [s.id],
    };

    await upsertPage(businessId, slug, {
      pageType: "staff",
      title: s.name,
      content,
      metadata,
    });
    staffPages++;
  }

  // 2. Create rule pages from existing preference rules
  const rules = await db.query.preferenceRule.findMany({
    where: eq(preferenceRule.businessId, businessId),
  });

  let rulePages = 0;
  for (const r of rules) {
    if (r.rejectedAt) continue;

    const slug = `rule/${r.id.slice(0, 8)}`;
    const content = [
      `# ${r.ruleText}`,
      "",
      `- **Type:** ${r.ruleType}`,
      `- **Source:** ${r.source}`,
      `- **Confidence:** ${r.confidence}`,
      `- **Active:** ${r.active}`,
      r.expiresAt ? `- **Expires:** ${r.expiresAt.toISOString()}` : "",
      "",
      "## Provenance",
      "",
      `Created from ${r.source === "learned_from_edit" ? "manager edit analysis" : r.source === "staff_request" ? "staff request" : "manual entry"}.`,
    ]
      .filter(Boolean)
      .join("\n");

    const metadata: PageMetadata = {
      ruleType: r.ruleType,
      confidence: r.confidence,
    };

    await upsertPage(businessId, slug, {
      pageType: "rule",
      title: r.ruleText,
      content,
      metadata,
    });
    rulePages++;
  }

  // 3. Create index page
  const existingStaffPages = await getPagesByType(businessId, "staff");
  const existingRulePages = await getPagesByType(businessId, "rule");

  const indexContent = [
    "# Knowledge Base Index",
    "",
    "## Staff Pages",
    "",
    ...existingStaffPages.map((p) => `- [[${p.slug}]] — ${p.title}`),
    "",
    "## Rule Pages",
    "",
    ...existingRulePages.map((p) => `- [[${p.slug}]] — ${p.title}`),
  ].join("\n");

  await upsertPage(businessId, "index", {
    pageType: "index",
    title: "Knowledge Base Index",
    content: indexContent,
  });

  logger.info({ businessId, staffPages, rulePages }, "knowledge base initialized");
  return { staffPages, rulePages };
}
