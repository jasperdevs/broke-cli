import { afterEach, describe, expect, it } from "vitest";
import { join } from "path";
import { loadExtensions } from "../src/core/extensions.js";
import { getTools } from "../src/tools/registry.js";
import { Session } from "../src/core/session.js";
import { handleSlashCommand } from "../src/cli/slash-commands.js";
import { getSettings, updateSetting } from "../src/core/config.js";
import { createAppStub, createSlashArgs, extDir, mkdirSync, rmSync, writeFileSync } from "./slash-command-test-helpers.js";

describe("extension runtime", () => {
  afterEach(() => {
    updateSetting("discoverExtensions", true);
    updateSetting("extensions", []);
  });

  it("loads extension-contributed tools and slash commands", async () => {
    mkdirSync(extDir, { recursive: true });
    const extensionId = `runtime-extension-${Date.now()}`;
    const extensionPath = join(extDir, `${extensionId}.js`);
    const previousTheme = getSettings().theme;
    writeFileSync(extensionPath, `exports.register = (registry) => {
  registry.registerTools({
    extEcho: {
      description: "extension echo",
      inputSchema: { type: "object", properties: {}, additionalProperties: true },
      execute: async () => ({ ok: true })
    }
  });
  registry.registerSlashCommands([
    {
      names: ["ext-hello"],
      run: ({ app }) => {
        app.setStatus?.("hello from extension");
        return { handled: true };
      }
    }
  ]);
  registry.registerThemes([
    {
      key: "extension-glow",
      label: "Extension Glow",
      dark: true,
      primary: [120, 200, 255],
      secondary: [150, 220, 255],
      dim: [110, 120, 140],
      error: [255, 110, 110],
      warning: [240, 210, 110],
      success: [120, 220, 140],
      background: [10, 14, 20],
      text: [235, 240, 245],
      textMuted: [150, 160, 175],
      border: [70, 80, 100],
      sidebarBorder: [80, 90, 110],
      plan: [240, 210, 110],
      userBubble: [18, 24, 32],
      userText: [245, 248, 250],
      codeBg: [12, 18, 24],
      diffAddBg: [24, 48, 36],
      diffRemoveBg: [68, 28, 32],
      imageTagBg: [120, 200, 255]
    }
  ]);
};`, "utf-8");
    updateSetting("extensions", [extDir]);
    try {
      const hooks = loadExtensions();
      const tools = getTools();
      expect(tools.extEcho).toBeTruthy();
      expect(hooks.getSlashCommands().some((command) => command.names.includes("ext-hello"))).toBe(true);

      const app = createAppStub();
      const result = await handleSlashCommand({
        text: "/ext-hello",
        app,
        session: new Session(`test-ext-command-${Date.now()}`),
        ...createSlashArgs({ hooks }),
      });
      expect(result.handled).toBe(true);
      expect(app.statusMessage).toBe("hello from extension");
    } finally {
      updateSetting("theme", previousTheme);
      rmSync(extensionPath, { force: true });
    }
  });
});
