import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";

interface PromptInputProps {
  onSubmit: (input: string) => void;
  isStreaming: boolean;
  isActive?: boolean;
  placeholder?: string;
}

export function PromptInput({
  onSubmit,
  isStreaming,
  isActive = true,
  placeholder = 'Ask anything... "Fix the bug in parser.ts"',
}: PromptInputProps) {
  const [input, setInput] = useState("");
  const { exit } = useApp();

  // Handle Ctrl+C
  useInput((_char, key) => {
    if (key.ctrl && _char === "c") {
      exit();
    }
  }, { isActive });

  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (trimmed) {
      onSubmit(trimmed);
      setInput("");
    }
  };

  return (
    <Box borderStyle="single" borderColor={isActive ? "#3AC73A" : "gray"} paddingX={1}>
      <Box flexDirection="column">
        <Box>
          {isActive && !isStreaming ? (
            <TextInput
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              placeholder={placeholder}
            />
          ) : isStreaming ? (
            <Text color="yellow">● generating...</Text>
          ) : (
            <Text dimColor>{placeholder}</Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
