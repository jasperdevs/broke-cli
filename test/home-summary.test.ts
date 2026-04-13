import { afterEach, describe, expect, it, vi } from "vitest";
import * as extensions from "../src/core/extensions.js";
import * as skills from "../src/core/skills.js";
import * as templates from "../src/core/templates.js";
import * as packageManager from "../src/core/package-manager.js";
import { renderHomeBox, renderHomeView, wrapHomeDetail } from "../src/tui/app-render-methods.js";
import stripAnsi from "strip-ansi";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("home summary", () => {
  it("surfaces broken enabled extensions in the workspace summary", () => {
    vi.spyOn(extensions, "listExtensions").mockReturnValue([
      { id: "ok", enabled: true, loaded: true },
      { id: "broken", enabled: true, loaded: false, error: "boom" },
    ] as any);
    vi.spyOn(skills, "listSkills").mockReturnValue([]);
    vi.spyOn(templates, "listTemplates").mockReturnValue([]);
    vi.spyOn(packageManager, "listInstalledPackages").mockReturnValue([]);

    const app = {
      modelName: "none",
      modelProviderId: "openai",
      mode: "build",
      modelRuntime: "sdk",
      appVersion: "0.0.1",
      detectedProviders: [],
      renderMascotInline: () => [],
      formatShortCwd: () => "~\\repo",
      wrapHomeDetail: (label: string, value: string, width: number) => wrapHomeDetail({} as any, label, value, width),
      padLine(line: string, innerWidth: number) {
        return `${line}${" ".repeat(Math.max(0, innerWidth - stripAnsi(line).length))}`;
      },
    } as any;
    app.renderHomeBox = (width: number, title: string, body: string[]) => renderHomeBox(app, width, title, body);

    const rendered = renderHomeView(app, 90, 18).map((line) => stripAnsi(line)).join("\n");
    expect(rendered).toContain("2 ext · 1 broken");
  });
});
