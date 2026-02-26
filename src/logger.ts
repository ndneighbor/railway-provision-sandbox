import type { Logger } from "./types";

const LEVELS: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function createLogger(level: string = "info"): Logger {
  const threshold = LEVELS[level] ?? 1;

  function log(
    lvl: string,
    msg: string,
    data?: Record<string, unknown>,
  ): void {
    if ((LEVELS[lvl] ?? 0) < threshold) return;
    const entry = {
      timestamp: new Date().toISOString(),
      level: lvl,
      msg,
      ...data,
    };
    console.log(JSON.stringify(entry));
  }

  return {
    debug: (msg, data) => log("debug", msg, data),
    info: (msg, data) => log("info", msg, data),
    warn: (msg, data) => log("warn", msg, data),
    error: (msg, data) => log("error", msg, data),
  };
}
