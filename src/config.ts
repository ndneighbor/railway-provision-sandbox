import type { Config } from "./types";

export function loadConfig(): Config {
  const railwayApiToken = process.env.RAILWAY_API_TOKEN;
  if (!railwayApiToken) {
    throw new Error("RAILWAY_API_TOKEN is required");
  }

  const workspaceId = process.env.WORKSPACE_ID;
  if (!workspaceId) {
    throw new Error("WORKSPACE_ID is required");
  }

  return {
    railwayApiToken,
    workspaceId,
    port: Number(process.env.PORT) || 3000,
    logLevel: process.env.LOG_LEVEL || "info",
    webhookSecret: process.env.WEBHOOK_SECRET,
  };
}
