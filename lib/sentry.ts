import * as Sentry from "@sentry/nextjs";

let initialized = false;

export function initSentry() {
  if (initialized || !process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    environment: process.env.NODE_ENV ?? "development",
  });
  initialized = true;
}

export function captureError(
  error: unknown,
  context?: Record<string, any>,
): void {
  if (!process.env.SENTRY_DSN) return;
  initSentry();
  Sentry.captureException(error, { extra: context });
}
