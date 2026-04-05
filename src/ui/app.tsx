import React, { useState, useCallback, useEffect } from "react";
import { Box, Static, Text, useApp, useStdout } from "ink";
import type { ModelMessage } from "ai";
import type { Provider, ModelInfo } from "../providers/types.js";
import type { DetectionResult } from "../providers/detect.js";
import { handleUserInput } from "../orchestrator.js";
import { Message, StreamingMessage } from "./message-stream.js";
import { PromptInput } from "./prompt-input.js";
import { StatusBar } from "./status-bar.js";
import { Home } from "./home.js";
import { Sidebar } from "./sidebar.js";
import { Setup } from "./setup.js";
import { formatCost } from "../budget/cost.js";
import { buildProviders } from "../providers/registry.js";
import { loadCodexAuth } from "../providers/adapters/codex-auth.js";
import { version } from "../../package.json";

interface CompletedMessage {
  role: "user" | "assistant";
  content: string;
  id: number;
}

type View = "home" | "chat" | "setup";

interface AppProps {
  provider?: Provider;
  model?: ModelInfo;
  providers: Provider[];
  detectedProviders: DetectionResult[];
}

export function App({
  provider: initialProvider,
  model: initialModel,
  providers: initialProviders,
  detectedProviders,
}: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [rows, setRows] = useState(stdout?.rows ?? 24);
  const [cols, setCols] = useState(stdout?.columns ?? 80);

  useEffect(() => {
    const onResize = () => {
      setRows(stdout?.rows ?? 24);
      setCols(stdout?.columns ?? 80);
    };
    stdout?.on("resize", onResize);
    return () => { stdout?.off("resize", onResize); };
  }, [stdout]);

  const [completedMessages, setCompletedMessages] = useState<CompletedMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [history, setHistory] = useState<ModelMessage[]>([]);
  const [sessionCost, setSessionCost] = useState(0);
  const [turnCost, setTurnCost] = useState(0);
  const [tokenCount, setTokenCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [activeProvider, setActiveProvider] = useState<Provider | undefined>(initialProvider);
  const [activeModel, setActiveModel] = useState<ModelInfo | undefined>(initialModel);
  const [providers, setProviders] = useState<Provider[]>(initialProviders);
  const [view, setView] = useState<View>(initialProvider ? "home" : "setup");

  const addSystemMessage = useCallback((content: string) => {
    setCompletedMessages((prev) => [
      ...prev,
      { role: "assistant" as const, content, id: Date.now() },
    ]);
  }, []);

  const handleSetupComplete = useCallback(
    (providerId: string, apiKey: string) => {
      const newProviders = buildProviders([
        { id: providerId, name: providerId, isLocal: false, apiKey, availableModels: [] },
      ]);
      if (newProviders.length > 0) {
        const p = newProviders[0];
        const m = p.listModels()[0];
        setActiveProvider(p);
        setActiveModel(m);
        setProviders((prev) => [...prev, p]);
        setView("home");
      }
    },
    [],
  );

  const handleCodexLogin = useCallback(() => {
    const auth = loadCodexAuth();
    if (auth) {
      handleSetupComplete("openai", auth.access_token);
    } else {
      addSystemMessage(
        "Codex not authenticated. Run `codex auth login` in another terminal, then /setup again.",
      );
      setView("home");
    }
  }, [handleSetupComplete, addSystemMessage]);

  const handleSubmit = useCallback(
    async (input: string) => {
      // Slash commands
      if (input.startsWith("/")) {
        const [cmd, ...args] = input.slice(1).split(" ");
        const arg = args.join(" ");

        switch (cmd) {
          case "clear":
            setCompletedMessages([]);
            setHistory([]);
            setSessionCost(0);
            setTokenCount(0);
            setView("home");
            return;
          case "exit": case "quit": case "q":
            exit();
            return;
          case "setup": case "login":
            setView("setup");
            return;
          case "model": {
            if (view === "home") setView("chat");
            if (!arg) {
              const lines = ["**Available models:**"];
              if (providers.length === 0) {
                lines.push("  (none — run /setup)");
              }
              for (const p of providers) {
                for (const m of p.listModels()) {
                  const active = activeProvider?.id === p.id && activeModel?.id === m.id ? " **(active)**" : "";
                  lines.push(`  \`${p.id}/${m.id}\` ${m.displayName} (${formatCost(m.pricing.inputPerMTok)}/MTok)${active}`);
                }
              }
              lines.push("", "Usage: `/model provider/model-id`");
              addSystemMessage(lines.join("\n"));
              return;
            }
            const { findModel } = await import("../providers/registry.js");
            const resolved = findModel(providers, arg);
            if (resolved) {
              setActiveProvider(resolved.provider);
              setActiveModel(resolved.model);
              addSystemMessage(`Switched to **${resolved.model.displayName}** (${resolved.provider.id}/${resolved.model.id})`);
            } else {
              addSystemMessage(`Model not found: \`${arg}\`. Run /model to list.`);
            }
            return;
          }
          case "cost":
            if (view === "home") setView("chat");
            addSystemMessage(`Session: **${formatCost(sessionCost)}** | Tokens: **${tokenCount}**`);
            return;
          case "help":
            if (view === "home") setView("chat");
            addSystemMessage([
              "**Commands:**",
              "  /model [id]  — list or switch models",
              "  /setup       — add a provider",
              "  /cost        — session spend",
              "  /clear       — reset (back to home)",
              "  /help        — this help",
              "  /exit        — quit",
            ].join("\n"));
            return;
          default:
            if (view === "home") setView("chat");
            addSystemMessage(`Unknown command: /${cmd}. Try /help`);
            return;
        }
      }

      // No provider
      if (!activeProvider || !activeModel) {
        if (view === "home") setView("chat");
        addSystemMessage("No provider configured. Run **/setup** to add one.");
        return;
      }

      // Switch to chat view on first message
      if (view === "home") setView("chat");

      setCompletedMessages((prev) => [
        ...prev,
        { role: "user" as const, content: input, id: Date.now() },
      ]);
      setIsStreaming(true);
      setStreamingText("");
      setTurnCost(0);
      setError(null);

      try {
        const result = await handleUserInput(
          input, history,
          { provider: activeProvider, model: activeModel },
          {
            onText: (text) => setStreamingText((prev) => prev + text),
            onError: (err) => setError(err.message),
            onUsage: (usage) => {
              setTurnCost(usage.cost);
              setSessionCost((prev) => prev + usage.cost);
              setTokenCount((prev) => prev + usage.totalTokens);
            },
            onFinish: (fullText) => {
              setCompletedMessages((prev) => [
                ...prev,
                { role: "assistant" as const, content: fullText, id: Date.now() + 1 },
              ]);
              setStreamingText("");
              setIsStreaming(false);
            },
          },
        );
        setHistory(result.messages);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setIsStreaming(false);
      }
    },
    [view, history, activeProvider, activeModel, providers, exit, sessionCost, tokenCount, addSystemMessage],
  );

  const showSidebar = view === "chat" && cols >= 100;
  const isInputActive = view !== "setup";
  const isSetupActive = view === "setup";

  return (
    <Box flexDirection="column" height={rows}>
      {/* ── SETUP VIEW ── */}
      {view === "setup" && (
        <Box flexDirection="column" flexGrow={1}>
          <Setup
            onComplete={handleSetupComplete}
            onCodexLogin={handleCodexLogin}
            onSkip={() => setView(activeProvider ? "home" : "home")}
            isActive={isSetupActive}
          />
        </Box>
      )}

      {/* ── HOME VIEW (OpenCode style) ── */}
      {view === "home" && (
        <Home
          version={version}
          detectedProviders={detectedProviders}
          activeModel={activeModel?.displayName}
          activeProvider={activeProvider?.id}
          rows={rows}
          cols={cols}
        />
      )}

      {/* ── CHAT VIEW ── */}
      {view === "chat" && (
        <Box flexDirection="row" flexGrow={1}>
          {/* Main chat area */}
          <Box flexDirection="column" flexGrow={1}>
            <Static items={completedMessages}>
              {(msg) => (
                <Box key={msg.id}>
                  <Message role={msg.role} content={msg.content} />
                </Box>
              )}
            </Static>
            {isStreaming && <StreamingMessage content={streamingText} />}
            {error && <Text color="red">Error: {error}</Text>}
          </Box>

          {/* Sidebar (hidden on narrow terminals) */}
          {showSidebar && (
            <Sidebar
              activeModel={activeModel?.displayName}
              activeProvider={activeProvider?.id}
              sessionCost={sessionCost}
              tokenCount={tokenCount}
              detectedProviders={detectedProviders}
            />
          )}
        </Box>
      )}

      {/* ── INPUT (always at bottom except setup) ── */}
      {view !== "setup" && (
        <PromptInput
          onSubmit={handleSubmit}
          isStreaming={isStreaming}
          isActive={isInputActive}
        />
      )}

      {/* ── STATUS BAR (always at very bottom) ── */}
      <StatusBar
        model={activeModel?.displayName ?? "none"}
        provider={activeProvider?.id ?? "—"}
        sessionCost={sessionCost}
        turnCost={turnCost}
        tokenCount={tokenCount}
        isStreaming={isStreaming}
      />
    </Box>
  );
}
