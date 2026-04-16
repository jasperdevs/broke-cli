import { describe, expect, it } from "vitest";
import { renderHomeBox, renderHomeView, wrapHomeDetail } from "../src/tui/app-render-methods.js";
import stripAnsi from "strip-ansi";

describe("home summary", () => {
  it("keeps startup focused on a single randomized tip instead of diagnostics", () => {
    const app = {
      modelName: "none",
      modelProviderId: "openai",
      mode: "build",
      modelRuntime: "sdk",
      appVersion: "0.0.1",
      detectedProviders: [],
      homeTip: "Use /update when the banner appears.",
      renderMascotInline: () => [],
      formatShortCwd: () => "~\\repo",
      wrapHomeDetail: (label: string, value: string, width: number) => wrapHomeDetail({} as any, label, value, width),
      padLine(line: string, innerWidth: number) {
        return `${line}${" ".repeat(Math.max(0, innerWidth - stripAnsi(line).length))}`;
      },
    } as any;
    app.renderHomeBox = (width: number, title: string, body: string[]) => renderHomeBox(app, width, title, body);

    const rendered = renderHomeView(app, 90, 18).map((line) => stripAnsi(line)).join("\n");
    expect(rendered).toContain("Tip:");
    expect(rendered).toContain("Use /update when the banner appears.");
    expect(rendered).not.toContain("Providers");
    expect(rendered).not.toContain("Workspace");
    expect(rendered).not.toContain("Status");
  });
});
