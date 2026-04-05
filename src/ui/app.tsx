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

  const addSystemMessage = useCallback(
    (content: string) => {
      setCompletedMessages((prev) => [
        ...prev,
        { role: "assistant", content, id: msgId },
      ]);
      setMsgId((id) => id + 1);
    },
    [msgId],
  );

  const handleSubmit = useCallback(
    async (input: string) => {
      // Handle slash commands
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
              const lines = ["**Available models:**", ""];
              for (const p of providers) {
                for (const m of p.listModels()) {
                  const current =
                    activeProvider?.id === p.id && activeModel?.id === m.id
                      ? " **(active)**"
                      : "";
                  lines.push(
                    `  \`${p.id}/${m.id}\` — ${m.displayName} (${formatCost(m.pricing.inputPerMTok)}/MTok in)${current}`,
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
                `Model not found: \`${arg}\`. Run \`/model\` to see available models.`,
              );
            }
            return;
          }
          case "cost":
            addSystemMessage(
              `Session cost: **${formatCost(sessionCost)}** | Tokens: **${tokenCount}**`,
            );
            return;
          case "help":
            addSystemMessage(
              [
                "**Commands:**",
                "  `/model [id]` — list or switch models",
                "  `/setup` — configure a provider",
                "  `/cost` — show session cost",
                "  `/clear` — clear conversation",
                "  `/help` — show this help",
                "  `/exit` — quit",
              ].join("\n"),
            );
            return;
        }
      }

      // Check if we have a provider
      if (!activeProvider || !activeModel) {
        addSystemMessage(
          "No provider configured. Run `/setup` to add one, or set an API key env var and restart.",
        );
        return;
      }

      // Send to LLM
      setCompletedMessages((prev) => [
        ...prev,
        { role: "user", content: input, id: msgId },
      ]);
      setMsgId((id) => id + 1);
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
                { role: "assistant", content: fullText, id: msgId + 1 },
              ]);
              setMsgId((id) => id + 2);
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
    [history, activeProvider, activeModel, providers, msgId, exit, sessionCost, tokenCount, addSystemMessage],
  );

  // Setup mode
  if (showSetup) {
    return (
      <Box flexDirection="column" height={process.stdout.rows}>
        <Setup
          onComplete={(providerId, apiKey) => {
            const newProviders = buildProviders([
              {
                id: providerId,
                name: providerId,
                isLocal: false,
                apiKey,
                availableModels: [],
              },
            ]);
            if (newProviders.length > 0) {
              const p = newProviders[0];
              const m = p.listModels()[0];
              setActiveProvider(p);
              setActiveModel(m);
              setProviders((prev) => [...prev, p]);
              setShowSetup(false);
              addSystemMessage(
                `Connected to **${p.name}** — using ${m.displayName}. Start chatting!`,
              );
            }
          }}
          onSkip={() => setShowSetup(false)}
        />
      </Box>
    );
  }

  const hasProvider = activeProvider && activeModel;

  return (
    <Box flexDirection="column" height={process.stdout.rows}>
      {/* Welcome header */}
      <Welcome
        version={version}
        detectedProviders={detectedProviders}
        activeModel={hasProvider ? activeModel.displayName : undefined}
        activeProvider={hasProvider ? activeProvider.id : undefined}
      />

      {/* Chat area */}
      <Box flexDirection="column" flexGrow={1}>
        {/* Completed messages */}
        <Static items={completedMessages}>
          {(msg) => (
            <Box key={msg.id}>
              <Message role={msg.role} content={msg.content} />
            </Box>
          )}
        </Static>

        {/* Streaming */}
        {isStreaming && <StreamingMessage content={streamingText} />}

        {/* Error */}
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
