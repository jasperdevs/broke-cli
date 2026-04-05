import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { isCodexAvailable } from "../providers/adapters/codex-auth.js";

interface SetupProps {
  onComplete: (provider: string, apiKey: string) => void;
  onCodexLogin: () => void;
  onSkip: () => void;
  isActive?: boolean;
}

type SetupStep = "choose-provider" | "enter-key";

interface ProviderOption {
  id: string;
  name: string;
  hint: string;
  category: "cloud" | "aggregator" | "local" | "oauth";
}

const PROVIDERS: ProviderOption[] = [
  // OAuth (free)
  { id: "codex-oauth", name: "Codex OAuth (ChatGPT sub — free)", hint: "", category: "oauth" },
  // Cloud providers
  { id: "openai", name: "OpenAI", hint: "sk-...", category: "cloud" },
  { id: "anthropic", name: "Anthropic", hint: "sk-ant-...", category: "cloud" },
  { id: "google", name: "Google Gemini", hint: "AI...", category: "cloud" },
  { id: "xai", name: "xAI (Grok)", hint: "xai-...", category: "cloud" },
  { id: "deepseek", name: "DeepSeek", hint: "sk-...", category: "cloud" },
  { id: "mistral", name: "Mistral", hint: "...", category: "cloud" },
  { id: "groq", name: "Groq", hint: "gsk_...", category: "cloud" },
  { id: "together", name: "Together AI", hint: "...", category: "cloud" },
  { id: "fireworks", name: "Fireworks AI", hint: "...", category: "cloud" },
  { id: "cerebras", name: "Cerebras", hint: "...", category: "cloud" },
  { id: "perplexity", name: "Perplexity", hint: "pplx-...", category: "cloud" },
  { id: "azure", name: "Azure OpenAI", hint: "...", category: "cloud" },
  { id: "bedrock", name: "AWS Bedrock", hint: "...", category: "cloud" },
  { id: "github-models", name: "GitHub Models", hint: "ghp_...", category: "cloud" },
  // Aggregators
  { id: "openrouter", name: "OpenRouter (many models, one key)", hint: "sk-or-...", category: "aggregator" },
  // Local
  { id: "ollama", name: "Ollama (local)", hint: "http://localhost:11434", category: "local" },
  { id: "lmstudio", name: "LM Studio (local)", hint: "http://localhost:1234", category: "local" },
  { id: "custom", name: "Custom OpenAI-compatible endpoint", hint: "http://...", category: "local" },
];

export function Setup({ onComplete, onCodexLogin, onSkip, isActive = true }: SetupProps) {
  const [step, setStep] = useState<SetupStep>("choose-provider");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [inputField, setInputField] = useState<"key" | "url">("key");
  const selectedProvider = PROVIDERS[selectedIndex];

  const codexReady = isCodexAvailable();

  // Visible range for scrolling
  const visibleCount = 12;
  const scrollOffset = Math.max(0, Math.min(selectedIndex - Math.floor(visibleCount / 2), PROVIDERS.length - visibleCount));
  const visibleProviders = PROVIDERS.slice(scrollOffset, scrollOffset + visibleCount);

  useInput((char, key) => {
    if (step === "choose-provider") {
      if (key.upArrow) {
        setSelectedIndex((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setSelectedIndex((i) => Math.min(PROVIDERS.length - 1, i + 1));
      } else if (key.return) {
        const provider = PROVIDERS[selectedIndex];
        if (provider.id === "codex-oauth") {
          onCodexLogin();
        } else if (provider.category === "local" || provider.id === "custom") {
          setInputField("url");
          setStep("enter-key");
        } else {
          setInputField("key");
          setStep("enter-key");
        }
      } else if (key.escape) {
        onSkip();
      }
    } else if (step === "enter-key") {
      if (key.return) {
        if (inputField === "url") {
          const url = baseUrl.trim() || selectedProvider.hint;
          onComplete(selectedProvider.id, `url:${url}`);
        } else {
          const trimmed = apiKey.trim();
          if (trimmed) {
            onComplete(selectedProvider.id, trimmed);
          }
        }
      } else if (key.escape) {
        setStep("choose-provider");
        setApiKey("");
        setBaseUrl("");
      } else if (key.backspace || key.delete) {
        if (inputField === "url") {
          setBaseUrl((prev) => prev.slice(0, -1));
        } else {
          setApiKey((prev) => prev.slice(0, -1));
        }
      } else if (char && !key.ctrl && !key.meta) {
        if (inputField === "url") {
          setBaseUrl((prev) => prev + char);
        } else {
          setApiKey((prev) => prev + char);
        }
      }
    }
  }, { isActive });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text color="#3AC73A" bold>
        brokecli setup
      </Text>
      <Text color="#3AC73A" dimColor>────────────────────</Text>

      {codexReady && step === "choose-provider" && (
        <Box marginTop={1}>
          <Text color="#3AC73A">
            ● Codex detected — press Esc to skip and use ChatGPT for free
          </Text>
        </Box>
      )}

      {step === "choose-provider" && (
        <Box flexDirection="column" marginTop={1}>
          <Text>Select a provider <Text dimColor>(↑↓ Enter Esc)</Text></Text>
          <Box flexDirection="column" marginTop={1}>
            {visibleProviders.map((p) => {
              const globalIdx = PROVIDERS.indexOf(p);
              const isSelected = globalIdx === selectedIndex;
              return (
                <Box key={p.id}>
                  <Text color={isSelected ? "#3AC73A" : "gray"}>
                    {isSelected ? "❯ " : "  "}
                    {p.name}
                  </Text>
                </Box>
              );
            })}
            {PROVIDERS.length > visibleCount && (
              <Text dimColor>  ↕ {PROVIDERS.length - visibleCount} more...</Text>
            )}
          </Box>
        </Box>
      )}

      {step === "enter-key" && (
        <Box flexDirection="column" marginTop={1}>
          {inputField === "url" ? (
            <>
              <Text>
                Enter <Text color="#3AC73A">{selectedProvider.name}</Text> endpoint URL:
              </Text>
              <Text dimColor>default: {selectedProvider.hint}</Text>
              <Box marginTop={1}>
                <Text color="#3AC73A">❯ </Text>
                <Text>{baseUrl || ""}</Text>
                <Text color="gray">█</Text>
              </Box>
            </>
          ) : (
            <>
              <Text>
                Enter <Text color="#3AC73A">{selectedProvider.name}</Text> API key:
              </Text>
              <Text dimColor>starts with {selectedProvider.hint}</Text>
              <Box marginTop={1}>
                <Text color="#3AC73A">❯ </Text>
                <Text>{apiKey ? "•".repeat(Math.min(apiKey.length, 40)) : ""}</Text>
                <Text color="gray">█</Text>
              </Box>
            </>
          )}
          <Text dimColor>Enter to confirm, Esc to go back</Text>
        </Box>
      )}
    </Box>
  );
}
