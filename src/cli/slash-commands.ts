import { buildSystemPrompt, reloadContext } from "../core/context.js";
import { buildCompactionContextMessage, compactMessages, getTotalContextTokens, splitCompactedMessages, summarizeBranchMessages } from "../core/compact.js";
import { getConfiguredModelPreference, getSettings, updateModelPreference, updateSetting, type Mode, type ModelPreferenceSlot } from "../core/config.js";
import { createDefaultSessionName } from "../core/session.js";
import { runConnectFlow } from "./connect-flow.js";
import { runLoginFlow } from "./login-flow.js";
import { openExtensionsMenu, openPackagesMenu, openSettingsMenu } from "./slash-command-menus.js";
import { createSlashCommandRegistry, type RegisteredSlashCommand } from "./slash-command-registry.js";
import type { HandleSlashCommandOptions, ParsedSlashCommand, SlashCommandResult } from "./slash-command-types.js";
import { handleUiSlashCommand } from "./slash-command-ui.js";
import { getResolvedModelPreference } from "./model-routing.js";
import { AUTO_MODEL_ID, AUTO_MODEL_PROVIDER_ID, filterUnsupportedRuntimeModelOptions, withAutoModelOption } from "./runtime-models.js";

interface CoreSlashCommandContext extends ParsedSlashCommand {
  waitFor: (ms: number) => Promise<void>;
}

