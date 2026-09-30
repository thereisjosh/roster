import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  ...(process.env.NODE_ENV === "development"
    ? { transport: { target: "pino-pretty" } }
    : {}),
});

/**
 * Create a child logger with a module label.
 */
export function createLogger(module: string) {
  return logger.child({ module });
}

export default logger;
