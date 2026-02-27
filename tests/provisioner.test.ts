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
    projectCreate: mock(() =>
      Promise.resolve({ projectCreate: { id: "proj-123", name: "john-doe" } }),
    ),
    projectMemberAdd: mock(() => Promise.resolve({ projectMemberAdd: { id: "pm-1", email: "john.doe@example.com", role: "ADMIN" } })),
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

    expect(client.projectCreate).toHaveBeenCalledWith("john-doe-user-1", "ws-123");
    expect(client.projectMemberAdd).toHaveBeenCalledWith("proj-123", "user-1", "ADMIN");

    expect(result).toEqual({
      userId: "user-1",
      email: "john.doe@example.com",
      projectId: "proj-123",
      projectName: "john-doe-user-1",
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
            edges: [{ node: { id: "existing-proj", name: "john-doe-user-1" } }],
          },
        },
      }),
    );

    const result = await provisioner.provision("user-1", "john.doe@example.com", "ws-123");

    expect(result.projectId).toBe("existing-proj");
    expect(client.projectMemberAdd).toHaveBeenCalledWith("existing-proj", "user-1", "ADMIN");
  });

  test("throws on non-duplicate project creation errors", async () => {
    client.projectCreate = mock(() => {
      throw new RailwayAPIError("Unauthorized", 403);
    });

    await expect(
      provisioner.provision("user-1", "john.doe@example.com", "ws-123"),
    ).rejects.toThrow("Unauthorized");
  });

  test("handles replay when user already a project member", async () => {
    client.projectMemberAdd = mock(() => {
      throw new RailwayAPIError("Member already exists");
    });

    const result = await provisioner.provision("user-1", "john.doe@example.com", "ws-123");

    expect(result.projectId).toBe("proj-123");
  });

  describe("deriveProjectName", () => {
    test("simple email", () => {
      expect(provisioner.deriveProjectName("john@example.com", "abc123")).toBe("john-abc123");
    });

    test("dotted email", () => {
      expect(provisioner.deriveProjectName("john.doe@example.com", "abc123")).toBe("john-doe-abc123");
    });

    test("email with special characters", () => {
      expect(provisioner.deriveProjectName("John_Doe+test@example.com", "abc123")).toBe("john-doe-test-abc123");
    });

    test("email with consecutive special chars", () => {
      expect(provisioner.deriveProjectName("john..doe@example.com", "abc123")).toBe("john-doe-abc123");
    });

    test("email with leading/trailing special chars", () => {
      expect(provisioner.deriveProjectName(".john.@example.com", "abc123")).toBe("john-abc123");
    });

    test("uses last 6 chars of userId as suffix", () => {
      expect(provisioner.deriveProjectName("john@example.com", "user-abcdef123456")).toBe("john-123456");
    });
  });
});
