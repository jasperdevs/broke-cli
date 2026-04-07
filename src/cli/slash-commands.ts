import { buildSystemPrompt, reloadContext } from "../core/context.js";
import { compactMessages, getTotalContextTokens } from "../core/compact.js";
import { getSettings, updateModelPreference, updateSetting, type Mode, type ModelPreferenceSlot } from "../core/config.js";
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
    onModelRoutingChange,
    onSystemPromptChange,
    hooks,
    onProjectChange,
  } = options;

  const [cmd, ...restParts] = text.slice(1).split(" ");
  const restText = restParts.join(" ").trim();

  switch (cmd) {
    case "help":
      app.setDraft?.("/");
      return { handled: true };
    case "new":
    case "clear":
      session.clear();
      app.clearMessages();
      app.resetCost();
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
          const nextModel = providerRegistry.createModel(provId, modId);
          onModelChange(nextModel, modId);
          app.setModel(nextModel.provider.name, modId);
          session.setProviderModel(nextModel.provider.name, modId);
          updateSetting("lastModel", `${provId}/${modId}`);
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
      openSettingsMenu({ app, activeModel, currentMode, onSystemPromptChange });
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
        session.replaceConversation(compacted);
        session.recordCompaction();
        app.setCompacting?.(false);
        app.clearMessages();
        app.setStatus?.(`Compacted ${chatMsgs.length} -> ${compacted.length}`);
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
      if (!name) {
        app.setStatus?.("Usage: /name <session name>");
        return { handled: true };
      }
      session.setName(name);
      app.setSessionName?.(name);
      app.setStatus?.(`Session renamed to ${name}`);
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
