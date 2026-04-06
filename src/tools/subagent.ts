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

const AGENT_TOOL_NAMES: ToolName[] = ["readFile", "listFiles", "grep", "webSearch", "webFetch"];
const MAX_FILE_HINTS = 6;

const agentSchema = z.object({
  prompt: z.string().min(1).describe("A detailed, self-contained task for the agent to perform autonomously."),
  model: z.string().optional().describe("Optional provider/model-id override."),
  files: z.array(z.string()).optional().describe("Optional files to prioritize as context."),
  task: z.string().optional().describe("Deprecated alias for prompt."),
});

type AgentInput = z.infer<typeof agentSchema>;

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

function resolvePrompt(input: AgentInput): string {
  const prompt = input.prompt.trim();
  if (prompt) return prompt;
  if (input.task?.trim()) return input.task.trim();
  return "";
}

export function buildAgentSystemPrompt(cwd: string, providerId?: string): string {
  const base = buildSystemPrompt(cwd, providerId, "build", resolveCavemanLevel(getSettings().cavemanLevel ?? "auto", ""));
  return [
    base,
    "You are a delegated agent running inside BrokeCLI.",
    "You are stateless. You get one prompt, you do the work autonomously, and you return one final report to the parent agent.",
    "Use only read-only search and inspection tools. Do not modify files. Do not claim to have changed anything.",
    "Prefer searching, listing, and reading over guessing. Trust your result enough to be concise.",
    "Return raw useful findings only. No chatter. No questions back to the user.",
  ].join("\n\n");
}

async function runAgentTurn(options: {
  model: ModelHandle;
  modelId: string;
  system: string;
  prompt: string;
  tools?: ToolSet;
  cwd: string;
}): Promise<{ text: string; toolsUsed: string[] }> {
  const { model, modelId, system, prompt, tools, cwd } = options;
  let text = "";
  const toolsUsed: string[] = [];

  if (model.runtime === "native-cli") {
    await startNativeStream({
      providerId: model.provider.id as "anthropic" | "codex",
      modelId,
      system,
      messages: [{ role: "user", content: prompt }],
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
    messages: [{ role: "user", content: prompt }],
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

export function createAgentTool(options: {
  cwd: () => string;
  providerRegistry: ProviderRegistry;
  getActiveModel: () => ModelHandle | null;
  getCurrentModelId: () => string;
}) {
  return tool({
    description: "Launch a stateless read-only agent for iterative search, planning, or review work. Prefer this when file or symbol search may need multiple rounds. The agent returns one final report, can not edit files, and should be trusted.",
    inputSchema: agentSchema,
    execute: async (input: AgentInput) => {
      const cwd = options.cwd();
      const prompt = resolvePrompt(input);
      if (!prompt) {
        return { success: false as const, error: "prompt is required" };
      }

      const activeModel = options.getActiveModel();
      if (!activeModel && !input.model) {
        return { success: false as const, error: "No active model available for agent delegation." };
      }

      let delegatedModel: ModelHandle;
      let delegatedModelId: string;
      try {
        if (input.model) {
          const [providerId, ...modelParts] = input.model.split("/");
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

      const system = buildAgentSystemPrompt(cwd, delegatedModel.provider.id);
      const fileHintBlock = buildFileHintBlock(cwd, input.files ?? []);
      const finalPrompt = fileHintBlock
        ? `${prompt}\n\nPriority file context:\n${fileHintBlock}`
        : prompt;

      const tools = canUseSdkTools(delegatedModel)
        ? getTools({ include: AGENT_TOOL_NAMES })
        : undefined;

      try {
        const result = await runAgentTurn({
          model: delegatedModel,
          modelId: delegatedModelId,
          system,
          prompt: finalPrompt,
          tools,
          cwd,
        });
        return {
          success: true as const,
          model: `${delegatedModel.provider.id}/${delegatedModelId}`,
          toolsUsed: result.toolsUsed,
          result: result.text || "[empty agent response]",
        };
      } catch (error) {
        return { success: false as const, error: (error as Error).message.slice(0, 200) };
      }
    },
  });
}

export const createSubagentTool = createAgentTool;
export const buildSubagentSystemPrompt = buildAgentSystemPrompt;
