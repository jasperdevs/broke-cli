import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { DetectionResult } from "../providers/detect.js";
import { formatDetection } from "../providers/detect.js";

const TIPS = [
  "Use --broke to auto-route to the cheapest model",
  "/model to switch models mid-conversation",
  "Run codex auth login to use ChatGPT subscription for free",
  "/cost to see how much you've spent this session",
  "Ollama models are auto-detected when running locally",
  "Set budget.daily in config to cap your daily spend",
  "/setup to add or change providers",
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
}: HomeProps) {
  const tip = useMemo(() => TIPS[Math.floor(Math.random() * TIPS.length)], []);
  const padTop = Math.max(1, Math.floor((rows - 16) / 3));

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box height={padTop} />

      {/* Branding — clean text like OpenCode */}
      <Box flexDirection="column" alignItems="center">
        <Text color="#3AC73A" bold>
          {"  █▄▄ █▀▄ █▀█ █▄▀ █▀▀ █▀▀ █   █"}
        </Text>
        <Text color="#3AC73A" bold>
          {"  █▄█ █▀▄ █▄█ █ █ ██▄ █▄▄ █▄▄ █"}
        </Text>
      </Box>

      <Box justifyContent="center" marginTop={1}>
        <Text dimColor>v{version} — AI coding that doesn't waste your money</Text>
      </Box>

      {/* Detected providers */}
      {detectedProviders.length > 0 && (
        <Box flexDirection="column" alignItems="center" marginTop={2}>
          {detectedProviders.map((d) => (
            <Text key={d.id}>
              <Text color="#3AC73A">● </Text>
              <Text>{formatDetection(d)}</Text>
            </Text>
          ))}
        </Box>
      )}

      {detectedProviders.length === 0 && (
        <Box justifyContent="center" marginTop={2}>
          <Text color="yellow">No providers detected — run /setup or set an API key env var</Text>
        </Box>
      )}

      {/* Active model */}
      {activeModel && activeProvider && (
        <Box justifyContent="center" marginTop={1}>
          <Text>
            <Text color="#3AC73A" bold>{activeProvider}</Text>
            <Text dimColor> · </Text>
            <Text bold>{activeModel}</Text>
          </Text>
        </Box>
      )}

      <Box flexGrow={1} />

      {/* Tip */}
      <Box justifyContent="center" marginBottom={1}>
        <Text>
          <Text color="#3AC73A">● Tip </Text>
          <Text dimColor>{tip}</Text>
        </Text>
      </Box>
    </Box>
  );
}
