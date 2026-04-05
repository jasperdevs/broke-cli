import React from "react";
import { Box, Text } from "ink";
import type { DetectionResult } from "../providers/detect.js";
import { formatDetection } from "../providers/detect.js";

interface WelcomeProps {
  version: string;
  detectedProviders: DetectionResult[];
  activeModel?: string;
  activeProvider?: string;
}

export function Welcome({ version, detectedProviders, activeModel, activeProvider }: WelcomeProps) {
  return (
    <Box flexDirection="row" marginBottom={1}>
      {/* Left: mascot + info */}
      <Box flexDirection="column" marginRight={4}>
        <Box flexDirection="column">
          <Text color="#3AC73A" bold>
            {`  ┌──────────────────┐`}
          </Text>
          <Text color="#3AC73A" bold>
            {`  │  ╔════╗  ╔════╗  │`}
          </Text>
          <Text color="#3AC73A" bold>
            {`  │  ║ $$ ║  ║ $$ ║  │`}
          </Text>
          <Text color="#3AC73A" bold>
            {`  │  ╚════╝  ╚════╝  │`}
          </Text>
          <Text color="#3AC73A" bold>
            {`  │        ▄▄        │`}
          </Text>
          <Text color="#3AC73A" bold>
            {`  └──────────────────┘`}
          </Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text color="#3AC73A" bold>
            brokecli
          </Text>
          <Text dimColor>v{version}</Text>
        </Box>
        {activeModel && (
          <Box marginTop={1}>
            <Text dimColor>
              {activeProvider}/{activeModel}
            </Text>
          </Box>
        )}
      </Box>

      {/* Right: providers + help */}
      <Box flexDirection="column">
        <Text color="#3AC73A" bold>Providers</Text>
        <Box flexDirection="column" marginTop={1}>
          {detectedProviders.length > 0 ? (
            detectedProviders.map((d) => (
              <Text key={d.id}>
                <Text color="green">  + </Text>
                <Text>{formatDetection(d)}</Text>
              </Text>
            ))
          ) : (
            <Text color="yellow">  No providers detected</Text>
          )}
        </Box>

        <Box flexDirection="column" marginTop={1}>
          <Text color="#3AC73A" bold>Quick start</Text>
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>  /model     switch model</Text>
            <Text dimColor>  /help      all commands</Text>
            <Text dimColor>  /cost      session cost</Text>
            <Text dimColor>  /clear     new conversation</Text>
            <Text dimColor>  ctrl+c     exit</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
