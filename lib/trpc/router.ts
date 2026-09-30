import { createRouter } from "./init";
import { businessRouter } from "./routers/business";
import { staffRouter } from "./routers/staff";
import { scheduleRouter } from "./routers/schedule";
import { availabilityRouter } from "./routers/availability";
import { coverRouter } from "./routers/cover";
import { preferencesRouter } from "./routers/preferences";
import { dashboardRouter } from "./routers/dashboard";
import { knowledgeRouter } from "./routers/knowledge";

export const appRouter = createRouter({
  business: businessRouter,
  staff: staffRouter,
  schedule: scheduleRouter,
  availability: availabilityRouter,
  cover: coverRouter,
  preferences: preferencesRouter,
  dashboard: dashboardRouter,
  knowledge: knowledgeRouter,
});

export type AppRouter = typeof appRouter;
