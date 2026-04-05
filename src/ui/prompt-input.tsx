import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface PromptInputProps {
  onSubmit: (input: string) => void;
  isStreaming: boolean;
}

export function PromptInput({ onSubmit, isStreaming }: PromptInputProps) {
  const [input, setInput] = useState("");

  useInput(
    (char, key) => {
      if (isStreaming) return;

      if (key.return) {
        const trimmed = input.trim();
        if (trimmed) {
          onSubmit(trimmed);
          setInput("");
        }
        return;
      }

      if (key.backspace || key.delete) {
        setInput((prev) => prev.slice(0, -1));
        return;
      }

      // Ctrl+C is handled by Ink's exit
      if (key.ctrl && char === "c") return;

      // Regular character input
      if (char && !key.ctrl && !key.meta) {
        setInput((prev) => prev + char);
      }
    },
    { isActive: !isStreaming },
  );

  if (isStreaming) {
    return null;
  }

  return (
    <Box>
      <Text color="blue" bold>
        {"❯ "}
      </Text>
      <Text>{input}</Text>
      <Text color="gray">█</Text>
    </Box>
  );
}
