import { buildSystemPrompt, reloadContext } from "../core/context.js";
import { compactMessages, getTotalContextTokens, splitCompactedMessages } from "../core/compact.js";
import { getConfiguredModelPreference, getSettings, updateModelPreference, updateSetting, type Mode, type ModelPreferenceSlot } from "../core/config.js";
import { createDefaultSessionName } from "../core/session.js";
import { runConnectFlow } from "./connect-flow.js";
import { runLoginFlow } from "./login-flow.js";
import { openExtensionsMenu, openPermissionsMenu, openSettingsMenu, openThemeMenu } from "./slash-command-menus.js";
import type { HandleSlashCommandOptions, SlashCommandResult } from "./slash-command-types.js";
import { handleUiSlashCommand } from "./slash-command-ui.js";
import { getResolvedModelPreference } from "./model-routing.js";

export async function handleSlashCommand(options: HandleSlashCommandOptions): Promise<SlashCommandResult> {
  const {
    text,
    app,
    session,
    activeModel,
    currentModelId,
    currentMode,
    systemPrompt,
    providerRegistry,
    buildVisibleModelOptions,
    refreshProviderState,
    isSkippedPromptAnswer,
    isValidHttpBaseUrl,
    getContextOptimizer,
    onSessionReplace,
    onModelChange,
    onModeChange,
    onModelRoutingChange,
    onSystemPromptChange,
    hooks,
    onProjectChange,
  } = options;

  const [cmd, ...restParts] = text.slice(1).split(" ");
  const restText = restParts.join(" ").trim();

  switch (cmd) {
    case "help":
      app.setStatus?.("Type / to browse commands.");
      app.setDraft?.("/");
      return { handled: true };
    case "new":
    case "clear":
      session.clear();
      session.resetName?.();
      app.clearMessages();
      app.resetCost();
      app.setSessionName?.(session.getName?.() ?? createDefaultSessionName());
      getContextOptimizer().reset();
      return { handled: true };
    case "connect":
      await runConnectFlow({
        providerId: restText || undefined,
        app,
        providerRegistry,
        refreshProviderState,
        isSkippedPromptAnswer,
        isValidHttpBaseUrl,
      });
      return { handled: true };
    case "login":
      await runLoginFlow({
        providerId: restText || undefined,
        app,
        providerRegistry,
        refreshProviderState,
      });
      return { handled: true };
    case "model": {
      const allOptions = buildVisibleModelOptions();
      if (allOptions.length === 0) {
        app.setStatus?.("No connected providers found. Run /connect.");
        return { handled: true };
      }
      app.openModelPicker(allOptions, (provId, modId) => {
        try {
          const key = `${provId}/${modId}`;
          const nextModel = providerRegistry.createModel(provId, modId);
          onModelChange(nextModel, modId);
          app.setModel(nextModel.provider.name, modId, {
            providerId: nextModel.provider.id,
            runtime: nextModel.runtime,
          });
          session.setProviderModel(nextModel.provider.name, modId);
          updateSetting("lastModel", key);
          for (const slot of ["default", "small", "review", "planning", "ui", "architecture"] as const) {
            if (!getConfiguredModelPreference(slot)) updateModelPreference(slot, key);
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
        app.updateModelPickerOptions?.(buildVisibleModelOptions(), key);
      }, (provId, modId, slot: ModelPreferenceSlot) => {
        const key = `${provId}/${modId}`;
        const fallbackProviderId = activeModel?.provider.id ?? provId;
        const current = getResolvedModelPreference(slot, fallbackProviderId);
        updateModelPreference(slot, current?.key === key ? null : key);
        onModelRoutingChange?.();
        app.updateModelPickerOptions?.(buildVisibleModelOptions(), key);
      }, 0);
      return { handled: true };
    }
    case "settings": {
      openSettingsMenu({ app, activeModel, currentMode, onModeChange, onSystemPromptChange });
      return { handled: true };
    }
    case "mode": {
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
    }
    case "permissions": {
      openPermissionsMenu(app);
      return { handled: true };
    }
    case "extensions": {
      openExtensionsMenu(app, hooks);
      return { handled: true };
    }
    case "theme": {
      openThemeMenu(app);
      return { handled: true };
    }
    case "compact": {
      if (!activeModel) {
        app.setStatus?.("No model available for compaction.");
        return { handled: true };
      }
      hooks.emit("on_message", { role: "user", content: text });
      try {
        const chatMsgs = session.getChatMessages();
        const ctxTokens = getTotalContextTokens(chatMsgs, systemPrompt, currentModelId);
        app.setCompacting?.(true, ctxTokens);
        const compacted = activeModel.runtime === "sdk" && activeModel.model
          ? await compactMessages(chatMsgs, activeModel.model, { customInstructions: restText || undefined })
          : chatMsgs.slice(-6);
        const parsed = splitCompactedMessages(compacted);
        if (parsed.summary) session.applyCompaction(parsed.summary, parsed.messages, ctxTokens);
        else session.replaceConversation(parsed.messages);
        session.recordCompaction();
        app.setCompacting?.(false);
        app.clearMessages();
        for (const msg of session.getMessages()) app.addMessage(msg.role, msg.content);
        app.updateUsage?.(session.getTotalCost(), session.getTotalInputTokens(), session.getTotalOutputTokens());
        app.setStatus?.(`Compacted older context. Kept ${session.getMessages().length} visible messages.`);
      } catch (err) {
        app.setCompacting?.(false);
        app.setStatus?.(`Compact failed: ${(err as Error).message}`);
      }
      return { handled: true };
    }
    case "fork": {
      const forked = session.fork();
      if (activeModel) forked.setProviderModel(activeModel.provider.name, currentModelId);
      onSessionReplace(forked);
      app.setStatus?.("Forked session.");
      return { handled: true };
    }
    case "caveman": {
      app.cycleCavemanMode();
      reloadContext();
      const level = getSettings().cavemanLevel ?? "auto";
      onSystemPromptChange(buildSystemPrompt(process.cwd(), activeModel?.provider?.id, currentMode, level));
      return { handled: true };
    }
    case "thinking":
      app.cycleThinkingMode();
      return { handled: true };
    case "name": {
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
    }
    default: {
      const uiResult = await handleUiSlashCommand({
        cmd,
        text,
        restText,
        app,
        session,
        activeModel,
        currentModelId,
        refreshProviderState,
        onSessionReplace,
        hooks,
        onProjectChange,
      });
      if (uiResult) return uiResult;
      app.setStatus?.(`Unknown: /${cmd}`);
      return { handled: true };
    }
  }
}
