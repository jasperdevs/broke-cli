import {
  buildSidebarLines,
  centerVisibleLine,
  formatRelativeAge,
  formatShortCwd,
  formatShortPath,
  isToolOutput,
  padLine,
  parseMascotSvgGridCached,
  pickHomeTipIndex,
  refreshHomeScreenData,
  renderCompactHeader,
  renderHomeBox,
  renderHomeView,
  renderMascotBlock,
  renderMascotInline,
  renderMessages,
  renderSidebar,
  renderStaticMessages,
  renderToolCallBlock,
  resolveMascotPathCached,
  shouldShowSidebar,
  wrapHomeDetail,
  wrapHomeText,
} from "./app-render-methods.js";
import type { RgbColor } from "./render/mascot.js";

type AppState = any;

export interface AppRenderMethods {
  isToolOutput(content: string): boolean;
  renderStaticMessages(maxWidth: number): string[];
  renderToolCallBlock(tc: { name: string; preview: string; args?: unknown; resultDetail?: string; result?: string; error?: boolean; expanded: boolean; streamOutput?: string }, maxWidth: number): string[];
  renderMessages(maxWidth: number): string[];
  renderCompactHeader(): string;
  shouldShowSidebar(): boolean;
  pickHomeTipIndex(): number;
  refreshHomeScreenData(): void;
  formatShortCwd(maxWidth: number): string;
  formatShortPath(pathValue: string, maxWidth: number): string;
  formatRelativeAge(updatedAt: number): string;
  resolveMascotPath(): string | null;
  parseMascotSvgGrid(path: string): Array<Array<RgbColor | null>>;
  renderMascotBlock(): string[];
  renderMascotInline(): string[];
  wrapHomeDetail(label: string, value: string, width: number): string[];
  wrapHomeText(prefix: string, prefixPlain: string, value: string, width: number, color?: string): string[];
  centerVisibleLine(line: string, width: number): string;
  renderHomeBox(width: number, title: string, body: string[]): string[];
  renderHomeView(mainW: number, topHeight: number): string[];
  buildSidebarLines(): string[];
  renderSidebar(visibleHeight: number): string[];
  padLine(line: string, targetWidth: number): string;
}

export const appRenderMethods: AppRenderMethods = {
  isToolOutput(this: AppState, content: string) { return isToolOutput(this, content); },
  renderStaticMessages(this: AppState, maxWidth: number) { return renderStaticMessages(this, maxWidth); },
  renderToolCallBlock(this: AppState, tc: typeof this.toolCallGroups[0], maxWidth: number) { return renderToolCallBlock(this, tc, maxWidth); },
  renderMessages(this: AppState, maxWidth: number) { return renderMessages(this, maxWidth); },
  renderCompactHeader(this: AppState) { return renderCompactHeader(this); },
  shouldShowSidebar(this: AppState) { return shouldShowSidebar(this); },
  pickHomeTipIndex(this: AppState) { return pickHomeTipIndex(this); },
  refreshHomeScreenData(this: AppState) { return refreshHomeScreenData(this); },
  formatShortCwd(this: AppState, maxWidth: number) { return formatShortCwd(this, maxWidth); },
  formatShortPath(this: AppState, pathValue: string, maxWidth: number) { return formatShortPath(this, pathValue, maxWidth); },
  formatRelativeAge(this: AppState, updatedAt: number) { return formatRelativeAge(this, updatedAt); },
  resolveMascotPath(this: AppState) { return resolveMascotPathCached(this); },
  parseMascotSvgGrid(this: AppState, path: string) { return parseMascotSvgGridCached(this, path); },
  renderMascotBlock(this: AppState) { return renderMascotBlock(this); },
  renderMascotInline(this: AppState) { return renderMascotInline(this); },
  wrapHomeDetail(this: AppState, label: string, value: string, width: number) { return wrapHomeDetail(this, label, value, width); },
  wrapHomeText(this: AppState, prefix: string, prefixPlain: string, value: string, width: number, color?: string) { return wrapHomeText(this, prefix, prefixPlain, value, width, color); },
  centerVisibleLine(this: AppState, line: string, width: number) { return centerVisibleLine(this, line, width); },
  renderHomeBox(this: AppState, width: number, title: string, body: string[]) { return renderHomeBox(this, width, title, body); },
  renderHomeView(this: AppState, mainW: number, topHeight: number) { return renderHomeView(this, mainW, topHeight); },
  buildSidebarLines(this: AppState) { return buildSidebarLines(this); },
  renderSidebar(this: AppState, visibleHeight: number) { return renderSidebar(this, visibleHeight); },
  padLine(this: AppState, line: string, targetWidth: number) { return padLine(this, line, targetWidth); },
};
