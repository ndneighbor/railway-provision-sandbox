import { test, expect, describe, mock, beforeEach } from "bun:test";
import { NotificationSetup } from "../src/services/notification-setup";
import type { Config, Logger, NotificationRule } from "../src/types";

function createMockLogger(): Logger {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };
}

const existingRule: NotificationRule = {
  id: "rule-123",
  eventTypes: ["WorkspaceMember.joined"],
  channels: [{ type: "webhook", webhookUrl: "https://my-app.up.railway.app/webhook" }],
};

const recreatedRule: NotificationRule = {
  id: "rule-456",
  eventTypes: ["WorkspaceMember.joined"],
  channels: [{ type: "webhook", webhookUrl: "https://my-app.up.railway.app/webhook" }],
};

function createMockClient() {
  return {
    getNotificationRules: mock(() =>
      Promise.resolve({ notificationRules: [] as NotificationRule[] }),
    ),
    notificationRuleCreate: mock(() =>
      Promise.resolve({ notificationRuleCreate: existingRule }),
    ),
    notificationRuleDelete: mock(() =>
      Promise.resolve({ notificationRuleDelete: true }),
    ),
  };
}

const baseConfig: Config = {
  railwayApiToken: "test-token",
  workspaceId: "ws-123",
  port: 3000,
  logLevel: "info",
  publicDomain: "my-app.up.railway.app",
};

describe("NotificationSetup", () => {
  let client: ReturnType<typeof createMockClient>;
  let logger: Logger;
  let setup: NotificationSetup;

  beforeEach(() => {
    client = createMockClient();
    logger = createMockLogger();
    setup = new NotificationSetup(client as any, baseConfig, logger);
  });

  test("creates rule when none exists", async () => {
    const result = await setup.ensureNotificationRule();

    expect(client.getNotificationRules).toHaveBeenCalledWith("ws-123");
    expect(client.notificationRuleCreate).toHaveBeenCalledWith(
      "ws-123",
      "https://my-app.up.railway.app/webhook",
      undefined,
    );
    expect(client.notificationRuleDelete).not.toHaveBeenCalled();
    expect(result).toEqual(existingRule);
  });

  test("skips creation when matching rule exists and no secret configured", async () => {
    client.getNotificationRules = mock(() =>
      Promise.resolve({ notificationRules: [existingRule] }),
    );

    const result = await setup.ensureNotificationRule();

    expect(client.notificationRuleCreate).not.toHaveBeenCalled();
    expect(client.notificationRuleDelete).not.toHaveBeenCalled();
    expect(result).toEqual(existingRule);
  });

  test("deletes and recreates rule when secret is configured and rule exists", async () => {
    client.getNotificationRules = mock(() =>
      Promise.resolve({ notificationRules: [existingRule] }),
    );
    client.notificationRuleCreate = mock(() =>
      Promise.resolve({ notificationRuleCreate: recreatedRule }),
    );
    const configWithSecret: Config = { ...baseConfig, webhookSecret: "s3cret" };
    setup = new NotificationSetup(client as any, configWithSecret, logger);

    const result = await setup.ensureNotificationRule();

    expect(client.notificationRuleDelete).toHaveBeenCalledWith("rule-123");
    expect(client.notificationRuleCreate).toHaveBeenCalledWith(
      "ws-123",
      "https://my-app.up.railway.app/webhook",
      "s3cret",
    );
    expect(result).toEqual(recreatedRule);
  });

  test("creates rule with secret when no existing rule", async () => {
    const configWithSecret: Config = { ...baseConfig, webhookSecret: "s3cret" };
    setup = new NotificationSetup(client as any, configWithSecret, logger);

    await setup.ensureNotificationRule();

    expect(client.notificationRuleDelete).not.toHaveBeenCalled();
    expect(client.notificationRuleCreate).toHaveBeenCalledWith(
      "ws-123",
      "https://my-app.up.railway.app/webhook",
      "s3cret",
    );
  });

  test("creates rule when existing rules don't match webhook URL", async () => {
    client.getNotificationRules = mock(() =>
      Promise.resolve({
        notificationRules: [
          {
            id: "rule-other",
            eventTypes: ["WorkspaceMember.joined"],
            channels: [{ type: "webhook", webhookUrl: "https://other.app/webhook" }],
          },
        ],
      }),
    );

    const result = await setup.ensureNotificationRule();

    expect(client.notificationRuleDelete).not.toHaveBeenCalled();
    expect(client.notificationRuleCreate).toHaveBeenCalled();
    expect(result).toEqual(existingRule);
  });

  test("creates rule when existing rules don't match event type", async () => {
    client.getNotificationRules = mock(() =>
      Promise.resolve({
        notificationRules: [
          {
            id: "rule-other",
            eventTypes: ["WorkspaceMember.removed"],
            channels: [{ type: "webhook", webhookUrl: "https://my-app.up.railway.app/webhook" }],
          },
        ],
      }),
    );

    const result = await setup.ensureNotificationRule();

    expect(client.notificationRuleDelete).not.toHaveBeenCalled();
    expect(client.notificationRuleCreate).toHaveBeenCalled();
    expect(result).toEqual(existingRule);
  });

  test("returns null when RAILWAY_PUBLIC_DOMAIN is not set", async () => {
    const configWithoutDomain: Config = { ...baseConfig, publicDomain: undefined };
    setup = new NotificationSetup(client as any, configWithoutDomain, logger);

    const result = await setup.ensureNotificationRule();

    expect(result).toBeNull();
    expect(client.getNotificationRules).not.toHaveBeenCalled();
    expect(client.notificationRuleCreate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});
