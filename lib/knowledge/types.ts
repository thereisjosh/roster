/**
 * Knowledge base types — interfaces for the wiki-style knowledge engine.
 */

export type PageType = "staff" | "rule" | "pair" | "pattern" | "index" | "log";

export interface PageMetadata {
  staffIds?: string[];
  days?: number[]; // 0=Sun..6=Sat
  shiftTypes?: string[];
  ruleType?: "soft" | "hard" | "temporary";
  confidence?: number;
  // Pair dynamics
  pairType?: "affinity" | "friction";
  weight?: number;
  evidence?: PairEvidence[];
  rejectedAt?: string; // ISO date if manager dismissed
  // Staff page extras
  shiftHistory?: ShiftHistoryEntry[];
  patterns?: string[]; // summary strings like "moved off Sundays 4/6 weeks"
}

export interface PairEvidence {
  editId: string;
  date: string;
  description: string;
}

export interface ShiftHistoryEntry {
  weekStart: string;
  assignments: { day: string; shift: string; hours: number }[];
  edits?: { originalShift: string; newShift: string; reason?: string }[];
}

export interface KnowledgePage {
  id: string;
  businessId: string;
  slug: string;
  pageType: PageType;
  title: string;
  content: string; // markdown with [[slug]] cross-references
  metadata: PageMetadata;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Context returned by queryForGeneration for use in the scheduling pipeline */
export interface WikiContext {
  /** Hard rules filtered for relevance to this generation */
  hardRules: WikiRule[];
  /** Soft rules filtered for relevance */
  softRules: WikiRule[];
  /** Per-staff context strings keyed by staffId */
  staffContext: Map<string, string>;
  /** Pair dynamics relevant to staff in this generation */
  pairDynamics: PairDynamic[];
  /** Raw pages for debugging/provenance */
  pages: KnowledgePage[];
}

export interface WikiRule {
  ruleText: string;
  ruleType: "soft" | "hard" | "temporary";
  confidence: number;
  /** Slug of the source knowledge page */
  sourceSlug: string;
}

export interface PairDynamic {
  staffId1: string;
  staffId2: string;
  type: "affinity" | "friction";
  weight: number;
  evidence: PairEvidence[];
  confirmed: boolean;
}
