export interface WebhookPayload {
  type: string;
  details: {
    userId: string;
    email: string;
    role: string;
  };
  resource: {
    workspace: {
      id: string;
      name: string;
    };
  };
  severity?: string;
  timestamp?: string;
}

export type WorkspaceRole = "VIEWER" | "MEMBER" | "ADMIN";

export type ProjectRole = "VIEWER" | "ADMIN";

export interface ProvisioningResult {
  userId: string;
  email: string;
  projectId: string;
  projectName: string;
  workspaceRole: WorkspaceRole;
  projectRole: ProjectRole;
}

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{
    message: string;
    extensions?: Record<string, unknown>;
  }>;
}

export interface Config {
  railwayApiToken: string;
  workspaceId: string;
  port: number;
  logLevel: string;
  webhookSecret?: string;
  publicDomain?: string;
}

export interface NotificationRule {
  id: string;
  eventTypes: string[];
  channelConfigs: Array<{
    type: string;
    webhookUrl?: string;
  }>;
}

export interface Logger {
  debug: (msg: string, data?: Record<string, unknown>) => void;
  info: (msg: string, data?: Record<string, unknown>) => void;
  warn: (msg: string, data?: Record<string, unknown>) => void;
  error: (msg: string, data?: Record<string, unknown>) => void;
}
