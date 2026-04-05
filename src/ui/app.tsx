import React, { useState, useCallback } from "react";
import { Box, Static, Text, useApp } from "ink";
import type { ModelMessage } from "ai";
import type { Provider, ModelInfo } from "../providers/types.js";
import type { DetectionResult } from "../providers/detect.js";
import { handleUserInput } from "../orchestrator.js";
import { Message, StreamingMessage } from "./message-stream.js";
import { PromptInput } from "./prompt-input.js";
import { StatusBar } from "./status-bar.js";
import { Welcome } from "./welcome.js";
import { Setup } from "./setup.js";
import { formatCost } from "../budget/cost.js";
import { buildProviders } from "../providers/registry.js";
import { loadCodexAuth, createCodexProvider } from "../providers/adapters/codex-auth.js";
import { version } from "../../package.json";

interface CompletedMessage {
  role: "user" | "assistant";
  content: string;
  id: number;
}

interface AppProps {
  provider?: Provider;
  model?: ModelInfo;
  providers: Provider[];
  detectedProviders: DetectionResult[];
}

export function App({
  provider: initialProvider,
  model: initialModel,
  providers: initialProviders,
  detectedProviders,
}: AppProps) {
  const { exit } = useApp();
  const [completedMessages, setCompletedMessages] = useState<CompletedMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [history, setHistory] = useState<ModelMessage[]>([]);
  const [sessionCost, setSessionCost] = useState(0);
  const [turnCost, setTurnCost] = useState(0);
  const [tokenCount, setTokenCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [msgId, setMsgId] = useState(0);
  const [activeProvider, setActiveProvider] = useState<Provider | undefined>(initialProvider);
  const [activeModel, setActiveModel] = useState<ModelInfo | undefined>(initialModel);
  const [providers, setProviders] = useState<Provider[]>(initialProviders);
  const [showSetup, setShowSetup] = useState(!initialProvider);

  const nextMsgId = useCallback(() => {
    let id = 0;
    setMsgId((prev) => { id = prev; return prev + 1; });
    return id;
  }, []);

  const addSystemMessage = useCallback(
    (content: string) => {
      setCompletedMessages((prev) => [
        ...prev,
        { role: "assistant" as const, content, id: Date.now() },
      ]);
    },
    [],
  );

  const handleSetupComplete = useCallback(
    (providerId: string, apiKey: string) => {
      const newProviders = buildProviders([
        { id: providerId, name: providerId, isLocal: false, apiKey, availableModels: [] },
      ]);
      if (newProviders.length > 0) {
        const p = newProviders[0];
        const m = p.listModels()[0];
        setActiveProvider(p);
        setActiveModel(m);
        setProviders((prev) => [...prev, p]);
        setShowSetup(false);
        addSystemMessage(`Connected to **${p.name}** — using ${m.displayName}. Start chatting!`);
      }
    },
    [addSystemMessage],
  );

  const handleCodexLogin = useCallback(() => {
    const auth = loadCodexAuth();
    if (auth) {
      const sdk = createCodexProvider(auth);
      // Build an OpenAI provider from the codex auth
      handleSetupComplete("openai", auth.access_token);
    } else {
      addSystemMessage(
        "Codex not authenticated. Run `codex auth login` in another terminal, then try `/setup` again.",
      );
      setShowSetup(false);
    }
  }, [handleSetupComplete, addSystemMessage]);

  const handleSubmit = useCallback(
    async (input: string) => {
      // Slash commands
      if (input.startsWith("/")) {
        const [cmd, ...args] = input.slice(1).split(" ");
        const arg = args.join(" ");

        switch (cmd) {
          case "clear":
            setCompletedMessages([]);
            setHistory([]);
            setSessionCost(0);
            setTokenCount(0);
            return;
          case "exit":
          case "quit":
          case "q":
            exit();
            return;
          case "setup":
          case "login":
            setShowSetup(true);
            return;
          case "model": {
            if (!arg) {
              const lines = ["**Available models:**"];
              if (providers.length === 0) {
                lines.push("  (no providers configured — run /setup)");
              }
              for (const p of providers) {
                for (const m of p.listModels()) {
                  const current =
                    activeProvider?.id === p.id && activeModel?.id === m.id
                      ? " **(active)**"
                      : "";
                  lines.push(
                    `  \`${p.id}/${m.id}\` ${m.displayName} (${formatCost(m.pricing.inputPerMTok)}/MTok)${current}`,
                  );
                }
              }
              lines.push("", "Usage: `/model provider/model-id`");
              addSystemMessage(lines.join("\n"));
              return;
            }
            const { findModel } = await import("../providers/registry.js");
            const resolved = findModel(providers, arg);
            if (resolved) {
              setActiveProvider(resolved.provider);
              setActiveModel(resolved.model);
              addSystemMessage(
                `Switched to **${resolved.model.displayName}** (${resolved.provider.id}/${resolved.model.id})`,
              );
            } else {
              addSystemMessage(
                `Model not found: \`${arg}\`. Run /model to see available models.`,
              );
            }
            return;
          }
          case "cost":
            addSystemMessage(
              `Session: **${formatCost(sessionCost)}** | Tokens: **${tokenCount}**`,
            );
            return;
          case "help":
            addSystemMessage(
              [
                "**Commands:**",
                "  /model [id]  — list or switch models",
                "  /setup       — add a provider",
                "  /cost        — session spend",
                "  /clear       — clear conversation",
                "  /help        — this help",
                "  /exit        — quit",
              ].join("\n"),
            );
            return;
          default:
            addSystemMessage(`Unknown command: /${cmd}. Try /help`);
            return;
        }
      }

      // No provider check
      if (!activeProvider || !activeModel) {
        addSystemMessage(
          "No provider configured. Run **/setup** to add one.",
        );
        return;
      }

      // Add user message
      setCompletedMessages((prev) => [
        ...prev,
        { role: "user" as const, content: input, id: Date.now() },
      ]);
      setIsStreaming(true);
      setStreamingText("");
      setTurnCost(0);
      setError(null);

      try {
        const result = await handleUserInput(
          input,
          history,
          { provider: activeProvider, model: activeModel },
          {
            onText: (text) => setStreamingText((prev) => prev + text),
            onError: (err) => setError(err.message),
            onUsage: (usage) => {
              setTurnCost(usage.cost);
              setSessionCost((prev) => prev + usage.cost);
              setTokenCount((prev) => prev + usage.totalTokens);
            },
            onFinish: (fullText) => {
              setCompletedMessages((prev) => [
                ...prev,
                { role: "assistant" as const, content: fullText, id: Date.now() + 1 },
              ]);
              setStreamingText("");
              setIsStreaming(false);
            },
          },
        );
        setHistory(result.messages);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setIsStreaming(false);
      }
    },
    [history, activeProvider, activeModel, providers, exit, sessionCost, tokenCount, addSystemMessage],
  );

  // Setup mode — completely separate render, no input conflicts
  if (showSetup) {
    return (
      <Box flexDirection="column">
        <Setup
          onComplete={handleSetupComplete}
          onCodexLogin={handleCodexLogin}
          onSkip={() => setShowSetup(false)}
        />
      </Box>
    );
  }

  // Main chat view
  return (
    <Box flexDirection="column">
      {/* Welcome header */}
      <Welcome
        version={version}
        detectedProviders={detectedProviders}
        activeModel={activeModel?.displayName}
        activeProvider={activeProvider?.id}
      />

      {/* Chat area */}
      <Box flexDirection="column" flexGrow={1}>
        <Static items={completedMessages}>
          {(msg) => (
            <Box key={msg.id}>
              <Message role={msg.role} content={msg.content} />
            </Box>
          )}
        </Static>

        {isStreaming && <StreamingMessage content={streamingText} />}

        {error && (
          <Box marginBottom={1}>
            <Text color="red">Error: {error}</Text>
          </Box>
        )}
      </Box>

      {/* Input */}
      <PromptInput onSubmit={handleSubmit} isStreaming={isStreaming} />

      {/* Status bar */}
      <StatusBar
        model={activeModel?.displayName ?? "none"}
        provider={activeProvider?.id ?? "—"}
        sessionCost={sessionCost}
        turnCost={turnCost}
        tokenCount={tokenCount}
        isStreaming={isStreaming}
      />
    </Box>
  );
}
