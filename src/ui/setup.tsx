import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface SetupProps {
  onComplete: (provider: string, apiKey: string) => void;
  onSkip: () => void;
}

type SetupStep = "choose-provider" | "enter-key" | "codex-hint";

const PROVIDERS = [
  { id: "openai", name: "OpenAI", envVar: "OPENAI_API_KEY", hint: "sk-..." },
  { id: "anthropic", name: "Anthropic", envVar: "ANTHROPIC_API_KEY", hint: "sk-ant-..." },
  { id: "codex", name: "OpenAI (Codex login — uses ChatGPT subscription, free)", envVar: "", hint: "" },
];

export function Setup({ onComplete, onSkip }: SetupProps) {
  const [step, setStep] = useState<SetupStep>("choose-provider");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [selectedProvider, setSelectedProvider] = useState(PROVIDERS[0]);

  useInput((char, key) => {
    if (step === "choose-provider") {
      if (key.upArrow) {
        setSelectedIndex((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setSelectedIndex((i) => Math.min(PROVIDERS.length - 1, i + 1));
      } else if (key.return) {
        const provider = PROVIDERS[selectedIndex];
        if (provider.id === "codex") {
          setStep("codex-hint");
        } else {
          setSelectedProvider(provider);
          setStep("enter-key");
        }
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
    } else if (step === "codex-hint") {
      if (key.return || key.escape) {
        setStep("choose-provider");
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color="green" bold>
          brokecli setup
        </Text>
      </Box>

      {step === "choose-provider" && (
        <Box flexDirection="column">
          <Text>Select a provider:</Text>
          <Text dimColor>(arrow keys to move, enter to select, esc to skip)</Text>
          <Box flexDirection="column" marginTop={1}>
            {PROVIDERS.map((p, i) => (
              <Box key={p.id}>
                <Text color={i === selectedIndex ? "green" : undefined}>
                  {i === selectedIndex ? "❯ " : "  "}
                  {p.name}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {step === "enter-key" && (
        <Box flexDirection="column">
          <Text>
            Paste your {selectedProvider.name} API key:
          </Text>
          <Text dimColor>
            (starts with {selectedProvider.hint})
          </Text>
          <Box marginTop={1}>
            <Text color="blue">❯ </Text>
            <Text>{apiKey ? "•".repeat(apiKey.length) : ""}</Text>
            <Text color="gray">█</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>
              Enter to confirm, Esc to go back
            </Text>
          </Box>
        </Box>
      )}

      {step === "codex-hint" && (
        <Box flexDirection="column">
          <Text>
            To use your ChatGPT subscription, install and authenticate Codex CLI:
          </Text>
          <Box flexDirection="column" marginTop={1} marginLeft={2}>
            <Text color="cyan">npm install -g @openai/codex</Text>
            <Text color="cyan">codex auth login</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>
              Then restart brokecli — it will auto-detect your login.
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Press Enter or Esc to go back.</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
