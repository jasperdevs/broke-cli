import React from "react";
import { Box, Text } from "ink";
import { renderMarkdown } from "../render/markdown.js";

interface MessageProps {
  role: "user" | "assistant";
  content: string;
}

export function Message({ role, content }: MessageProps) {
  const label = role === "user" ? "you" : "brokecli";
  const color = role === "user" ? "white" : "#3AC73A";

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={color} bold>
        {label}
      </Text>
      <Box>
        <Text>{role === "assistant" ? renderMarkdown(content) : content}</Text>
      </Box>
    </Box>
  );
}

interface StreamingMessageProps {
  content: string;
}

export function StreamingMessage({ content }: StreamingMessageProps) {
  if (!content) return null;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="#3AC73A" bold>
        brokecli
      </Text>
      <Box>
        <Text>{renderMarkdown(content)}</Text>
      </Box>
    </Box>
  );
}
