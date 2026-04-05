import React, { useState, useCallback } from "react";
import { Box, Static, Text, useApp } from "ink";
import type { ModelMessage } from "ai";
import type { Provider, ModelInfo, TokenUsage } from "../providers/types.js";
import { handleUserInput } from "../orchestrator.js";
import { Message, StreamingMessage } from "./message-stream.js";
import { PromptInput } from "./prompt-input.js";
import { StatusBar } from "./status-bar.js";

interface CompletedMessage {
  role: "user" | "assistant";
  content: string;
  id: number;
}

interface AppProps {
  provider: Provider;
  model: ModelInfo;
}

export function App({ provider, model }: AppProps) {
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

  const handleSubmit = useCallback(
    async (input: string) => {
      // Handle slash commands
      if (input.startsWith("/")) {
        const [cmd, ...args] = input.slice(1).split(" ");
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
          case "help":
            setCompletedMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content:
                  "Commands: /clear, /exit, /help, /model\nMore commands coming in future phases.",
                id: msgId,
              },
            ]);
            setMsgId((id) => id + 1);
            return;
          case "model":
            setCompletedMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: `Current model: ${provider.id}/${model.id} (${model.displayName})`,
                id: msgId,
              },
            ]);
            setMsgId((id) => id + 1);
            return;
        }
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
        const result = await handleUserInput(input, history, { provider, model }, {
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
        });

        setHistory(result.messages);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setIsStreaming(false);
      }
    },
    [history, provider, model, msgId, exit],
  );

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box marginBottom={1}>
        <Text color="green" bold>
          brokecli
        </Text>
        <Text dimColor> — AI coding that doesn't waste your money</Text>
      </Box>

      {/* Completed messages (won't re-render) */}
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
        model={model.displayName}
        provider={provider.id}
        sessionCost={sessionCost}
        turnCost={turnCost}
        tokenCount={tokenCount}
        isStreaming={isStreaming}
      />
    </Box>
  );
}
