import React, { useState, useCallback } from "react";
import { Box, Text, useInput, useApp } from "ink";

interface PromptInputProps {
  onSubmit: (input: string) => void;
  isStreaming: boolean;
}

export function PromptInput({ onSubmit, isStreaming }: PromptInputProps) {
  const [input, setInput] = useState("");
  const { exit } = useApp();

  useInput((char, key) => {
    if (isStreaming) {
      // Allow Ctrl+C during streaming
      if (key.ctrl && char === "c") {
        exit();
      }
      return;
    }

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

    if (key.ctrl && char === "c") {
      exit();
      return;
    }

    // Clear line
    if (key.ctrl && char === "u") {
      setInput("");
      return;
    }

    // Regular character input (including /)
    if (char && !key.ctrl && !key.meta) {
      setInput((prev) => prev + char);
    }
  });

  return (
    <Box marginTop={1}>
      <Text color="#3AC73A" bold>
        {"❯ "}
      </Text>
      <Text>{input}</Text>
      <Text color="gray">{isStreaming ? "" : "█"}</Text>
    </Box>
  );
}
