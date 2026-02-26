import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import { RailwayClient, RailwayAPIError } from "../src/railway-client";
import type { Logger } from "../src/types";

function createMockLogger(): Logger {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };
}

describe("RailwayClient", () => {
  let logger: Logger;
  let client: RailwayClient;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    logger = createMockLogger();
    client = new RailwayClient("test-token", logger);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("sends correct headers and body", async () => {
    let capturedRequest: { headers: Headers; body: string } | undefined;

    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      capturedRequest = {
        headers: new Headers(init?.headers),
        body: init?.body as string,
      };
      return new Response(
        JSON.stringify({ data: { test: true } }),
        { headers: { "Content-Type": "application/json" } },
      );
    }) as any;

    await client.query("query { test }", { id: "123" });

    expect(capturedRequest!.headers.get("Authorization")).toBe("Bearer test-token");
    expect(capturedRequest!.headers.get("Content-Type")).toBe("application/json");

    const body = JSON.parse(capturedRequest!.body);
    expect(body.query).toBe("query { test }");
    expect(body.variables).toEqual({ id: "123" });
  });

  test("returns data on success", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({ data: { projectCreate: { id: "p-1", name: "test" } } }),
        { headers: { "Content-Type": "application/json" } },
      ),
    ) as any;

    const result = await client.query<{ projectCreate: { id: string } }>("mutation { test }");
    expect(result.projectCreate.id).toBe("p-1");
  });

  test("throws on GraphQL errors", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({ errors: [{ message: "Not found" }] }),
        { headers: { "Content-Type": "application/json" } },
      ),
    ) as any;

    await expect(client.query("query { test }")).rejects.toThrow("GraphQL error: Not found");
  });

  test("throws on non-retryable HTTP errors", async () => {
    globalThis.fetch = mock(async () =>
      new Response("Forbidden", { status: 403 }),
    ) as any;

    await expect(client.query("query { test }")).rejects.toThrow("Railway API error: 403");
  });

  test("retries on 429 and eventually succeeds", async () => {
    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      if (callCount <= 2) {
        return new Response("Too Many Requests", { status: 429 });
      }
      return new Response(
        JSON.stringify({ data: { ok: true } }),
        { headers: { "Content-Type": "application/json" } },
      );
    }) as any;

    const result = await client.query<{ ok: boolean }>("query { test }");
    expect(result.ok).toBe(true);
    expect(callCount).toBe(3);
  });

  test("retries on 500 and eventually succeeds", async () => {
    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response("Internal Server Error", { status: 500 });
      }
      return new Response(
        JSON.stringify({ data: { ok: true } }),
        { headers: { "Content-Type": "application/json" } },
      );
    }) as any;

    const result = await client.query<{ ok: boolean }>("query { test }");
    expect(result.ok).toBe(true);
    expect(callCount).toBe(2);
  });

  test("throws after exhausting retries", async () => {
    globalThis.fetch = mock(async () =>
      new Response("Service Unavailable", { status: 503 }),
    ) as any;

    await expect(client.query("query { test }")).rejects.toThrow();
  });

  test("projectCreate sends correct input", async () => {
    let capturedBody: any;
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({ data: { projectCreate: { id: "p-1", name: "test" } } }),
        { headers: { "Content-Type": "application/json" } },
      );
    }) as any;

    await client.projectCreate("my-project", "ws-123");
    expect(capturedBody.variables.input).toEqual({
      name: "my-project",
      teamId: "ws-123",
    });
  });
});
