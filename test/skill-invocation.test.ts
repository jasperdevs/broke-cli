import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { clearRuntimeSettings, setRuntimeSettings } from "../src/core/config.js";
import { expandInlineSkillInvocations, expandSkillInvocation } from "../src/core/skills.js";
import { addUserTurnToSession } from "../src/cli/turn-runner-stages.js";
import { Session } from "../src/core/session.js";

const workspaces: string[] = [];

async function makeSkill(name: string, body = "Do the skill thing."): Promise<{ root: string; skillPath: string }> {
  const root = await mkdtemp(join(tmpdir(), "brokecli-skill-"));
  workspaces.push(root);
  const skillDir = join(root, name);
  await import("fs/promises").then(({ mkdir }) => mkdir(skillDir, { recursive: true }));
  const skillPath = join(skillDir, "SKILL.md");
  await writeFile(skillPath, `---\nname: ${name}\ndescription: ${name} skill\n---\n\n${body}\n`, "utf8");
  return { root, skillPath };
}

afterEach(async () => {
  clearRuntimeSettings();
  await Promise.all(workspaces.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("skill invocation", () => {
  it("expands $skill args to the same XML skill block shape as Pi", async () => {
    const { root, skillPath } = await makeSkill("deslop", "Clean up noisy generated prose.");
    setRuntimeSettings({ skills: [root], discoverSkills: false });

    const expanded = expandSkillInvocation("$deslop src/app.ts");

    expect(expanded.skillName).toBe("deslop");
    expect(expanded.expandedText).toContain(`<skill name="deslop" location="${skillPath}">`);
    expect(expanded.expandedText).toContain("References are relative to ");
    expect(expanded.expandedText).toContain("Clean up noisy generated prose.");
    expect(expanded.expandedText).toContain("</skill>\n\nsrc/app.ts");
  });

  it("stores expanded skill text in model/session context while keeping the visible user message unchanged", async () => {
    const { root, skillPath } = await makeSkill("writer");
    setRuntimeSettings({ skills: [root], discoverSkills: false });
    const appMessages: Array<{ role: string; content: string }> = [];
    const app = {
      addMessage: (role: string, content: string) => { appMessages.push({ role, content }); },
      getFileContexts: () => new Map<string, string>(),
    };
    const session = new Session(`skill-session-${Date.now()}`);

    addUserTurnToSession({
      app,
      session,
      text: "$writer rewrite README",
      effectiveImages: undefined,
      alreadyAddedUserMessage: false,
    });

    expect(appMessages).toEqual([{ role: "user", content: "$writer rewrite README" }]);
    expect(session.getMessages()[0]?.content).toContain(`<skill name="writer" location="${skillPath}">`);
    expect(session.getMessages()[0]?.content).toContain("</skill>\n\nrewrite README");
    expect(session.getMessages()[0]?.content).toContain("[skill invoked] writer");
  });

  it("also accepts Pi-compatible /skill:name input", async () => {
    const { root, skillPath } = await makeSkill("review");
    setRuntimeSettings({ skills: [root], discoverSkills: false });

    const expanded = expandSkillInvocation("/skill:review this diff");

    expect(expanded.expandedText).toContain(`<skill name="review" location="${skillPath}">`);
    expect(expanded.expandedText.endsWith("this diff")).toBe(true);
  });

  it("expands $skill tokens embedded anywhere in the prompt", async () => {
    const { root, skillPath } = await makeSkill("writer");
    setRuntimeSettings({ skills: [root], discoverSkills: false });

    const expanded = expandInlineSkillInvocations("rewrite this with $writer and keep names exact");

    expect(expanded.skillName).toBe("writer");
    expect(expanded.expandedText).toContain(`<skill name="writer" location="${skillPath}">`);
    expect(expanded.expandedText).toContain("rewrite this with and keep names exact");
    expect(expanded.expandedText).not.toContain("$writer");
  });
});
