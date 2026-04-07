import { BOLD, DIM, RESET } from "../utils/ansi.js";
import { visibleWidth } from "../utils/terminal-width.js";
import { renderBudgetDashboard } from "../core/budget-insights.js";
import { ERR, OK, T, TXT } from "./app-shared.js";
import { wordWrap } from "./render/formatting.js";

type AppState = any;

function renderMenuCount(current: number, total: number): string {
  return `${DIM}(${current}/${total})${RESET}`;
}

function renderAgentRunListItem(
  run: { prompt: string; status: "running" | "done" | "error"; detail?: string },
  selected: boolean,
  width: number,
): string {
  const statusColor = run.status === "error" ? ERR() : run.status === "done" ? DIM : OK();
  const arrow = selected ? `${T()}>${RESET}` : `${DIM} ${RESET}`;
  const label = selected ? `${TXT()}${BOLD}Task${RESET}` : `${DIM}Task${RESET}`;
  const prompt = run.prompt.replace(/\s+/g, " ").trim() || "[empty]";
  const promptText = appTruncate(prompt, Math.max(8, width - 10));
  const detail = run.detail ? ` ${DIM}${appTruncate(run.detail, Math.max(8, width - 8))}${RESET}` : "";
  return `${arrow} ${label} ${statusColor}${promptText}${RESET}${detail}`;
}

function buildAgentRunDetail(
  run: { prompt: string; status: "running" | "done" | "error"; detail?: string; result?: string },
  width: number,
): string[] {
  const lines: string[] = [];
  const statusColor = run.status === "error" ? ERR() : run.status === "done" ? OK() : T();
  const header = `${statusColor}${BOLD}${run.status === "running" ? "Working" : run.status === "error" ? "Error" : "Done"}${RESET}`;
  lines.push(`${header}${run.detail ? ` ${DIM}${run.detail}${RESET}` : ""}`);
  lines.push("");
  lines.push(`${DIM}Task${RESET}`);
  for (const line of wordWrap(run.prompt.replace(/\s+/g, " ").trim(), Math.max(8, width))) {
    lines.push(`${TXT()}${line}${RESET}`);
  }
  lines.push("");
  lines.push(`${DIM}Result${RESET}`);
  const body = (run.result ?? (run.status === "running" ? "Preparing prompt..." : "[empty]")).trim();
  for (const rawLine of body.split(/\r?\n/)) {
    for (const line of wordWrap(rawLine || " ", Math.max(8, width))) {
      lines.push(`${TXT()}${line}${RESET}`);
    }
  }
  return lines;
}

function appTruncate(text: string, width: number): string {
  return visibleWidth(text) <= width ? text : `${text.slice(0, Math.max(0, width - 3))}...`;
}

export function drawBudgetView(app: AppState): void {
  const { width, height } = app.screen;
  const separatorColor = app.getModeAccent();
  const title = `${T()}${BOLD}${app.budgetView.title}${RESET}`;
  const report = app.budgetView.reports[app.budgetView.scope];
  const scopeLabel = app.budgetView.scope === "all" ? "all sessions" : "current session";
  const scopeToggleHint = app.budgetView.scope === "all" ? "tab current" : "tab all";
  const leftPad = 3;
  const bodyWidth = Math.max(20, width - leftPad - 4);
  const bodyHeight = Math.max(1, height - 8);
  const allLines = renderBudgetDashboard({
    report,
    width: bodyWidth,
    scopeLabel,
    contextTokens: app.contextTokenCount,
    contextLimit: app.contextLimitTokens,
    showContext: app.budgetView.scope === "session",
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
  frame.push(`${" ".repeat(leftPad)}${DIM}${scopeLabel}${RESET}${DIM} · ${scopeToggleHint} · esc back${RESET}`);
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

export function drawAgentRunsView(app: AppState): void {
  const { width, height } = app.screen;
  const separatorColor = app.getModeAccent();
  const title = `${T()}${BOLD}${app.agentRunView.title}${RESET}`;
  const listWidth = Math.min(38, Math.max(24, Math.floor(width * 0.36)));
  const detailWidth = Math.max(20, width - listWidth - 3);
  const rows = Math.max(1, height - 3);
  const runs = app.agentRunView.runs;
  const selectedIndex = Math.max(0, Math.min(runs.length - 1, app.agentRunView.selectedIndex));
  app.agentRunView.selectedIndex = selectedIndex;
  const maxScroll = Math.max(0, runs.length - rows);
  if (selectedIndex < app.agentRunView.scrollOffset) app.agentRunView.scrollOffset = selectedIndex;
  if (selectedIndex >= app.agentRunView.scrollOffset + rows) {
    app.agentRunView.scrollOffset = Math.max(0, selectedIndex - rows + 1);
  }
  if (app.agentRunView.scrollOffset > maxScroll) app.agentRunView.scrollOffset = maxScroll;

  const frame: string[] = [];
  const count = renderMenuCount(runs.length === 0 ? 0 : selectedIndex + 1, runs.length);
  frame.push(`${separatorColor}${"─".repeat(width)}${RESET}`);
  const headerRight = `${count} ${DIM}esc back${RESET}`;
  frame.push(` ${title}${" ".repeat(Math.max(1, width - 2 - visibleWidth(title) - visibleWidth(headerRight)))}${headerRight}`);

  const visibleRuns = runs.slice(app.agentRunView.scrollOffset, app.agentRunView.scrollOffset + rows);
  const selectedRun = runs[selectedIndex];
  const detailLines = selectedRun
    ? buildAgentRunDetail(selectedRun, detailWidth)
    : [`${DIM}no agent runs yet${RESET}`];

  for (let i = 0; i < rows; i++) {
    const run = visibleRuns[i];
    const absoluteIndex = app.agentRunView.scrollOffset + i;
    const selected = absoluteIndex === selectedIndex;
    const left = run ? app.padLine(renderAgentRunListItem(run, selected, listWidth), listWidth) : app.padLine("", listWidth);
    const right = app.padLine(detailLines[i] ?? "", detailWidth);
    frame.push(`${left} ${app.getSidebarBorder()} ${right}`);
  }

  while (frame.length < height) frame.push("");
  app.screen.render(frame.map((line) => app.decorateFrameLine(line, width)));
  app.screen.hideCursor();
}
