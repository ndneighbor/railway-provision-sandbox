import type { GraphQLResponse, Logger, NotificationRule, ProjectRole } from "./types";

export class RailwayAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public graphqlErrors?: Array<{ message: string; extensions?: Record<string, unknown> }>,
  ) {
    super(message);
    this.name = "RailwayAPIError";
  }
}

const API_URL = "https://backboard.railway.com/graphql/v2";
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 5000;

export class RailwayClient {
  constructor(
    private apiToken: string,
    private logger: Logger,
  ) {}

  async query<T>(gql: string, variables?: Record<string, unknown>): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
        this.logger.warn("Retrying Railway API request", { attempt, delay });
        await Bun.sleep(delay);
      }

      try {
        const response = await fetch(API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiToken}`,
          },
          body: JSON.stringify({ query: gql, variables }),
        });

        if (response.status === 429 || response.status >= 500) {
          lastError = new RailwayAPIError(
            `Railway API returned ${response.status}`,
            response.status,
          );
          continue;
        }

        if (!response.ok) {
          const body = await response.text();
          throw new RailwayAPIError(
            `Railway API error: ${response.status} ${body}`,
            response.status,
          );
        }

        const json = (await response.json()) as GraphQLResponse<T>;

        if (json.errors?.length) {
          throw new RailwayAPIError(
            `GraphQL error: ${json.errors[0].message}`,
            undefined,
            json.errors,
          );
        }

        return json.data as T;
      } catch (err) {
        if (err instanceof RailwayAPIError && err.statusCode !== 429 && (err.statusCode ?? 0) < 500) {
          throw err;
        }
        lastError = err as Error;
      }
    }

    throw lastError ?? new RailwayAPIError("Railway API request failed after retries");
  }

  async getWorkspaceMembers(workspaceId: string) {
    const gql = `
      query workspaceMembers($workspaceId: String!) {
        workspace(workspaceId: $workspaceId) {
          members {
            edges {
              node {
                id
                role
                user {
                  id
                  email
                }
              }
            }
          }
        }
      }
    `;
    return this.query<{
      workspace: {
        members: {
          edges: Array<{
            node: {
              id: string;
              role: string;
              user: { id: string; email: string };
            };
          }>;
        };
      };
    }>(gql, { workspaceId });
  }

  async projectCreate(name: string, workspaceId: string) {
    const gql = `
      mutation projectCreate($input: ProjectCreateInput!) {
        projectCreate(input: $input) {
          id
          name
        }
      }
    `;
    return this.query<{ projectCreate: { id: string; name: string } }>(gql, {
      input: { name, workspaceId },
    });
  }

  async projectMemberAdd(projectId: string, userId: string, role: ProjectRole) {
    const gql = `
      mutation projectMemberAdd($input: ProjectMemberAddInput!) {
        projectMemberAdd(input: $input) {
          id
          email
          role
        }
      }
    `;
    return this.query<{ projectMemberAdd: { id: string; email: string; role: string } }>(gql, {
      input: { projectId, userId, role },
    });
  }

  async getNotificationRules(workspaceId: string) {
    const gql = `
      query notificationRules($workspaceId: String!) {
        notificationRules(workspaceId: $workspaceId) {
          id
          eventTypes
          channelConfigs {
            type
            webhookUrl
          }
        }
      }
    `;
    return this.query<{ notificationRules: NotificationRule[] }>(gql, { workspaceId });
  }

  async notificationRuleCreate(workspaceId: string, webhookUrl: string) {
    const gql = `
      mutation notificationRuleCreate($input: NotificationRuleCreateInput!) {
        notificationRuleCreate(input: $input) {
          id
          eventTypes
          channelConfigs {
            type
            webhookUrl
          }
        }
      }
    `;
    return this.query<{ notificationRuleCreate: NotificationRule }>(gql, {
      input: {
        workspaceId,
        eventTypes: ["WorkspaceMember.joined"],
        channelConfigs: [{ type: "webhook", webhookUrl }],
      },
    });
  }
}
