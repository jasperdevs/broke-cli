import { BOLD, DIM, RESET } from "../utils/ansi.js";
import { visibleWidth } from "../utils/terminal-width.js";
import type { SessionTreeItem } from "../core/session.js";
import type { TreeFilterMode } from "../core/config.js";
import type { MenuEntry, TreeRow } from "./app-types.js";
import { ERR, T, TXT, WARN } from "./app-shared.js";
import { wordWrap } from "./render/formatting.js";

type AppState = any;

function renderMenuCount(current: number, total: number): string {
  return `${DIM}(${current}/${total})${RESET}`;
}

function summarizeEntry(item: SessionTreeItem): string {
  const firstLine = item.content.split(/\r?\n/)[0]?.trim() || item.role;
  return firstLine.replace(/\s+/g, " ").slice(0, 120);
}

function markerForRow(item: SessionTreeItem, collapsed: boolean): string {
  if (item.hasChildren) return collapsed ? "⊞" : "⊟";
  return "•";
}

function renderRowText(item: SessionTreeItem, collapsed: boolean, showLabelTimestamps: boolean): string {
  const indent = "  ".repeat(item.depth);
  const role = item.role === "user"
    ? `${TXT()}you${RESET}`
    : item.role === "assistant"
      ? `${T()}assistant${RESET}`
      : `${DIM}note${RESET}`;
  const active = item.active ? ` ${WARN()}← active${RESET}` : "";
  const label = item.label ? ` ${DIM}[${item.label}]${RESET}` : "";
  const timestamp = item.label && item.labelTimestamp && showLabelTimestamps
    ? ` ${DIM}${new Date(item.labelTimestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${RESET}`
    : "";
  return `${indent}${markerForRow(item, collapsed)} ${role} ${summarizeEntry(item)}${label}${timestamp}${active}`;
}

function shouldHideByFold(item: SessionTreeItem, collapsedIds: Set<string>, visibleAncestors: string[]): boolean {
  for (const ancestorId of visibleAncestors) {
    if (collapsedIds.has(ancestorId)) return true;
  }
  return false;
}

export function getVisibleTreeRows(app: AppState): TreeRow[] {
  const view = app.treeView;
  if (!view) return [];
  const items = view.session.getTreeItems(view.filterMode as TreeFilterMode);
  const query = app.getMenuFilterQuery().trim().toLowerCase();
  const rows: TreeRow[] = [];
  const ancestorStack: string[] = [];
  let previousDepth = 0;
  for (const item of items) {
    if (item.depth < previousDepth) ancestorStack.splice(item.depth);
    previousDepth = item.depth;
    const hidden = shouldHideByFold(item, view.collapsedIds, ancestorStack);
    const collapsed = view.collapsedIds.has(item.id);
    const matchesQuery = !query || [item.role, item.label ?? "", summarizeEntry(item), item.content]
      .join("\n")
      .toLowerCase()
      .includes(query);
    if (!hidden) {
      if (matchesQuery) {
        rows.push({
          item,
          marker: markerForRow(item, collapsed),
          text: renderRowText(item, collapsed, view.showLabelTimestamps),
          branchStart: item.hasChildren,
          collapsed,
        });
      }
    }
    ancestorStack[item.depth] = item.id;
  }
  if (!view.selectedId && rows.length > 0) view.selectedId = rows.find((row) => row.item.active)?.item.id ?? rows[0].item.id;
  if (view.selectedId && !rows.some((row) => row.item.id === view.selectedId)) {
    view.selectedId = rows.find((row) => row.item.active)?.item.id ?? rows[0]?.item.id ?? null;
  }
  return rows;
}

function detailLines(row: TreeRow | undefined, width: number): string[] {
  if (!row) return [`${DIM}no entries${RESET}`];
  const lines = [
    `${TXT()}${BOLD}${row.item.role}${RESET}${row.item.active ? ` ${WARN()}active${RESET}` : ""}${row.item.label ? ` ${DIM}[${row.item.label}]${RESET}` : ""}`,
    "",
  ];
  for (const raw of row.item.content.split(/\r?\n/)) {
    for (const line of wordWrap(raw || " ", Math.max(8, width))) {
      lines.push(`${TXT()}${line}${RESET}`);
    }
  }
  return lines;
}

