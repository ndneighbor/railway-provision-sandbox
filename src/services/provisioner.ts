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

    // Step 1: Set member to VIEWER
    this.logger.info("Setting workspace member to VIEWER", { userId });
    await this.client.workspaceMemberUpdate(workspaceId, userId, "VIEWER");

    // Step 2: Create project for user
    const projectName = this.deriveProjectName(email);
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

    // Step 3: Grant user ADMIN on project
    this.logger.info("Granting ADMIN on project", { userId, projectId });
    await this.client.projectMemberUpdate(projectId, userId, "ADMIN");

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

  deriveProjectName(email: string): string {
    const prefix = email.split("@")[0];
    return prefix
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  private isDuplicateProjectError(err: RailwayAPIError): boolean {
    const msg = err.message.toLowerCase();
    return msg.includes("duplicate") || msg.includes("already exists") || msg.includes("unique");
  }

  private async findExistingProject(name: string, workspaceId: string): Promise<string> {
    const gql = `
      query projects($workspaceId: String!) {
        workspace(id: $workspaceId) {
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
