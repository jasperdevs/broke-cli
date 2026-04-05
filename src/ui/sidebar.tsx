import React from "react";
import { Box, Text } from "ink";
import type { DetectionResult } from "../providers/detect.js";
import { formatDetection } from "../providers/detect.js";
import { formatCost, formatTokens } from "../budget/cost.js";

interface SidebarProps {
  activeModel?: string;
  activeProvider?: string;
  sessionCost: number;
  tokenCount: number;
  detectedProviders: DetectionResult[];
}

export function Sidebar({
  activeModel,
  activeProvider,
  sessionCost,
  tokenCount,
  detectedProviders,
}: SidebarProps) {
  return (
    <Box
      flexDirection="column"
      width={30}
      borderStyle="single"
      borderColor="#3AC73A"
      paddingX={1}
    >
      {/* Session info */}
      <Text color="#3AC73A" bold>
        Session
      </Text>
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>
          Model: <Text color="white">{activeModel ?? "none"}</Text>
        </Text>
        <Text dimColor>
          Provider: <Text color="white">{activeProvider ?? "—"}</Text>
        </Text>
      </Box>

      {/* Cost */}
      <Box flexDirection="column" marginTop={1}>
        <Text color="#3AC73A" bold>
          Cost
        </Text>
        <Text dimColor>
          Spent: <Text color="#3AC73A">{formatCost(sessionCost)}</Text>
        </Text>
        <Text dimColor>
          Tokens: <Text color="white">{formatTokens(tokenCount)}</Text>
        </Text>
      </Box>

      {/* Providers */}
      <Box flexDirection="column" marginTop={1}>
        <Text color="#3AC73A" bold>
          Providers
        </Text>
        {detectedProviders.map((d) => (
          <Text key={d.id} dimColor>
            <Text color="#3AC73A">● </Text>
            {d.name}
          </Text>
        ))}
        {detectedProviders.length === 0 && (
          <Text dimColor>none — /setup</Text>
        )}
      </Box>

      {/* Spacer */}
      <Box flexGrow={1} />

      {/* Help */}
      <Box flexDirection="column">
        <Text dimColor>/help for commands</Text>
      </Box>
    </Box>
  );
}
