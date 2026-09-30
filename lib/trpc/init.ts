import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { getServerSession } from "@/lib/auth/get-session";

export interface TRPCContext {
  session: Awaited<ReturnType<typeof getServerSession>>;
}

export async function createTRPCContext(): Promise<TRPCContext> {
  const session = await getServerSession();
  return { session };
}

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
});

export const createRouter = t.router;
export const createCallerFactory = t.createCallerFactory;

// ---------------------------------------------------------------------------
// Procedures
// ---------------------------------------------------------------------------

/** No auth required */
export const publicProcedure = t.procedure;

/** Valid session required */
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      session: ctx.session,
      user: ctx.session.user,
    },
  });
});

/** Session + businessId on user required — injects ctx.businessId */
export const businessProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  const businessId = (ctx.session.user as Record<string, unknown>).businessId as string | undefined;
  if (!businessId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "User is not associated with a business",
    });
  }
  return next({
    ctx: {
      session: ctx.session,
      user: ctx.session.user,
      businessId,
    },
  });
});
