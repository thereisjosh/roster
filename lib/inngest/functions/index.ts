// Inngest function registry — all functions are registered here and served via /api/inngest.

import type { InngestFunction } from "inngest";
import { processCoverRequest } from "./process-cover-request";
import { sendReminders } from "./send-reminders";
import { extractPreferences } from "./extract-preferences";
import { minePatterns } from "./mine-patterns";
import { lintKnowledge } from "./lint-knowledge";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const functions: InngestFunction.Any[] = [
  processCoverRequest,
  sendReminders,
  extractPreferences,
  minePatterns,
  lintKnowledge,
];
