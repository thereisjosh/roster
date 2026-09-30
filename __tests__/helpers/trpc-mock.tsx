import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";

/**
 * Module-level mock helper for tRPC in component tests.
 *
 * Usage:
 *   vi.mock("@/lib/trpc/client", () => mockTRPC);
 *   // then in each test, configure return values via the mock objects below.
 */

// Shared mutation state that tests can inspect/control
export function createMutationMock() {
  const mutate = vi.fn();
  return {
    mutate,
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    data: undefined,
    reset: vi.fn(),
  };
}

export function createQueryMock(data: unknown = undefined) {
  return {
    data,
    isLoading: !data,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

/**
 * Creates a wrapper component with QueryClientProvider for rendering hooks
 * that depend on React Query.
 */
export function createQueryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}
