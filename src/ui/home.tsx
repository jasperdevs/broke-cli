import React from "react";
import { Box, Text } from "ink";
import type { DetectionResult } from "../providers/detect.js";
import { formatDetection } from "../providers/detect.js";

const TIPS = [
  "Use --broke to auto-route to the cheapest model",
  "/model to switch models mid-conversation",
  "Set ANTHROPIC_API_KEY or OPENAI_API_KEY to get started",
  "Run codex auth login to use ChatGPT subscription for free",
  "/cost to see how much you've spent this session",
  "Ollama models are auto-detected when running locally",
  "Set budget.daily in config to cap your daily spend",
];

interface HomeProps {
  version: string;
  detectedProviders: DetectionResult[];
  activeModel?: string;
  activeProvider?: string;
  rows: number;
  cols: number;
}

export function Home({
  version,
  detectedProviders,
  activeModel,
  activeProvider,
  rows,
  cols,
}: HomeProps) {
  const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
  const padTop = Math.max(1, Math.floor((rows - 20) / 3));

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Push content toward center */}
      <Box height={padTop} />

      {/* Centered branding */}
      <Box flexDirection="column" alignItems="center">
        <Text color="#3AC73A" bold>
          {"  ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄  "}
        </Text>
        <Text color="#3AC73A" bold>
          {"  █ "}
          <Text color="#e8e8e8">▐</Text>
          <Text color="#0a0a0a">▀▀▀</Text>
          <Text color="#3AC73A">{"  "}</Text>
          <Text color="#e8e8e8">▐</Text>
          <Text color="#0a0a0a">▀▀▀</Text>
          <Text color="#3AC73A">{" █  "}</Text>
        </Text>
        <Text color="#3AC73A" bold>
          {"  █ "}
          <Text color="#0a0a0a">▄▄</Text>
          <Text color="#e8e8e8">█</Text>
          <Text color="#3AC73A">{"  "}</Text>
          <Text color="#0a0a0a">▄▄</Text>
          <Text color="#e8e8e8">█</Text>
          <Text color="#3AC73A">{" █  "}</Text>
        </Text>
        <Text color="#3AC73A" bold>
          {"  █ "}
          <Text color="#0a0a0a">▀▀▀</Text>
          <Text color="#3AC73A">{"  "}</Text>
          <Text color="#0a0a0a">▀▀▀</Text>
          <Text color="#3AC73A">{" █  "}</Text>
        </Text>
        <Text color="#3AC73A" bold>
          {"  ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀  "}
        </Text>
        <Text color="#3AC73A" bold>
          {"     ▀▀▀▀    ▀▀▀▀    "}
        </Text>
      </Box>

      <Box flexDirection="column" alignItems="center" marginTop={1}>
        <Text color="#3AC73A" bold>
          brokecli
        </Text>
        <Text dimColor>v{version}</Text>
      </Box>

      {/* Provider status */}
      {detectedProviders.length > 0 && (
        <Box flexDirection="column" alignItems="center" marginTop={1}>
          {detectedProviders.map((d) => (
            <Text key={d.id} dimColor>
              <Text color="#3AC73A">● </Text>
              {formatDetection(d)}
            </Text>
          ))}
        </Box>
      )}

      {activeModel && activeProvider && (
        <Box justifyContent="center" marginTop={1}>
          <Text dimColor>
            {activeProvider} · {activeModel}
          </Text>
        </Box>
      )}

      {/* Spacer */}
      <Box flexGrow={1} />

      {/* Tip */}
      <Box justifyContent="center" marginBottom={1}>
        <Text dimColor>
          <Text color="#3AC73A">● Tip</Text> {tip}
        </Text>
      </Box>
    </Box>
  );
}
