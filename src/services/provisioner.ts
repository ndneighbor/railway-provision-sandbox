import type { Config, Logger, ProvisioningResult } from "../types";
import type { RailwayClient } from "../railway-client";
import { RailwayAPIError } from "../railway-client";

export class Provisioner {
  constructor(
    private client: RailwayClient,
    private config: Config,
    private logger: Logger,
  ) {}

  async provision(userId: string, email: string, workspaceId: string): Promise<ProvisioningResult> {
    this.logger.info("Starting provisioning", { userId, email, workspaceId });

    // Step 1: Create project for user
    const projectName = this.deriveProjectName(email, userId);
    this.logger.info("Creating project", { projectName });

    let projectId: string;
    try {
      const result = await this.client.projectCreate(projectName, workspaceId);
      projectId = result.projectCreate.id;
    } catch (err) {
      if (err instanceof RailwayAPIError && this.isDuplicateProjectError(err)) {
        this.logger.warn("Project already exists, looking up existing", { projectName });
        projectId = await this.findExistingProject(projectName, workspaceId);
      } else {
        throw err;
      }
    }

    // Step 2: Grant user ADMIN on project
    this.logger.info("Granting ADMIN on project", { userId, projectId });
    try {
      await this.client.projectMemberAdd(projectId, userId, "ADMIN");
    } catch (err) {
      if (err instanceof RailwayAPIError && this.isMemberAlreadyExistsError(err)) {
        this.logger.warn("User already a project member, skipping add", { userId, projectId });
      } else {
        throw err;
      }
    }

    const result: ProvisioningResult = {
      userId,
      email,
      projectId,
      projectName,
      workspaceRole: "VIEWER",
      projectRole: "ADMIN",
    };

    this.logger.info("Provisioning complete", { ...result });
    return result;
  }

  deriveProjectName(email: string, userId: string): string {
    const prefix = email.split("@")[0];
    const sanitized = prefix
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    const suffix = userId.slice(-6);
    return `${sanitized}-${suffix}`;
  }

  private isDuplicateProjectError(err: RailwayAPIError): boolean {
    const msg = err.message.toLowerCase();
    return msg.includes("duplicate") || msg.includes("already exists") || msg.includes("unique");
  }

  private isMemberAlreadyExistsError(err: RailwayAPIError): boolean {
    const msg = err.message.toLowerCase();
    return msg.includes("already") || msg.includes("exists") || msg.includes("duplicate");
  }

  private async findExistingProject(name: string, workspaceId: string): Promise<string> {
    const gql = `
      query projects($workspaceId: String!) {
        workspace(workspaceId: $workspaceId) {
          projects {
            edges {
              node {
                id
                name
              }
            }
          }
        }
      }
    `;
    const result = await (this.client as any).query(gql, { workspaceId });
    const project = result.workspace.projects.edges.find(
      (e: { node: { name: string } }) => e.node.name === name,
    );
    if (!project) {
      throw new Error(`Could not find existing project with name: ${name}`);
    }
    return project.node.id;
  }
}
