import type { Config, Logger, NotificationRule } from "../types";
import type { RailwayClient } from "../railway-client";

export class NotificationSetup {
  constructor(
    private client: RailwayClient,
    private config: Config,
    private logger: Logger,
  ) {}

  async ensureNotificationRule(): Promise<NotificationRule | null> {
    if (!this.config.publicDomain) {
      this.logger.warn(
        "RAILWAY_PUBLIC_DOMAIN not set, skipping notification rule setup",
      );
      return null;
    }

    const webhookUrl = `https://${this.config.publicDomain}/webhook`;

    const existing = await this.findExistingRule(webhookUrl);
    if (existing) {
      this.logger.info("Notification rule already exists", {
        ruleId: existing.id,
        webhookUrl,
      });
      return existing;
    }

    this.logger.info("Creating notification rule", { webhookUrl });
    const result = await this.client.notificationRuleCreate(
      this.config.workspaceId,
      webhookUrl,
    );
    this.logger.info("Notification rule created", {
      ruleId: result.notificationRuleCreate.id,
    });
    return result.notificationRuleCreate;
  }

  private async findExistingRule(
    webhookUrl: string,
  ): Promise<NotificationRule | null> {
    const result = await this.client.getNotificationRules(
      this.config.workspaceId,
    );
    const rules = result.notificationRules;

    return (
      rules.find(
        (rule) =>
          rule.eventTypes.includes("WorkspaceMember.joined") &&
          rule.channelConfigs.some(
            (ch) => ch.type === "webhook" && ch.webhookUrl === webhookUrl,
          ),
      ) ?? null
    );
  }
}
