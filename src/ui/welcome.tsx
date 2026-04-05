import React from "react";
import { Box, Text } from "ink";
import type { DetectionResult } from "../providers/detect.js";
import { formatDetection } from "../providers/detect.js";
import { MASCOT_LINES } from "./mascot.js";

interface WelcomeProps {
  version: string;
  detectedProviders: DetectionResult[];
  activeModel?: string;
  activeProvider?: string;
}

export function Welcome({
  version,
  detectedProviders,
  activeModel,
  activeProvider,
}: WelcomeProps) {
  return (
    <Box
      borderStyle="round"
      borderColor="#3AC73A"
      paddingX={1}
      paddingY={0}
      marginBottom={1}
      flexDirection="row"
      gap={3}
    >
      {/* Left: mascot + name */}
      <Box flexDirection="column">
        {MASCOT_LINES.map((line, i) => (
          <Text key={i}>{line}</Text>
        ))}
        <Text color="#3AC73A" bold>
          {" "}brokecli <Text dimColor>v{version}</Text>
        </Text>
        {activeModel && activeProvider && (
          <Text dimColor> {activeProvider} · {activeModel}</Text>
        )}
      </Box>

      {/* Right: providers + commands */}
      <Box flexDirection="column" gap={1} marginTop={1}>
        <Box flexDirection="column">
          <Text color="#3AC73A" bold>
            Providers
          </Text>
          {detectedProviders.length > 0 ? (
            detectedProviders.map((d) => (
              <Text key={d.id}>
                <Text color="#3AC73A"> ● </Text>
                <Text>{formatDetection(d)}</Text>
              </Text>
            ))
          ) : (
            <Box flexDirection="column">
              <Text color="yellow"> ○ No providers detected</Text>
              <Text dimColor>   /setup to configure</Text>
            </Box>
          )}
        </Box>

        <Box flexDirection="column">
          <Text color="#3AC73A" bold>
            Commands
          </Text>
          <Text dimColor> /model     switch model</Text>
          <Text dimColor> /setup     add provider</Text>
          <Text dimColor> /cost      session spend</Text>
          <Text dimColor> /help      all commands</Text>
        </Box>
      </Box>
    </Box>
  );
}
