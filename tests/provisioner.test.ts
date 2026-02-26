import { test, expect, describe, mock, beforeEach } from "bun:test";
import { Provisioner } from "../src/services/provisioner";
import { RailwayAPIError } from "../src/railway-client";
import type { Config, Logger } from "../src/types";

function createMockLogger(): Logger {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };
}

function createMockClient() {
  return {
    workspaceMemberUpdate: mock(() => Promise.resolve({ workspaceMemberUpdate: true })),
    projectCreate: mock(() =>
      Promise.resolve({ projectCreate: { id: "proj-123", name: "john-doe" } }),
    ),
    projectMemberUpdate: mock(() => Promise.resolve({ projectMemberUpdate: true })),
    query: mock(() => Promise.resolve({})),
  };
}

const mockConfig: Config = {
  railwayApiToken: "test-token",
  workspaceId: "ws-123",
  port: 3000,
  logLevel: "info",
};

describe("Provisioner", () => {
  let client: ReturnType<typeof createMockClient>;
  let logger: Logger;
  let provisioner: Provisioner;

  beforeEach(() => {
    client = createMockClient();
    logger = createMockLogger();
    provisioner = new Provisioner(client as any, mockConfig, logger);
  });

  test("full provisioning workflow succeeds", async () => {
    const result = await provisioner.provision("user-1", "john.doe@example.com", "ws-123");

    expect(client.workspaceMemberUpdate).toHaveBeenCalledWith("ws-123", "user-1", "VIEWER");
    expect(client.projectCreate).toHaveBeenCalledWith("john-doe", "ws-123");
    expect(client.projectMemberUpdate).toHaveBeenCalledWith("proj-123", "user-1", "ADMIN");

    expect(result).toEqual({
      userId: "user-1",
      email: "john.doe@example.com",
      projectId: "proj-123",
      projectName: "john-doe",
      workspaceRole: "VIEWER",
      projectRole: "ADMIN",
    });
  });

  test("handles duplicate project by looking up existing", async () => {
    client.projectCreate = mock(() => {
      throw new RailwayAPIError("Project name already exists");
    });
    client.query = mock(() =>
      Promise.resolve({
        workspace: {
          projects: {
            edges: [{ node: { id: "existing-proj", name: "john-doe" } }],
          },
        },
      }),
    );

    const result = await provisioner.provision("user-1", "john.doe@example.com", "ws-123");

    expect(result.projectId).toBe("existing-proj");
    expect(client.projectMemberUpdate).toHaveBeenCalledWith("existing-proj", "user-1", "ADMIN");
  });

  test("throws on non-duplicate project creation errors", async () => {
    client.projectCreate = mock(() => {
      throw new RailwayAPIError("Unauthorized", 403);
    });

    await expect(
      provisioner.provision("user-1", "john.doe@example.com", "ws-123"),
    ).rejects.toThrow("Unauthorized");
  });

  describe("deriveProjectName", () => {
    test("simple email", () => {
      expect(provisioner.deriveProjectName("john@example.com")).toBe("john");
    });

    test("dotted email", () => {
      expect(provisioner.deriveProjectName("john.doe@example.com")).toBe("john-doe");
    });

    test("email with special characters", () => {
      expect(provisioner.deriveProjectName("John_Doe+test@example.com")).toBe("john-doe-test");
    });

    test("email with consecutive special chars", () => {
      expect(provisioner.deriveProjectName("john..doe@example.com")).toBe("john-doe");
    });

    test("email with leading/trailing special chars", () => {
      expect(provisioner.deriveProjectName(".john.@example.com")).toBe("john");
    });
  });
});
