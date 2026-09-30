import {
  pgTable,
  text,
  timestamp,
  boolean,
  jsonb,
  integer,
  real,
  uuid,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRoleEnum = pgEnum("user_role", [
  "owner",
  "manager",
  "viewer",
]);

export const subscriptionTierEnum = pgEnum("subscription_tier", [
  "trial",
  "starter",
  "pro",
  "enterprise",
]);

export const employmentTypeEnum = pgEnum("employment_type", [
  "full_time",
  "part_time",
  "casual",
]);

export const availabilityStatusEnum = pgEnum("availability_status", [
  "pending",
  "submitted",
  "confirmed",
]);

export const scheduleRunStatusEnum = pgEnum("schedule_run_status", [
  "generating",
  "pending_review",
  "approved",
  "finalised",
  "escalated",
]);

export const variationTypeEnum = pgEnum("variation_type", [
  "cost_optimised",
  "fairness_optimised",
  "balanced",
]);

export const ruleTypeEnum = pgEnum("rule_type", ["soft", "hard", "temporary"]);


export const ruleSourceEnum = pgEnum("rule_source", [
  "manager_explicit",
  "learned_from_edit",
  "staff_request",
]);

export const coverRequestStatusEnum = pgEnum("cover_request_status", [
  "open",
  "filled",
  "escalated",
  "cancelled",
]);

export const messageDirectionEnum = pgEnum("message_direction", [
  "inbound",
  "outbound",
]);

export const messageChannelEnum = pgEnum("message_channel", [
  "whatsapp_reply",
  "whatsapp_template",
  "email",
  "sms",
  "telegram",
]);

// ---------------------------------------------------------------------------
// JSONB type interfaces
// ---------------------------------------------------------------------------

export interface BusinessConfig {
  weekStartDay: number; // 0=Sun, 1=Mon, etc.
  availabilityDeadlineDay: number;
  availabilityDeadlineHour: number;
  reminderIntervals: number[]; // hours before deadline
  coverageRequirements: {
    role: string;
    days: number[]; // 0=Sun..6=Sat
    startTime: string;
    endTime: string;
    minStaff: number;
    maxStaff?: number;
  }[];
  maxConsecutiveDays: number;
  minRestHoursBetweenShifts: number;
  minShiftHours?: number;
  costWeight: number; // 0-1 for schedule generation
  fairnessWeight: number; // 0-1 for schedule generation
  preferenceWeight: number; // 0-1 for schedule generation
  operatingHours?: Record<string, { open: string; close: string }>; // Keys: "0"=Sun, "1"=Mon, ..., "6"=Sat
  closedDays?: number[]; // day indices when closed (0=Sun, 1=Mon, etc.)
  fullTimeHours?: {
    min: number;
    target: number;
    max: number;
  };
  breakRules?: {
    name: string;
    durationMinutes: number;
  }[];
  breakDeduction?: {
    enabled: boolean;
    appliesTo: "full-time" | "part-time" | "both";
  };
}

export interface PayStructure {
  payType?: "hourly" | "salaried";
  monthlySalary?: number;
  baseHourlyRate: number;
}

export interface AvailabilitySlot {
  day: string; // ISO date
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  preference: "preferred" | "available" | "unavailable";
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface GenerationSnapshot {
  input: any; // ScheduleInput from validator (shifts, staff, constraints)
  config: BusinessConfig;
  preferenceRules: { id: string; ruleText: string; ruleType: string; confidence: number }[];
  weights: { costWeight: number; fairnessWeight: number; preferenceWeight: number };
  weekStart: string;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface ShiftAssignment {
  staffId: string;
  staffName: string;
  day: string;
  shiftType: string;
  startTime: string;
  endTime: string;
  cost: number;
}

// ---------------------------------------------------------------------------
// Better Auth tables
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  businessId: uuid("business_id").references(() => business.id),
  role: userRoleEnum("role").notNull().default("owner"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Business
// ---------------------------------------------------------------------------

export const business = pgTable("business", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Singapore"),
  subscriptionTier: subscriptionTierEnum("subscription_tier")
    .notNull()
    .default("trial"),
  config: jsonb("config").$type<BusinessConfig>(),
  inviteCode: text("invite_code").unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export const staff = pgTable(
  "staff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    employmentType: employmentTypeEnum("employment_type")
      .notNull()
      .default("part_time"),
    level: integer("level").notNull().default(1),
    roles: jsonb("roles").$type<string[]>().notNull().default([]),
    payStructure: jsonb("pay_structure").$type<PayStructure>(),
    telegramChatId: text("telegram_chat_id"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("staff_business_id_idx").on(t.businessId),
    index("staff_active_idx").on(t.businessId, t.isActive),
  ],
);

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export const availabilitySubmission = pgTable(
  "availability_submission",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    weekStart: timestamp("week_start").notNull(),
    status: availabilityStatusEnum("status").notNull().default("pending"),
    slots: jsonb("slots").$type<AvailabilitySlot[]>().notNull().default([]),
    submittedAt: timestamp("submitted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("availability_staff_week_idx").on(t.staffId, t.weekStart),
  ],
);

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

export const scheduleRun = pgTable(
  "schedule_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id, { onDelete: "cascade" }),
    weekStart: timestamp("week_start").notNull(),
    status: scheduleRunStatusEnum("status").notNull().default("generating"),
    promptVersion: text("prompt_version"),
    modelVersion: text("model_version"),
    costUsd: real("cost_usd"),
    generationSnapshot: jsonb("generation_snapshot").$type<GenerationSnapshot>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("schedule_run_business_idx").on(t.businessId)],
);

export const scheduleVariation = pgTable(
  "schedule_variation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => scheduleRun.id, { onDelete: "cascade" }),
    variationType: variationTypeEnum("variation_type").notNull(),
    assignments: jsonb("assignments")
      .$type<ShiftAssignment[]>()
      .notNull()
      .default([]),
    coverageWarnings: text("coverage_warnings"),
    totalCost: real("total_cost"),
    approvedAt: timestamp("approved_at"),
    approvedBy: text("approved_by").references(() => user.id),
    approvalFeedback: jsonb("approval_feedback").$type<{
      rating: "good" | "some_edits" | "significant_changes";
      comment?: string;
    }>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("schedule_variation_run_idx").on(t.runId)],
);

// ---------------------------------------------------------------------------
// Manager edits (for preference learning)
// ---------------------------------------------------------------------------

export const managerEdit = pgTable(
  "manager_edit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => scheduleRun.id, { onDelete: "cascade" }),
    variationId: uuid("variation_id")
      .notNull()
      .references(() => scheduleVariation.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staff.id),
    originalShift: text("original_shift").notNull(),
    newShift: text("new_shift").notNull(),
    editReason: text("edit_reason"),
    extractedRules: text("extracted_rules"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("manager_edit_run_idx").on(t.runId)],
);

// ---------------------------------------------------------------------------
// Preference rules
// ---------------------------------------------------------------------------

export const preferenceRule = pgTable(
  "preference_rule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id, { onDelete: "cascade" }),
    ruleText: text("rule_text").notNull(),
    ruleType: ruleTypeEnum("rule_type").notNull().default("soft"),
    source: ruleSourceEnum("source").notNull().default("manager_explicit"),
    confidence: real("confidence").notNull().default(1.0),
    active: boolean("active").notNull().default(true),
    rejectedAt: timestamp("rejected_at"),
    expiresAt: timestamp("expires_at"),
    lastReinforcedAt: timestamp("last_reinforced_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("preference_rule_business_idx").on(t.businessId, t.active)],
);

// ---------------------------------------------------------------------------
// Staff relationships (pair dynamics, mentorship, training)
// ---------------------------------------------------------------------------

export const staffRelationship = pgTable(
  "staff_relationship",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id, { onDelete: "cascade" }),
    staffId1: uuid("staff_id_1")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    staffId2: uuid("staff_id_2").references(() => staff.id, {
      onDelete: "cascade",
    }),
    semantics: text("semantics").notNull(),  // "separate" | "pair"
    label: text("label").notNull(),           // freeform: manager's own words
    weight: real("weight").notNull().default(1.0),
    confirmed: boolean("confirmed").notNull().default(false),
    evidence: jsonb("evidence")
      .$type<{ editId: string; date: string; description: string }[]>()
      .default([]),
    metadata: jsonb("metadata")
      .$type<{
        role?: string;
        minLevel?: number;
        decayAfterWeeks?: number;
      }>()
      .default({}),
    rejectedAt: timestamp("rejected_at"),
    lastReinforcedAt: timestamp("last_reinforced_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("staff_rel_business_idx").on(t.businessId),
    index("staff_rel_staff1_idx").on(t.staffId1),
    index("staff_rel_staff2_idx").on(t.staffId2),
    uniqueIndex("staff_rel_pair_semantics_idx").on(
      t.businessId,
      t.staffId1,
      t.staffId2,
      t.semantics,
      t.label,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Staff skills (capability tags for team composition)
// ---------------------------------------------------------------------------

export const staffSkill = pgTable("staff_skill", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull()
    .references(() => business.id, { onDelete: "cascade" }),
  staffId: uuid("staff_id").notNull()
    .references(() => staff.id, { onDelete: "cascade" }),
  tag: text("tag").notNull(),
  proficiency: real("proficiency").default(1.0),
  notes: text("notes"),
  source: text("source").notNull(),  // "manager_explicit" | "inferred" | "extracted"
  sourceUtterance: text("source_utterance"),
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("staff_skill_business_idx").on(t.businessId),
  index("staff_skill_staff_idx").on(t.staffId),
  uniqueIndex("staff_skill_unique_idx").on(t.staffId, t.tag),
]);

// ---------------------------------------------------------------------------
// Shift composition rules (team-level capability requirements)
// ---------------------------------------------------------------------------

export const shiftCompositionRule = pgTable("shift_composition_rule", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull()
    .references(() => business.id, { onDelete: "cascade" }),
  shiftType: text("shift_type"),  // null = all shifts
  tag: text("tag").notNull(),
  minimumCount: integer("minimum_count").notNull().default(1),
  minProficiency: real("min_proficiency").default(0.0),
  required: boolean("required").notNull().default(false),
  condition: jsonb("condition").$type<{
    whenTagPresent?: string;
    whenMinCount?: number;
  }>(),
  sourceUtterance: text("source_utterance"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("shift_comp_business_idx").on(t.businessId),
]);

// ---------------------------------------------------------------------------
// Cover requests
// ---------------------------------------------------------------------------

export const coverRequest = pgTable(
  "cover_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scheduleRunId: uuid("schedule_run_id")
      .notNull()
      .references(() => scheduleRun.id, { onDelete: "cascade" }),
    requestType: text("request_type").notNull().default("cover"), // "cover" | "swap"
    shiftId: text("shift_id").notNull(),
    requestingStaffId: uuid("requesting_staff_id")
      .notNull()
      .references(() => staff.id),
    status: coverRequestStatusEnum("status").notNull().default("open"),
    candidates: jsonb("candidates").$type<string[]>().default([]),
    filledBy: uuid("filled_by").references(() => staff.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("cover_request_run_idx").on(t.scheduleRunId)],
);

// ---------------------------------------------------------------------------
// Cover offers (individual offers to candidates)
// ---------------------------------------------------------------------------

export const coverOfferStatusEnum = pgEnum("cover_offer_status", [
  "pending",
  "accepted",
  "declined",
  "expired",
]);

export const coverOffer = pgTable(
  "cover_offer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    coverRequestId: uuid("cover_request_id")
      .notNull()
      .references(() => coverRequest.id, { onDelete: "cascade" }),
    candidateStaffId: uuid("candidate_staff_id")
      .notNull()
      .references(() => staff.id),
    status: coverOfferStatusEnum("status").notNull().default("pending"),
    offeredAt: timestamp("offered_at").notNull().defaultNow(),
    respondedAt: timestamp("responded_at"),
  },
  (t) => [
    index("cover_offer_request_idx").on(t.coverRequestId),
    index("cover_offer_candidate_idx").on(t.candidateStaffId, t.status),
  ],
);

// ---------------------------------------------------------------------------
// Communication log
// ---------------------------------------------------------------------------

export const communicationLog = pgTable(
  "communication_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id").references(() => staff.id),
    direction: messageDirectionEnum("direction").notNull(),
    channel: messageChannelEnum("channel").notNull(),
    body: text("body").notNull(),
    sentAt: timestamp("sent_at").notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at"),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("communication_log_business_idx").on(t.businessId),
    index("communication_log_staff_idx").on(t.staffId),
  ],
);

// ---------------------------------------------------------------------------
// Infrastructure: LLM call log
// ---------------------------------------------------------------------------

export const llmCallLog = pgTable(
  "llm_call_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: text("business_id").notNull(),
    taskType: text("task_type").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    costUsd: real("cost_usd").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    success: boolean("success").notNull(),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("llm_call_log_business_idx").on(t.businessId)],
);

// ---------------------------------------------------------------------------
// Infrastructure: Conversation window (WhatsApp free reply tracking)
// ---------------------------------------------------------------------------

export const conversationWindow = pgTable(
  "conversation_window",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    channel: text("channel").notNull().default("whatsapp"),
    windowOpensAt: timestamp("window_opens_at").notNull(),
    windowExpiresAt: timestamp("window_expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("conversation_window_staff_idx").on(t.staffId)],
);

// ---------------------------------------------------------------------------
// Telegram self-registration (in-progress state)
// ---------------------------------------------------------------------------

export const telegramRegistration = pgTable("telegram_registration", {
  chatId: text("chat_id").primaryKey(),
  businessId: uuid("business_id")
    .notNull()
    .references(() => business.id, { onDelete: "cascade" }),
  step: text("step").notNull(), // "awaiting_name" | "awaiting_phone"
  name: text("name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Conversation state (multi-turn tool parameter collection)
// ---------------------------------------------------------------------------

export const conversationState = pgTable("conversation_state", {
  staffId: uuid("staff_id")
    .primaryKey()
    .references(() => staff.id, { onDelete: "cascade" }),
  pendingTool: text("pending_tool").notNull(),
  pendingParams: jsonb("pending_params")
    .$type<Record<string, any>>()
    .notNull()
    .default({}),
  pendingPrompt: text("pending_prompt").notNull(), // param being asked for, e.g. "date"
  channel: text("channel").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Knowledge base
// ---------------------------------------------------------------------------

export const knowledgePage = pgTable(
  "knowledge_page",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    pageType: text("page_type").notNull(), // "staff" | "rule" | "pair" | "pattern" | "index" | "log"
    title: text("title").notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<import("@/lib/knowledge/types").PageMetadata>().default({}),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("knowledge_page_business_slug_idx").on(t.businessId, t.slug),
    index("knowledge_page_business_type_idx").on(t.businessId, t.pageType),
    index("knowledge_page_metadata_idx").on(t.metadata),
  ],
);

// ---------------------------------------------------------------------------
// Webhook idempotency
// ---------------------------------------------------------------------------

export const processedWebhookMessage = pgTable("processed_webhook_message", {
  id: text("id").primaryKey(), // "channel:messageId"
  channel: text("channel").notNull(), // "telegram" | "whatsapp"
  processedAt: timestamp("processed_at").defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const userRelations = relations(user, ({ one, many }) => ({
  business: one(business, {
    fields: [user.businessId],
    references: [business.id],
  }),
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const businessRelations = relations(business, ({ many }) => ({
  users: many(user),
  staff: many(staff),
  scheduleRuns: many(scheduleRun),
  preferenceRules: many(preferenceRule),
  communicationLogs: many(communicationLog),
  knowledgePages: many(knowledgePage),
}));

export const staffRelations = relations(staff, ({ one, many }) => ({
  business: one(business, {
    fields: [staff.businessId],
    references: [business.id],
  }),
  availabilitySubmissions: many(availabilitySubmission),
  conversationWindows: many(conversationWindow),
  coverRequests: many(coverRequest),
}));

export const availabilitySubmissionRelations = relations(
  availabilitySubmission,
  ({ one }) => ({
    staff: one(staff, {
      fields: [availabilitySubmission.staffId],
      references: [staff.id],
    }),
  }),
);

export const scheduleRunRelations = relations(
  scheduleRun,
  ({ one, many }) => ({
    business: one(business, {
      fields: [scheduleRun.businessId],
      references: [business.id],
    }),
    variations: many(scheduleVariation),
    managerEdits: many(managerEdit),
    coverRequests: many(coverRequest),
  }),
);

export const scheduleVariationRelations = relations(
  scheduleVariation,
  ({ one, many }) => ({
    run: one(scheduleRun, {
      fields: [scheduleVariation.runId],
      references: [scheduleRun.id],
    }),
    approver: one(user, {
      fields: [scheduleVariation.approvedBy],
      references: [user.id],
    }),
    managerEdits: many(managerEdit),
  }),
);

export const managerEditRelations = relations(managerEdit, ({ one }) => ({
  run: one(scheduleRun, {
    fields: [managerEdit.runId],
    references: [scheduleRun.id],
  }),
  variation: one(scheduleVariation, {
    fields: [managerEdit.variationId],
    references: [scheduleVariation.id],
  }),
  staff: one(staff, { fields: [managerEdit.staffId], references: [staff.id] }),
}));

export const preferenceRuleRelations = relations(
  preferenceRule,
  ({ one }) => ({
    business: one(business, {
      fields: [preferenceRule.businessId],
      references: [business.id],
    }),
  }),
);

export const coverRequestRelations = relations(coverRequest, ({ one }) => ({
  scheduleRun: one(scheduleRun, {
    fields: [coverRequest.scheduleRunId],
    references: [scheduleRun.id],
  }),
  requestingStaff: one(staff, {
    fields: [coverRequest.requestingStaffId],
    references: [staff.id],
  }),
}));

export const communicationLogRelations = relations(
  communicationLog,
  ({ one }) => ({
    business: one(business, {
      fields: [communicationLog.businessId],
      references: [business.id],
    }),
    staff: one(staff, {
      fields: [communicationLog.staffId],
      references: [staff.id],
    }),
  }),
);

export const conversationWindowRelations = relations(
  conversationWindow,
  ({ one }) => ({
    staff: one(staff, {
      fields: [conversationWindow.staffId],
      references: [staff.id],
    }),
  }),
);

export const telegramRegistrationRelations = relations(
  telegramRegistration,
  ({ one }) => ({
    business: one(business, {
      fields: [telegramRegistration.businessId],
      references: [business.id],
    }),
  }),
);

export const conversationStateRelations = relations(
  conversationState,
  ({ one }) => ({
    staff: one(staff, {
      fields: [conversationState.staffId],
      references: [staff.id],
    }),
  }),
);

export const knowledgePageRelations = relations(knowledgePage, ({ one }) => ({
  business: one(business, {
    fields: [knowledgePage.businessId],
    references: [business.id],
  }),
}));

export const staffRelationshipRelations = relations(
  staffRelationship,
  ({ one }) => ({
    business: one(business, {
      fields: [staffRelationship.businessId],
      references: [business.id],
    }),
    staff1: one(staff, {
      fields: [staffRelationship.staffId1],
      references: [staff.id],
      relationName: "relationshipStaff1",
    }),
    staff2: one(staff, {
      fields: [staffRelationship.staffId2],
      references: [staff.id],
      relationName: "relationshipStaff2",
    }),
  }),
);

export const coverOfferRelations = relations(coverOffer, ({ one }) => ({
  coverRequest: one(coverRequest, {
    fields: [coverOffer.coverRequestId],
    references: [coverRequest.id],
  }),
  candidateStaff: one(staff, {
    fields: [coverOffer.candidateStaffId],
    references: [staff.id],
  }),
}));

export const staffSkillRelations = relations(staffSkill, ({ one }) => ({
  business: one(business, {
    fields: [staffSkill.businessId],
    references: [business.id],
  }),
  staff: one(staff, {
    fields: [staffSkill.staffId],
    references: [staff.id],
  }),
}));

export const shiftCompositionRuleRelations = relations(
  shiftCompositionRule,
  ({ one }) => ({
    business: one(business, {
      fields: [shiftCompositionRule.businessId],
      references: [business.id],
    }),
  }),
);
