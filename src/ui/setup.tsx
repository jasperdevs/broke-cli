import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { isCodexAvailable } from "../providers/adapters/codex-auth.js";

interface SetupProps {
  onComplete: (provider: string, apiKey: string) => void;
  onSkip: () => void;
}

type SetupStep = "choose-provider" | "enter-key";

const PROVIDERS = [
  { id: "openai", name: "OpenAI", hint: "sk-..." },
  { id: "anthropic", name: "Anthropic", hint: "sk-ant-..." },
  { id: "openrouter", name: "OpenRouter (many models, one key)", hint: "sk-or-..." },
];

export function Setup({ onComplete, onSkip }: SetupProps) {
  const [step, setStep] = useState<SetupStep>("choose-provider");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [selectedProvider, setSelectedProvider] = useState(PROVIDERS[0]);

  // Check codex on render
  const codexReady = isCodexAvailable();

  useInput((char, key) => {
    if (step === "choose-provider") {
      if (key.upArrow) {
        setSelectedIndex((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setSelectedIndex((i) => Math.min(PROVIDERS.length - 1, i + 1));
      } else if (key.return) {
        const provider = PROVIDERS[selectedIndex];
        setSelectedProvider(provider);
        setStep("enter-key");
      } else if (key.escape) {
        onSkip();
      }
    } else if (step === "enter-key") {
      if (key.return) {
        const trimmed = apiKey.trim();
        if (trimmed) {
          onComplete(selectedProvider.id, trimmed);
        }
      } else if (key.escape) {
        setStep("choose-provider");
        setApiKey("");
      } else if (key.backspace || key.delete) {
        setApiKey((prev) => prev.slice(0, -1));
      } else if (char && !key.ctrl && !key.meta) {
        setApiKey((prev) => prev + char);
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text color="#3AC73A" bold>
        brokecli setup
      </Text>
      <Text dimColor>────────────────</Text>

      {codexReady && (
        <Box marginTop={1} marginBottom={1}>
          <Text color="#3AC73A">
            ● Codex OAuth detected — you can skip setup (Esc) and use your ChatGPT subscription for free.
          </Text>
        </Box>
      )}

      {step === "choose-provider" && (
        <Box flexDirection="column" marginTop={1}>
          <Text>Select a provider:</Text>
          <Text dimColor>↑↓ to move, Enter to select, Esc to skip</Text>
          <Box flexDirection="column" marginTop={1}>
            {PROVIDERS.map((p, i) => (
              <Box key={p.id}>
                <Text color={i === selectedIndex ? "#3AC73A" : "gray"}>
                  {i === selectedIndex ? "❯ " : "  "}
                  {p.name}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {step === "enter-key" && (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            Paste your <Text color="#3AC73A">{selectedProvider.name}</Text> API key:
          </Text>
          <Text dimColor>starts with {selectedProvider.hint}</Text>
          <Box marginTop={1}>
            <Text color="#3AC73A">❯ </Text>
            <Text>{apiKey ? "•".repeat(Math.min(apiKey.length, 40)) : ""}</Text>
            <Text color="gray">█</Text>
          </Box>
          <Text dimColor>Enter to confirm, Esc to go back</Text>
        </Box>
      )}
    </Box>
  );
}
