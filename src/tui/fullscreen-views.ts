import { BOLD, DIM, RESET } from "../utils/ansi.js";
import { renderBudgetDashboard } from "../core/budget-insights.js";
import { T } from "./app-shared.js";

type AppState = any;

function renderMenuCount(current: number, total: number): string {
  return `${DIM}(${current}/${total})${RESET}`;
}

function renderBudgetTabs(app: AppState): string {
  const tabs: Array<{ id: "usage" | "efficiency" | "routing" | "context"; label: string }> = [
    { id: "usage", label: "Usage" },
    { id: "efficiency", label: "Efficiency" },
    { id: "routing", label: "Routing" },
    { id: "context", label: "Context" },
  ];
  return tabs.map((tab) => {
    const active = app.budgetView.section === tab.id;
    return active
      ? `${T()}[${tab.label}]${RESET}`
      : `${DIM}${tab.label}${RESET}`;
  }).join(` ${DIM}·${RESET} `);
}

export function drawBudgetView(app: AppState): void {
  const { width, height } = app.screen;
  const separatorColor = app.getModeAccent();
  const title = `${T()}${BOLD}${app.budgetView.title}${RESET}`;
  const report = app.budgetView.reports[app.budgetView.scope];
  const scopeLabel = app.budgetView.scope === "all" ? "all sessions" : "current session";
  const scopeToggleHint = app.budgetView.scope === "all" ? "s current" : "s all";
  const leftPad = 3;
  const bodyWidth = Math.max(20, width - leftPad - 4);
  const bodyHeight = Math.max(1, height - 9);
  const allLines = renderBudgetDashboard({
    report,
    width: bodyWidth,
    scopeLabel,
    contextTokens: app.contextTokenCount,
    contextLimit: app.contextLimitTokens,
    showContext: app.budgetView.scope === "session",
    section: app.budgetView.section,
  });
  const maxScroll = Math.max(0, allLines.length - bodyHeight);
  if (app.budgetView.scrollOffset > maxScroll) app.budgetView.scrollOffset = maxScroll;
  const visible = allLines.slice(app.budgetView.scrollOffset, app.budgetView.scrollOffset + bodyHeight);
  const thumbRow = maxScroll > 0
    ? Math.round((app.budgetView.scrollOffset / Math.max(maxScroll, 1)) * Math.max(0, bodyHeight - 1))
    : -1;

  const frame: string[] = [];
  frame.push(`${separatorColor}${"─".repeat(width)}${RESET}`);
  frame.push("");
  frame.push("");
  frame.push(`${" ".repeat(leftPad)}${title}`);
  frame.push(`${" ".repeat(leftPad)}${renderBudgetTabs(app)}`);
  frame.push(`${" ".repeat(leftPad)}${DIM}${scopeLabel}${RESET}${DIM} · ${scopeToggleHint} · tab next · esc back${RESET}`);
  frame.push("");
  for (let i = 0; i < bodyHeight; i++) {
    const line = visible[i] ?? "";
    const indicator = maxScroll > 0 ? (i === thumbRow ? `${T()}█${RESET}` : `${DIM}│${RESET}`) : " ";
    frame.push(`${" ".repeat(leftPad)}${app.padLine(line, bodyWidth)} ${indicator}`);
  }
  while (frame.length < height) frame.push("");
  app.screen.render(frame.map((line) => app.decorateFrameLine(line, width)));
  app.screen.hideCursor();
}
