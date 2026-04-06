import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { relative, resolve } from "path";
import { existsSync } from "fs";
import type { ModelHandle } from "../ai/providers.js";
import { startNativeStream } from "../ai/native-stream.js";
import { startStream } from "../ai/stream.js";
import type { ProviderRegistry } from "../ai/provider-registry.js";
import { buildSystemPrompt, resolveCavemanLevel } from "../core/context.js";
import { getSettings } from "../core/config.js";
import { readFileForContext } from "../tui/file-picker.js";
import { getTools, type ToolName } from "./registry.js";

const SUBAGENT_TOOL_NAMES: ToolName[] = ["readFile", "listFiles", "grep", "webSearch", "webFetch"];
const MAX_FILE_HINTS = 6;
const subagentSchema = z.object({
  task: z.string().min(1).describe("The delegated task"),
  role: z.enum(["research", "plan", "review"]).default("research").describe("What kind of delegated work to do"),
  model: z.string().optional().describe("Optional provider/model-id override"),
  files: z.array(z.string()).optional().describe("Optional files to prioritize as context"),
});

type SubagentInput = z.infer<typeof subagentSchema>;

const SUBAGENT_ROLE_GUIDANCE: Record<"research" | "plan" | "review", string> = {
  research: "Investigate the assigned task with read-only tools. Focus on concrete evidence, code references, and concise findings.",
  plan: "Analyze the assigned task and return a compact implementation plan with tradeoffs and risks. Do not modify files.",
  review: "Review the assigned target for bugs, regressions, missing tests, and risky assumptions. Findings first, no fluff.",
};

function canUseSdkTools(model: ModelHandle): boolean {
  return model.runtime === "sdk"
    && !!model.model
    && [
      "anthropic",
      "openai",
      "codex",
      "google",
      "mistral",
      "groq",
      "xai",
      "openrouter",
      "ollama",
      "lmstudio",
      "llamacpp",
      "jan",
      "vllm",
    ].includes(model.provider.id);
}

function normalizeFileHint(cwd: string, inputPath: string): string | null {
  const trimmed = inputPath.trim();
  if (!trimmed) return null;
  const absolute = resolve(cwd, trimmed);
  const rel = relative(cwd, absolute).replace(/\\/g, "/");
  if (!rel || rel.startsWith("..")) return null;
  return rel;
}

function buildFileHintBlock(cwd: string, files: string[]): string {
  const unique = [...new Set(files.map((file) => normalizeFileHint(cwd, file)).filter(Boolean) as string[])].slice(0, MAX_FILE_HINTS);
  if (unique.length === 0) return "";
  return unique
    .map((file) => {
      const absolute = resolve(cwd, file);
      const content = existsSync(absolute) ? readFileForContext(cwd, file, 4000) : "(missing file)";
      return `--- @${file} ---\n${content}`;
    })
    .join("\n\n");
}

export function buildSubagentSystemPrompt(role: "research" | "plan" | "review", cwd: string, providerId?: string): string {
  const base = buildSystemPrompt(cwd, providerId, "build", resolveCavemanLevel(getSettings().cavemanLevel ?? "off", ""));
  return [
    base,
    "You are a delegated subagent running inside BrokeCLI.",
    SUBAGENT_ROLE_GUIDANCE[role],
    "Stay inside the assigned task. Do not ask the user questions. Do not modify files. Do not claim to have changed anything.",
    "Return only the useful result for the parent agent. Keep it concise and specific.",
  ].join("\n\n");
}

async function runSubagentTurn(options: {
  model: ModelHandle;
  modelId: string;
  system: string;
  content: string;
  tools?: ToolSet;
  cwd: string;
}): Promise<{ text: string; toolsUsed: string[] }> {
  const { model, modelId, system, content, tools, cwd } = options;
  let text = "";
  const toolsUsed: string[] = [];

  if (model.runtime === "native-cli") {
    await startNativeStream({
      providerId: model.provider.id as "anthropic" | "codex",
      modelId,
      system,
      messages: [{ role: "user", content }],
      enableThinking: getSettings().enableThinking,
      thinkingLevel: getSettings().thinkingLevel || "low",
      yoloMode: false,
      cwd,
    }, {
      onText: (delta) => {
        text += delta;
      },
      onReasoning: () => {},
      onFinish: () => {},
      onError: (error) => {
        throw error;
      },
    });
    return { text: text.trim(), toolsUsed };
  }

  await startStream({
    model: model.model!,
    modelId,
    providerId: model.provider.id,
    system,
    messages: [{ role: "user", content }],
    tools,
    enableThinking: getSettings().enableThinking,
    thinkingLevel: getSettings().thinkingLevel || "low",
  }, {
    onText: (delta) => {
      text += delta;
    },
    onReasoning: () => {},
    onFinish: () => {},
    onError: (error) => {
      throw error;
    },
    onToolCall: (toolName) => {
      if (!toolsUsed.includes(toolName)) toolsUsed.push(toolName);
    },
  });

  return { text: text.trim(), toolsUsed };
}

export function createSubagentTool(options: {
  cwd: () => string;
  providerRegistry: ProviderRegistry;
  getActiveModel: () => ModelHandle | null;
  getCurrentModelId: () => string;
}) {
  return tool({
    description: "Delegate a bounded task to a read-only subagent with isolated context. Use for focused research, planning, or review work that should not pollute the main conversation.",
    inputSchema: subagentSchema,
    execute: async ({ task, role, model, files = [] }: SubagentInput) => {
      const cwd = options.cwd();
      const activeModel = options.getActiveModel();
      if (!activeModel && !model) {
        return { success: false as const, error: "No active model available for subagent delegation." };
      }

      let delegatedModel: ModelHandle;
      let delegatedModelId: string;
      try {
        if (model) {
          const [providerId, ...modelParts] = model.split("/");
          delegatedModelId = modelParts.join("/");
          delegatedModel = options.providerRegistry.createModel(providerId, delegatedModelId || undefined);
          delegatedModelId ||= delegatedModel.provider.defaultModel;
        } else {
          delegatedModel = activeModel!;
          delegatedModelId = options.getCurrentModelId();
        }
      } catch (error) {
        return { success: false as const, error: (error as Error).message };
      }

      const system = buildSubagentSystemPrompt(role, cwd, delegatedModel.provider.id);
      const fileHintBlock = buildFileHintBlock(cwd, files);
      const content = fileHintBlock
        ? `${task}\n\nPriority file context:\n${fileHintBlock}`
        : task;

      const tools = canUseSdkTools(delegatedModel)
        ? getTools({ include: SUBAGENT_TOOL_NAMES })
        : undefined;

      try {
        const result = await runSubagentTurn({
          model: delegatedModel,
          modelId: delegatedModelId,
          system,
          content,
          tools,
          cwd,
        });
        return {
          success: true as const,
          role,
          model: `${delegatedModel.provider.id}/${delegatedModelId}`,
          toolsUsed: result.toolsUsed,
          result: result.text || "[empty subagent response]",
        };
      } catch (error) {
        return { success: false as const, error: (error as Error).message.slice(0, 200) };
      }
    },
  });
}