export function drawTreeView(app: AppState): void {
  const view = app.treeView!;
  const { width, height } = app.screen;
  const separatorColor = app.getModeAccent();
  const rows = getVisibleTreeRows(app);
  const selectedIndex = Math.max(0, rows.findIndex((row) => row.item.id === view.selectedId));
  const count = renderMenuCount(rows.length === 0 ? 0 : selectedIndex + 1, rows.length);
  const listWidth = Math.min(52, Math.max(28, Math.floor(width * 0.46)));
  const detailWidth = Math.max(20, width - listWidth - 3);
  const bodyRows = Math.max(1, height - 4);
  const maxScroll = Math.max(0, rows.length - bodyRows);
  if (selectedIndex < view.scrollOffset) view.scrollOffset = selectedIndex;
  if (selectedIndex >= view.scrollOffset + bodyRows) view.scrollOffset = Math.max(0, selectedIndex - bodyRows + 1);
  if (view.scrollOffset > maxScroll) view.scrollOffset = maxScroll;
  const visibleRows = rows.slice(view.scrollOffset, view.scrollOffset + bodyRows);
  const selectedRow = rows[selectedIndex];
  const detail = detailLines(selectedRow, detailWidth);

  const filterLabel = view.filterMode === "user-only"
    ? "user"
    : view.filterMode === "no-tools"
      ? "no-tools"
    : view.filterMode === "all"
      ? "all"
      : view.filterMode === "labeled-only"
        ? "labeled"
        : "default";

  const frame: string[] = [];
  frame.push(`${separatorColor}${"─".repeat(width)}${RESET}`);
  frame.push(` ${T()}${BOLD}${view.title}${RESET} ${count}${DIM} · ${filterLabel}${RESET}${DIM} · enter jump · shift+l label · ctrl+u user · ctrl+o cycle · esc back${RESET}`);
  frame.push(` ${DIM}left/right page · ctrl/alt+left/right fold · shift+t timestamps${RESET}`);
  frame.push("");

  for (let i = 0; i < bodyRows; i++) {
    const row = visibleRows[i];
    const absoluteIndex = view.scrollOffset + i;
    const selected = absoluteIndex === selectedIndex;
    const arrow = selected ? `${T()}>${RESET}` : " ";
    const leftText = row ? `${arrow} ${row.text}` : "";
    const left = app.padLine(leftText, listWidth);
    const right = app.padLine(detail[i] ?? "", detailWidth);
    frame.push(`${left} ${app.getSidebarBorder()} ${right}`);
  }

  while (frame.length < height) frame.push("");
  app.screen.render(frame.map((line: string) => app.decorateFrameLine(line, width)));
  app.screen.hideCursor();
}

export function getTreePickerEntries(app: AppState): MenuEntry[] {
  const rows = getVisibleTreeRows(app);
  const selectedIndex = Math.max(0, rows.findIndex((row) => row.item.id === app.treeView?.selectedId));
  return rows.map((row, index) => {
    const isCursor = index === selectedIndex;
    const arrow = isCursor ? `${T()}> ${RESET}` : "  ";
    const text = isCursor ? `${TXT()}${BOLD}${row.text}${RESET}` : row.text;
    return { lines: [` ${arrow}${text}`], selectIndex: index };
  });
}

export function moveTreeSelection(app: AppState, delta: number): void {
  const rows = getVisibleTreeRows(app);
  if (rows.length === 0) return;
  const currentIndex = Math.max(0, rows.findIndex((row) => row.item.id === app.treeView.selectedId));
  const nextIndex = Math.max(0, Math.min(rows.length - 1, currentIndex + delta));
  app.treeView.selectedId = rows[nextIndex].item.id;
}

export function pageTreeSelection(app: AppState, direction: -1 | 1): void {
  moveTreeSelection(app, direction * Math.max(1, app.screen.height - 6));
}

export function toggleTreeFold(app: AppState, direction: -1 | 1): void {
  const view = app.treeView;
  if (!view) return;
  const rows = getVisibleTreeRows(app);
  const current = rows.find((row) => row.item.id === view.selectedId);
  if (!current) return;
  if (current.item.hasChildren) {
    if (direction < 0 && !view.collapsedIds.has(current.item.id)) {
      view.collapsedIds.add(current.item.id);
      return;
    }
    if (direction > 0 && view.collapsedIds.has(current.item.id)) {
      view.collapsedIds.delete(current.item.id);
      return;
    }
  }
  const currentIndex = rows.findIndex((row) => row.item.id === view.selectedId);
  const candidates = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row, index }) => row.branchStart && (direction < 0 ? index < currentIndex : index > currentIndex));
  const target = direction < 0 ? candidates[candidates.length - 1] : candidates[0];
  if (target) view.selectedId = target.row.item.id;
}

export function toggleTreeFilter(app: AppState, mode?: TreeFilterMode): void {
  const view = app.treeView;
  if (!view) return;
  if (!mode) {
    const order: TreeFilterMode[] = ["default", "no-tools", "user-only", "labeled-only", "all"];
    const index = Math.max(0, order.indexOf(view.filterMode as TreeFilterMode));
    view.filterMode = order[(index + 1) % order.length]!;
  } else if (mode === "user-only") {
    view.filterMode = view.filterMode === "user-only" ? "default" : "user-only";
  } else if (mode === "all") {
    view.filterMode = view.filterMode === "all" ? "default" : "all";
  } else {
    view.filterMode = mode;
  }
  view.scrollOffset = 0;
}

export function toggleTreeTimestampMode(app: AppState): void {
  if (!app.treeView) return;
  app.treeView.showLabelTimestamps = !app.treeView.showLabelTimestamps;
}

export function toggleTreeLabel(app: AppState): void {
  const view = app.treeView;
  if (!view?.selectedId) return;
  view.session.toggleLabel(view.selectedId);
}

export function getSelectedTreeItem(app: AppState): SessionTreeItem | null {
  const row = getVisibleTreeRows(app).find((entry) => entry.item.id === app.treeView?.selectedId);
  return row?.item ?? null;
}
