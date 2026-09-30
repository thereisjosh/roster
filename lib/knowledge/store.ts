/**
 * Knowledge page store — CRUD operations + relevance queries.
 */

import { eq, and, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { knowledgePage } from "@/lib/db/schema";
import type { KnowledgePage, PageMetadata, PageType } from "./types";

export async function getPage(
  businessId: string,
  slug: string,
): Promise<KnowledgePage | undefined> {
  const row = await db.query.knowledgePage.findFirst({
    where: and(
      eq(knowledgePage.businessId, businessId),
      eq(knowledgePage.slug, slug),
    ),
  });
  return row as KnowledgePage | undefined;
}

export async function upsertPage(
  businessId: string,
  slug: string,
  data: {
    pageType: PageType;
    title: string;
    content: string;
    metadata?: PageMetadata;
  },
): Promise<KnowledgePage> {
  const existing = await getPage(businessId, slug);

  if (existing) {
    const [updated] = await db
      .update(knowledgePage)
      .set({
        title: data.title,
        content: data.content,
        metadata: data.metadata ?? existing.metadata,
        version: existing.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(knowledgePage.businessId, businessId),
          eq(knowledgePage.slug, slug),
        ),
      )
      .returning();
    return updated as KnowledgePage;
  }

  const [created] = await db
    .insert(knowledgePage)
    .values({
      businessId,
      slug,
      pageType: data.pageType,
      title: data.title,
      content: data.content,
      metadata: data.metadata ?? {},
    })
    .returning();
  return created as KnowledgePage;
}

export async function deletePage(
  businessId: string,
  slug: string,
): Promise<void> {
  await db
    .delete(knowledgePage)
    .where(
      and(
        eq(knowledgePage.businessId, businessId),
        eq(knowledgePage.slug, slug),
      ),
    );
}

export async function getPagesByType(
  businessId: string,
  pageType: PageType,
): Promise<KnowledgePage[]> {
  const rows = await db.query.knowledgePage.findMany({
    where: and(
      eq(knowledgePage.businessId, businessId),
      eq(knowledgePage.pageType, pageType),
    ),
  });
  return rows as KnowledgePage[];
}

/**
 * Query pages relevant to a specific set of staff and/or days.
 * Uses JSONB containment operators on the metadata column.
 */
export async function queryRelevantPages(
  businessId: string,
  staffIds: string[],
  days?: number[],
): Promise<KnowledgePage[]> {
  // Build conditions: pages whose metadata.staffIds overlap with the provided staffIds,
  // OR pages of type "index"/"pattern" for the business
  const conditions = [];

  if (staffIds.length > 0) {
    // metadata->'staffIds' ?| array[staffIds]
    conditions.push(
      sql`${knowledgePage.metadata}->'staffIds' ?| array[${sql.join(
        staffIds.map((id) => sql`${id}`),
        sql`, `,
      )}]`,
    );
  }

  if (days && days.length > 0) {
    conditions.push(
      sql`${knowledgePage.metadata}->'days' ?| array[${sql.join(
        days.map((d) => sql`${String(d)}`),
        sql`, `,
      )}]`,
    );
  }

  // Always include index/pattern pages
  const businessFilter = eq(knowledgePage.businessId, businessId);

  if (conditions.length === 0) {
    return db.query.knowledgePage.findMany({
      where: businessFilter,
    }) as Promise<KnowledgePage[]>;
  }

  const rows = await db.query.knowledgePage.findMany({
    where: and(
      businessFilter,
      sql`(${sql.join(conditions, sql` OR `)} OR ${knowledgePage.pageType} IN ('index', 'pattern'))`,
    ),
  });

  return rows as KnowledgePage[];
}
