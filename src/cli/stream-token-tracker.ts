import { estimateTextTokens } from "../ai/tokens.js";

export function createStreamTokenTracker(
  setStreamTokens: (tokens: number) => void,
  executionModelId: string,
  getText: () => string,
): {
  schedule: () => void;
  flush: () => void;
} {
  let streamTokenFlushTimer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule: () => {
      if (streamTokenFlushTimer) return;
      streamTokenFlushTimer = setTimeout(() => {
        streamTokenFlushTimer = null;
        setStreamTokens(estimateTextTokens(getText(), executionModelId));
      }, 80);
    },
    flush: () => {
      if (streamTokenFlushTimer) clearTimeout(streamTokenFlushTimer);
      streamTokenFlushTimer = null;
      setStreamTokens(estimateTextTokens(getText(), executionModelId));
    },
  };
}
