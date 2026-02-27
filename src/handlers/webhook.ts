import type { Config, Logger, WebhookPayload } from "../types";
import type { Provisioner } from "../services/provisioner";

export class WebhookHandler {
  constructor(
    private provisioner: Provisioner,
    private config: Config,
    private logger: Logger,
  ) {}

  async handleWebhook(req: Request): Promise<Response> {
    const rawBody = await req.text();
    let body: unknown;

    try {
      body = JSON.parse(rawBody);
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if (this.config.webhookSecret) {
      const isValid = await this.verifySignature(req, rawBody);
      if (!isValid) {
        this.logger.warn("Invalid webhook signature");
        return Response.json({ error: "Invalid signature" }, { status: 401 });
      }
    }

    if (!this.validatePayload(body)) {
      this.logger.warn("Invalid webhook payload", { body: body as Record<string, unknown> });
      return Response.json({ error: "Invalid payload" }, { status: 400 });
    }

    const payload = body as WebhookPayload;

    if (payload.type !== "WorkspaceMember.joined") {
      this.logger.debug("Ignoring non-join event", { type: payload.type });
      return Response.json({ status: "ignored", type: payload.type });
    }

    try {
      const result = await this.provisioner.provision(
        payload.details.userId,
        payload.details.email,
        payload.resource.workspace.id,
      );
      return Response.json({ status: "provisioned", ...result });
    } catch (err) {
      this.logger.error("Provisioning failed", {
        error: (err as Error).message,
        userId: payload.details.userId,
      });
      return Response.json(
        { error: "Provisioning failed", message: (err as Error).message },
        { status: 500 },
      );
    }
  }

  async verifySignature(req: Request, rawBody: string): Promise<boolean> {
    const signature = req.headers.get("x-webhook-signature");
    if (!signature || !this.config.webhookSecret) return false;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(this.config.webhookSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
    const expected = Buffer.from(sig).toString("hex");
    return signature === expected;
  }

  validatePayload(body: unknown): body is WebhookPayload {
    if (typeof body !== "object" || body === null) return false;
    const obj = body as Record<string, unknown>;
    if (typeof obj.type !== "string") return false;
    if (typeof obj.details !== "object" || obj.details === null) return false;
    const details = obj.details as Record<string, unknown>;
    if (typeof details.userId !== "string" || typeof details.email !== "string") return false;
    if (typeof obj.resource !== "object" || obj.resource === null) return false;
    const resource = obj.resource as Record<string, unknown>;
    if (typeof resource.workspace !== "object" || resource.workspace === null) return false;
    const workspace = resource.workspace as Record<string, unknown>;
    return typeof workspace.id === "string";
  }
}
