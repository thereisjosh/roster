import "server-only";
import { createTRPCContext, createCallerFactory } from "./init";
import { appRouter } from "./router";

const createCaller = createCallerFactory(appRouter);

export async function createServerCaller() {
  const ctx = await createTRPCContext();
  return createCaller(ctx);
}
