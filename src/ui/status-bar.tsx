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
      borderColor="gray"
      paddingX={1}
      justifyContent="space-between"
    >
      <Box gap={1}>
        <Text color="cyan" bold>
          {provider}/{model}
        </Text>
        {isStreaming && <Text color="yellow">streaming...</Text>}
      </Box>
      <Box gap={1}>
        {turnCost > 0 && (
          <Text color="green">turn: {formatCost(turnCost)}</Text>
        )}
        <Text color="green">session: {formatCost(sessionCost)}</Text>
        <Text dimColor>{formatTokens(tokenCount)} tokens</Text>
      </Box>
    </Box>
  );
}
