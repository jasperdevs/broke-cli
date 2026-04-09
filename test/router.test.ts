import { describe, expect, it } from "vitest";
import { routeMessage } from "../src/ai/router.js";

describe("auto routing", () => {
  it("routes first-turn simple repo reads to the small lane", () => {
    expect(routeMessage("read package.json", 1, [])).toBe("small");
    expect(routeMessage("which file defines parseConfig?", 1, [])).toBe("small");
  });

  it("keeps first-turn edits and bugfixes on the main lane", () => {
    expect(routeMessage("fix the sidebar wrapping bug", 1, [])).toBe("main");
    expect(routeMessage("make index.html feel polished", 1, [])).toBe("main");
  });
});
