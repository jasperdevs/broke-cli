import { afterEach, describe, expect, it, vi } from "vitest";
import { searchPackageRegistry } from "../src/core/package-search.js";

describe("package registry search", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it("prefers packages with pi/brokecli resource manifests", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/-/v1/search")) {
        return {
          ok: true,
          json: async () => ({
            objects: [
              {
                package: {
                  name: "@demo/plain",
                  version: "1.0.0",
                  description: "plain package",
                },
              },
              {
                package: {
                  name: "@demo/with-pi",
                  version: "2.0.0",
                  description: "resource package",
                },
              },
            ],
          }),
        } as Response;
      }
      if (url.endsWith("%40demo%2Fplain/latest")) {
        return {
          ok: true,
          json: async () => ({
            name: "@demo/plain",
            version: "1.0.1",
            description: "plain package latest",
          }),
        } as Response;
      }
      if (url.endsWith("%40demo%2Fwith-pi/latest")) {
        return {
          ok: true,
          json: async () => ({
            name: "@demo/with-pi",
            version: "2.0.1",
            description: "resource package latest",
            pi: {
              extensions: ["extensions"],
              skills: ["skills"],
            },
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const results = await searchPackageRegistry("demo", 5);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      source: "npm:@demo/with-pi",
      version: "2.0.1",
      resources: {
        extensions: 1,
        skills: 1,
        prompts: 0,
        themes: 0,
      },
    });
    expect(results[1]?.source).toBe("npm:@demo/plain");
  });
});
