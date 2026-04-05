import React from "react";
import { Box, Text } from "ink";
import { formatCost, formatTokens } from "../budget/cost.js";

interface StatusBarProps {
  model: string;
  provider: string;
  sessionCost: number;
  turnCost: number;
  tokenCount: number;
  isStreaming: boolean;
}

export function StatusBar({
  model,
  provider,
  sessionCost,
  turnCost,
  tokenCount,
  isStreaming,
}: StatusBarProps) {
  return (
    <Box
      borderStyle="single"
      borderColor="#3AC73A"
      paddingX={1}
      justifyContent="space-between"
    >
      <Box gap={1}>
        <Text color="#3AC73A" bold>
          {model}
        </Text>
        {isStreaming && <Text color="yellow">●</Text>}
      </Box>
      <Box gap={2}>
        {turnCost > 0 && (
          <Text dimColor>turn {formatCost(turnCost)}</Text>
        )}
        <Text color="#3AC73A">{formatCost(sessionCost)}</Text>
        <Text dimColor>{formatTokens(tokenCount)} tok</Text>
      </Box>
    </Box>
  );
}