export const CORE_SLASH_COMMAND_SPECS: ReadonlyArray<RegisteredSlashCommand<CoreSlashCommandContext, SlashCommandResult>> = [
  {
    names: ["help"],
    description: "show slash command browser",
    showInPicker: false,
    run: ({ app }) => {
      app.setStatus?.("Type / to browse commands.");
      app.setDraft?.("/");
      return { handled: true };
    },
  },
  {
    names: ["new", "clear"],
    pickerName: "clear",
    description: "start a new session",
    run: ({ session, app, getContextOptimizer }) => {
      session.clear();
      session.resetName?.();
      app.clearMessages();
      app.resetCost();
      app.setSessionName?.(session.getName?.() ?? createDefaultSessionName());
      getContextOptimizer().reset();
      return { handled: true };
    },
  },
  {
    names: ["connect"],
    description: "connect api key or local endpoint",
    run: async ({ restText, app, providerRegistry, refreshProviderState, isSkippedPromptAnswer, isValidHttpBaseUrl }) => {
      await runConnectFlow({
        providerId: restText || undefined,
        app,
        providerRegistry,
        refreshProviderState,
        isSkippedPromptAnswer,
        isValidHttpBaseUrl,
      });
      return { handled: true };
    },
  },
  {
    names: ["login"],
    description: "login with subscription/oauth",
    run: async ({ restText, app, providerRegistry, refreshProviderState }) => {
      await runLoginFlow({
        providerId: restText || undefined,
        app,
        providerRegistry,
        refreshProviderState,
      });
      return { handled: true };
    },
  },
  {
    names: ["model"],
    description: "switch model and assign routing slots",
    hotkey: "ctrl+l",
    run: ({ restText, app, providerRegistry, buildVisibleModelOptions, activeModel, onModelChange, session, onModelRoutingChange }) => {
      app.dismissBtwBubble?.();
      const getPickerOptions = () => withAutoModelOption(
        filterUnsupportedRuntimeModelOptions(
          buildVisibleModelOptions(),
          activeModel,
          providerRegistry.getDetectedProviders?.() ?? [],
        ),
      );
      const allOptions = getPickerOptions();
      if (allOptions.length === 0) {
        app.setStatus?.("No connected providers found. Run /connect.");
        return { handled: true };
      }
      const normalizedQuery = restText.toLowerCase();
      const filteredOptions = normalizedQuery
        ? allOptions.filter((option) =>
          option.modelId.toLowerCase().includes(normalizedQuery)
          || option.providerId.toLowerCase().includes(normalizedQuery)
          || option.providerName.toLowerCase().includes(normalizedQuery)
          || (option.displayName ?? "").toLowerCase().includes(normalizedQuery))
        : allOptions;
      const initialCursor = normalizedQuery && filteredOptions.length > 0
        ? allOptions.findIndex((option) =>
          option.providerId === filteredOptions[0]!.providerId
          && option.modelId === filteredOptions[0]!.modelId)
        : 0;
      if (normalizedQuery) {
        app.setStatus?.(
          filteredOptions.length > 0
            ? `Showing ${filteredOptions.length} match${filteredOptions.length === 1 ? "" : "es"} for "${restText}".`
            : `No models match "${restText}".`,
        );
      }
      app.openModelPicker(allOptions, (provId, modId) => {
        try {
          if (provId === AUTO_MODEL_PROVIDER_ID && modId === AUTO_MODEL_ID) {
            updateSetting("autoRoute", true);
            app.setStatus?.("Auto routing enabled.");
            onModelRoutingChange?.();
            app.updateModelPickerOptions?.(getPickerOptions(), `${AUTO_MODEL_PROVIDER_ID}/${AUTO_MODEL_ID}`);
            return;
          }
          const key = `${provId}/${modId}`;
          updateSetting("autoRoute", false);
          const nextModel = providerRegistry.createModel(provId, modId);
          const resolvedModelId = nextModel.modelId;
          const resolvedKey = `${nextModel.provider.id}/${resolvedModelId}`;
          onModelChange(nextModel, resolvedModelId);
          app.setModel(nextModel.provider.name, resolvedModelId, {
            providerId: nextModel.provider.id,
            runtime: nextModel.runtime,
          });
          session.setProviderModel(nextModel.provider.name, resolvedModelId);
          updateSetting("lastModel", resolvedKey);
          for (const slot of ["default", "small", "btw", "review", "planning", "ui", "architecture"] as const) {
            if (!getConfiguredModelPreference(slot)) updateModelPreference(slot, resolvedKey);
          }
          onModelRoutingChange?.();
        } catch (err) {
          app.setStatus?.(`Failed: ${(err as Error).message}`);
        }
      }, (provId, modId, pinned) => {
        const key = `${provId}/${modId}`;
        const scoped = getSettings().scopedModels;
        if (pinned && !scoped.includes(key)) updateSetting("scopedModels", [...scoped, key]);
        else if (!pinned) updateSetting("scopedModels", scoped.filter((entry: string) => entry !== key));
        app.updateModelPickerOptions?.(getPickerOptions(), key);
      }, (provId, modId, slot: ModelPreferenceSlot) => {
        const key = `${provId}/${modId}`;
        const fallbackProviderId = activeModel?.provider.id ?? provId;
        const current = getResolvedModelPreference(slot, fallbackProviderId);
        updateModelPreference(slot, current?.key === key ? null : key);
        onModelRoutingChange?.();
        app.updateModelPickerOptions?.(getPickerOptions(), key);
      }, initialCursor >= 0 ? initialCursor : 0, "all", restText);
      return { handled: true };
    },
  },
  {
    names: ["btw"],
    description: "ask an ephemeral side question",
    run: ({ restText, app, onBtw }) => {
      app.dismissBtwBubble?.();
      if (!restText) {
        app.setDraft?.("/btw ");
        app.setStatus?.("Ask a side question after /btw.");
        return { handled: true };
      }
      if (!onBtw) {
        app.setStatus?.("/btw is unavailable in this runtime.");
        return { handled: true };
      }
      app.setStatus?.("Asking side question...");
      void onBtw(restText).catch((err) => {
        app.setStatus?.(`BTW failed: ${(err as Error).message}`);
      });
      return { handled: true };
    },
  },
  {
    names: ["settings"],
    description: "configure options",
    sortPriority: -1,
    run: ({ app, activeModel, currentMode, onModeChange, onSystemPromptChange }) => {
      app.dismissBtwBubble?.();
      openSettingsMenu({ app, activeModel, currentMode, onModeChange, onSystemPromptChange });
      return { handled: true };
    },
  },
  {
    names: ["mode"],
    description: "switch build or plan mode",
    run: ({ restText, app, activeModel, onModeChange, onSystemPromptChange }) => {
      app.dismissBtwBubble?.();
      const setMode = (nextMode: Mode) => {
        updateSetting("mode", nextMode);
        onModeChange(nextMode);
        onSystemPromptChange(buildSystemPrompt(process.cwd(), activeModel?.provider?.id, nextMode, getSettings().cavemanLevel ?? "auto"));
        app.setStatus?.(`Mode: ${nextMode}`);
      };
      if (restText === "build" || restText === "plan") {
        setMode(restText);
        return { handled: true };
      }
      app.openItemPicker("Mode", [
        { id: "build", label: "Build", detail: "make changes directly with tools" },
        { id: "plan", label: "Plan", detail: "outline and think before edits" },
      ], (id: string) => {
        if (id === "build" || id === "plan") setMode(id);
      }, { kind: "mode" });
      return { handled: true };
    },
  },
  {
    names: ["extensions"],
    showInPicker: false,
    description: "manage extension loading",
    run: ({ app, hooks }) => {
      app.dismissBtwBubble?.();
      openExtensionsMenu(app, hooks);
      return { handled: true };
    },
  },
  {
    names: ["packages"],
    showInPicker: false,
    description: "inspect configured packages",
    run: ({ app }) => {
      app.dismissBtwBubble?.();
      openPackagesMenu(app);
      return { handled: true };
    },
  },
  {
    names: ["compact"],
    description: "compress context",
    run: async ({ activeModel, hooks, session, systemPrompt, currentModelId, app, restText, waitFor }) => {
      app.dismissBtwBubble?.();
      if (!activeModel) {
        app.setStatus?.("No model available for compaction.");
        return { handled: true };
      }
      hooks.emit("on_message", { role: "user", content: "/compact" });
      try {
        const chatMsgs = session.getChatMessages();
        const ctxTokens = getTotalContextTokens(chatMsgs, systemPrompt, currentModelId);
        const compactStartedAt = Date.now();
        app.setCompacting?.(true, ctxTokens);
        const compacted = activeModel.runtime === "sdk" && activeModel.model
          ? await compactMessages(chatMsgs, activeModel.model, { customInstructions: restText || undefined, tailKeep: 0 })
          : [{ role: "user" as const, content: buildCompactionContextMessage(await summarizeBranchMessages(chatMsgs, null, restText || undefined)) }];
        const parsed = splitCompactedMessages(compacted);
        if (parsed.summary) session.applyCompaction(parsed.summary, parsed.messages, ctxTokens);
        else session.replaceConversation(parsed.messages);
        session.recordCompaction();
        await waitFor(Math.max(0, 650 - (Date.now() - compactStartedAt)));
        app.setCompacting?.(false);
        app.clearMessages();
        for (const msg of session.getMessages()) app.addMessage(msg.role, msg.content);
        app.updateUsage?.(session.getTotalCost(), session.getTotalInputTokens(), session.getTotalOutputTokens());
        (app as any).setContextUsage?.(-1, (app as any).contextLimitTokens || 0);
        app.setStatus?.("Compaction complete.");
      } catch (err) {
        app.setCompacting?.(false);
        app.setStatus?.(`Compact failed: ${(err as Error).message}`);
      }
      return { handled: true };
    },
  },
  {
    names: ["compact-at"],
    description: "set auto-compact threshold percent",
    run: ({ app, restText }) => {
      const current = getSettings().compaction.triggerPercent;
      if (!restText) {
        app.setStatus?.(`Auto-compact threshold: ${current}%`);
        return { handled: true };
      }
      const normalized = restText.trim().replace(/%$/, "");
      const next = Number.parseInt(normalized, 10);
      if (!Number.isFinite(next) || next < 40 || next > 95) {
        app.setStatus?.("Use /compact-at <40-95>");
        return { handled: true };
      }
      updateSetting("compaction", { ...getSettings().compaction, triggerPercent: next });
      app.setStatus?.(`Auto-compact threshold set to ${next}%`);
      return { handled: true };
    },
  },
  {
    names: ["fork"],
    description: "branch from current session",
    run: ({ session, activeModel, currentModelId, onSessionReplace, app }) => {
      app.dismissBtwBubble?.();
      const forked = session.fork();
      if (activeModel) forked.setProviderModel(activeModel.provider.name, currentModelId);
      onSessionReplace(forked);
      app.setStatus?.("Forked session.");
      return { handled: true };
    },
  },
  {
    names: ["caveman"],
    showInPicker: false,
    description: "cycle token saving",
    hotkey: "ctrl+y",
    run: ({ restText, app, activeModel, currentMode, onSystemPromptChange }) => {
      app.dismissBtwBubble?.();
      const requested = restText.toLowerCase();
      if (requested === "off" || requested === "lite" || requested === "auto" || requested === "ultra") {
        updateSetting("cavemanLevel", requested);
        app.setStatus?.(`Caveman: ${requested}`);
      } else {
        app.cycleCavemanMode();
      }
      reloadContext();
      const level = getSettings().cavemanLevel ?? "auto";
      onSystemPromptChange(buildSystemPrompt(process.cwd(), activeModel?.provider?.id, currentMode, level));
      return { handled: true };
    },
  },
  {
    names: ["thinking"],
    description: "cycle thinking",
    hotkey: "ctrl+t",
    run: ({ app }) => {
      app.dismissBtwBubble?.();
      app.cycleThinkingMode();
      return { handled: true };
    },
  },
  {
    names: ["name"],
    showInPicker: false,
    description: "rename this session",
    run: ({ text, app, session }) => {
      app.dismissBtwBubble?.();
      const name = text.slice(6).trim();
      if (name) {
        session.setName(name);
        app.setSessionName?.(name);
        app.setStatus?.(`Session renamed to ${name}`);
        return { handled: true };
      }
      const currentName = session.getName();
      app.openItemPicker("Session name", [
        { id: "rename", label: "Rename", detail: currentName },
        { id: "clear", label: "Reset", detail: "Generated name" },
      ], (id: string) => {
        if (id === "clear") {
          const nextName = createDefaultSessionName();
          session.setName(nextName);
          app.setSessionName?.(nextName);
          app.setStatus?.("Session name reset.");
          return;
        }
        void app.showQuestion("Session name").then((nextName) => {
          const trimmed = nextName.trim();
          if (!trimmed) return;
          session.setName(trimmed);
          app.setSessionName?.(trimmed);
          app.setStatus?.(`Session renamed to ${trimmed}`);
        });
      }, { kind: "name" });
      return { handled: true };
    },
  },
];

const coreSlashCommands = createSlashCommandRegistry<CoreSlashCommandContext, SlashCommandResult>(CORE_SLASH_COMMAND_SPECS);

export async function handleSlashCommand(options: HandleSlashCommandOptions): Promise<SlashCommandResult> {
  const { text } = options;
  options.app.dismissBtwBubble?.();
  const [cmd, ...restParts] = text.slice(1).split(" ");
  const restText = restParts.join(" ").trim();
  const waitFor = async (ms: number) => {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  };
  const command = coreSlashCommands.get(cmd);
  if (command) {
    return await command({ ...options, cmd, restText, waitFor });
  }
  const extensionCommand = options.hooks.getSlashCommands?.().find((entry) => entry.names.includes(cmd));
  if (extensionCommand) {
    return await extensionCommand.run({ ...options, cmd, restText, waitFor });
  }
  const uiResult = await handleUiSlashCommand({ ...options, cmd, restText });
  if (uiResult) return uiResult;
  options.app.setStatus?.(`Unknown: /${cmd}`);
  return { handled: true };
}
