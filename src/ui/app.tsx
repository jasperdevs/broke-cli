import React, { useState, useCallback } from "react";
import { Box, Static, Text, useApp } from "ink";
import type { ModelMessage } from "ai";
import type { Provider, ModelInfo, TokenUsage } from "../providers/types.js";
import { handleUserInput } from "../orchestrator.js";
import { Message, StreamingMessage } from "./message-stream.js";
import { PromptInput } from "./prompt-input.js";
import { StatusBar } from "./status-bar.js";
import { Setup } from "./setup.js";
import { formatCost } from "../budget/cost.js";
import { buildProviders } from "../providers/registry.js";

interface CompletedMessage {
  role: "user" | "assistant";
  content: string;
  id: number;
}

interface AppProps {
  provider?: Provider;
  model?: ModelInfo;
  providers: Provider[];
}

export function App({ provider: initialProvider, model: initialModel, providers: initialProviders }: AppProps) {
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
          case "model": {
            if (!arg) {
              // List available models
              const lines = ["**Available models:**", ""];
              for (const p of providers) {
                for (const m of p.listModels()) {
                  const current =
                    activeProvider?.id === p.id && activeModel?.id === m.id
                      ? " ← current"
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
            // Try to switch model
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
          case "help":
            addSystemMessage(
              [
                "**Commands:**",
                "  `/model [id]` — list or switch models",
                "  `/clear` — clear conversation",
                "  `/cost` — show session cost",
                "  `/help` — show this help",
                "  `/exit` — quit",
              ].join("\n"),
            );
            return;
          case "cost":
            addSystemMessage(
              `Session cost: **${formatCost(sessionCost)}** | Tokens: **${tokenCount}**`,
            );
            return;
        }
      }

      // Check if we have a provider
      if (!activeProvider || !activeModel) {
        addSystemMessage(
          [
            "**No provider configured.** Set up one of:",
            "",
            "  1. `export ANTHROPIC_API_KEY=sk-ant-...`",
            "  2. `export OPENAI_API_KEY=sk-...`",
            "  3. Run `codex auth login` (uses ChatGPT subscription — free)",
            "  4. Add to `~/.brokecli/config.jsonc`:",
            "     ```json",
            '     { "providers": { "openai": { "apiKey": "sk-..." } } }',
            "     ```",
            "",
            "Then restart brokecli.",
          ].join("\n"),
        );
        return;
      }

      // Add user message to completed
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
            onText: (text) => {
              setStreamingText((prev) => prev + text);
            },
            onError: (err) => {
              setError(err.message);
            },
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

  const hasProvider = activeProvider && activeModel;

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box marginBottom={1}>
        <Text color="green" bold>
          brokecli
        </Text>
        <Text dimColor> — AI coding that doesn't waste your money</Text>
      </Box>

      {/* Setup flow when no provider */}
      {showSetup && (
        <Setup
          onComplete={(providerId, apiKey) => {
            const newProviders = buildProviders([{
              id: providerId,
              name: providerId,
              isLocal: false,
              apiKey,
              availableModels: [],
            }]);
            if (newProviders.length > 0) {
              const p = newProviders[0];
              const m = p.listModels()[0];
              setActiveProvider(p);
              setActiveModel(m);
              setProviders((prev) => [...prev, p]);
              setShowSetup(false);
              addSystemMessage(`Connected to **${p.name}** — using ${m.displayName}. Start chatting!`);
            }
          }}
          onSkip={() => setShowSetup(false)}
        />
      )}

      {/* Completed messages */}
      <Static items={completedMessages}>
        {(msg) => (
          <Box key={msg.id}>
            <Message role={msg.role} content={msg.content} />
          </Box>
        )}
      </Static>

      {/* Currently streaming */}
      {isStreaming && <StreamingMessage content={streamingText} />}

      {/* Error display */}
      {error && (
        <Box marginBottom={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}

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
