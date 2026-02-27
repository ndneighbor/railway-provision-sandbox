import { test, expect, describe, mock, beforeEach } from "bun:test";
import { WebhookHandler } from "../src/handlers/webhook";
import type { Config, Logger, ProvisioningResult } from "../src/types";

function createMockLogger(): Logger {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };
}

const mockResult: ProvisioningResult = {
  userId: "user-1",
  email: "john@example.com",
  projectId: "proj-123",
  projectName: "john",
  workspaceRole: "VIEWER",
  projectRole: "ADMIN",
};

function createMockProvisioner() {
  return {
    provision: mock(() => Promise.resolve(mockResult)),
  };
}

const mockConfig: Config = {
  railwayApiToken: "test-token",
  workspaceId: "ws-123",
  port: 3000,
  logLevel: "info",
};

function validPayload(overrides?: Record<string, unknown>) {
  return {
    type: "WorkspaceMember.joined",
    details: {
      userId: "user-1",
      email: "john@example.com",
      role: "VIEWER",
    },
    resource: {
      workspace: {
        id: "ws-123",
        name: "Test Workspace",
      },
    },
    severity: "INFO",
    timestamp: "2026-02-27T06:38:35.493Z",
    ...overrides,
  };
}

describe("WebhookHandler", () => {
  let provisioner: ReturnType<typeof createMockProvisioner>;
  let logger: Logger;
  let handler: WebhookHandler;

  beforeEach(() => {
    provisioner = createMockProvisioner();
    logger = createMockLogger();
    handler = new WebhookHandler(provisioner as any, mockConfig, logger);
  });

  test("handles valid WorkspaceMember.joined event", async () => {
    const req = new Request("http://localhost/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validPayload()),
    });

    const res = await handler.handleWebhook(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe("provisioned");
    expect(json.projectId).toBe("proj-123");
    expect(provisioner.provision).toHaveBeenCalledWith("user-1", "john@example.com", "ws-123");
  });

  test("ignores non-join events", async () => {
    const req = new Request("http://localhost/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validPayload({ type: "WorkspaceMember.removed" })),
    });

    const res = await handler.handleWebhook(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe("ignored");
    expect(provisioner.provision).not.toHaveBeenCalled();
  });

  test("rejects invalid JSON", async () => {
    const req = new Request("http://localhost/webhook", {
      method: "POST",
      body: "not json",
    });

    const res = await handler.handleWebhook(req);
    expect(res.status).toBe(400);
  });

  test("rejects missing payload fields", async () => {
    const req = new Request("http://localhost/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "WorkspaceMember.joined" }),
    });

    const res = await handler.handleWebhook(req);
    expect(res.status).toBe(400);
  });

  test("rejects payload missing resource.workspace", async () => {
    const req = new Request("http://localhost/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "WorkspaceMember.joined",
        details: { userId: "u1", email: "a@b.com", role: "VIEWER" },
      }),
    });

    const res = await handler.handleWebhook(req);
    expect(res.status).toBe(400);
  });

  test("rejects invalid payload details", async () => {
    const req = new Request("http://localhost/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "WorkspaceMember.joined",
        details: { userId: 123 },
        resource: { workspace: { id: "ws-1", name: "Test" } },
      }),
    });

    const res = await handler.handleWebhook(req);
    expect(res.status).toBe(400);
  });

  test("returns 500 when provisioning fails", async () => {
    provisioner.provision = mock(() => Promise.reject(new Error("API down")));

    const req = new Request("http://localhost/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validPayload()),
    });

    const res = await handler.handleWebhook(req);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe("Provisioning failed");
  });

  describe("signature verification", () => {
    test("rejects invalid signature when secret is configured", async () => {
      const configWithSecret: Config = { ...mockConfig, webhookSecret: "my-secret" };
      handler = new WebhookHandler(provisioner as any, configWithSecret, logger);

      const req = new Request("http://localhost/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-signature": "invalid-sig",
        },
        body: JSON.stringify(validPayload()),
      });

      const res = await handler.handleWebhook(req);
      expect(res.status).toBe(401);
    });

    test("accepts valid signature", async () => {
      const secret = "my-secret";
      const configWithSecret: Config = { ...mockConfig, webhookSecret: secret };
      handler = new WebhookHandler(provisioner as any, configWithSecret, logger);

      const body = JSON.stringify(validPayload());

      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
      const signature = Buffer.from(sig).toString("hex");

      const req = new Request("http://localhost/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-signature": signature,
        },
        body,
      });

      const res = await handler.handleWebhook(req);
      expect(res.status).toBe(200);
    });
  });

  describe("validatePayload", () => {
    test("accepts valid payload", () => {
      expect(handler.validatePayload(validPayload())).toBe(true);
    });

    test("rejects null", () => {
      expect(handler.validatePayload(null)).toBe(false);
    });

    test("rejects missing type", () => {
      const { type, ...rest } = validPayload();
      expect(handler.validatePayload(rest)).toBe(false);
    });

    test("rejects missing details", () => {
      expect(handler.validatePayload({ type: "test", resource: { workspace: { id: "ws-1", name: "T" } } })).toBe(false);
    });

    test("rejects missing resource", () => {
      expect(handler.validatePayload({ type: "test", details: { userId: "u1", email: "a@b.com" } })).toBe(false);
    });
  });
});
