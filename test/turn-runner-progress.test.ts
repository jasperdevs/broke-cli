import { describe, expect, it } from "vitest";
import { buildTouchedFilesEvidence } from "../src/cli/turn-runner.js";

describe("turn runner progress helpers", () => {
  it("formats compact changed-file evidence for opaque edit turns", () => {
    expect(buildTouchedFilesEvidence(["index.html"])).toBe("Changed files: index.html");
    expect(buildTouchedFilesEvidence(["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"])).toBe("Changed files: a.ts, b.ts, c.ts, d.ts (+1 more)");
    expect(buildTouchedFilesEvidence([])).toBeNull();
  });
});
