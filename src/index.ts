import { loadConfig } from "./config";
import { createLogger } from "./logger";
import { RailwayClient } from "./railway-client";
import { Provisioner } from "./services/provisioner";
import { WebhookHandler } from "./handlers/webhook";

const config = loadConfig();
const logger = createLogger(config.logLevel);
const client = new RailwayClient(config.railwayApiToken, logger);
const provisioner = new Provisioner(client, config, logger);
const webhookHandler = new WebhookHandler(provisioner, config, logger);

const server = Bun.serve({
  port: config.port,
  routes: {
    "/": new Response("railway-provision-sandbox"),
    "/health": Response.json({ status: "healthy" }),
    "/webhook": {
      POST: (req) => webhookHandler.handleWebhook(req),
    },
  },
  fetch(req) {
    return new Response("Not Found", { status: 404 });
  },
});

logger.info("Server started", { port: server.port });

process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down");
  server.stop();
  process.exit(0);
});
