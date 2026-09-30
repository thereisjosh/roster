"use client";

import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "./router";

export const trpc: ReturnType<typeof createTRPCReact<AppRouter>> =
  createTRPCReact<AppRouter>();
