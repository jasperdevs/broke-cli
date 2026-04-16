import { fileURLToPath } from "url";
import { dirname } from "path";
import { currentTheme, getPlanColor } from "../core/themes.js";

export function T(): string { return currentTheme().primary; }
export function TXT(): string { return currentTheme().text; }
export function MUTED(): string { return currentTheme().textMuted; }
export function BORDER(): string { return currentTheme().border; }
export function USER_BG(): string { return currentTheme().userBubble; }
export function USER_TXT(): string { return currentTheme().userText; }
export function CODE_BG(): string { return currentTheme().codeBg; }
export function APP_BG(): string { return currentTheme().background; }
export function SIDEBAR_BG(): string { return currentTheme().sidebarBackground || currentTheme().background; }
export function ERR(): string { return currentTheme().error; }
export function OK(): string { return currentTheme().success; }
export function ACCENT_2(): string { return currentTheme().secondary; }
export function WARN(): string { return currentTheme().warning; }
export function P(): string { return getPlanColor(); }

export class AnimCounter {
  target = 0;
  display = 0;

  tick(): void {
    if (this.display === this.target) return;
    const diff = this.target - this.display;
    const isFloat = this.target !== Math.floor(this.target);
    const minStep = isFloat ? Math.max(0.0001, Math.abs(diff) * 0.01) : 1;
    const step = Math.max(minStep, Math.abs(diff) * 0.25);
    if (Math.abs(diff) <= minStep) {
      this.display = this.target;
    } else {
      this.display += diff > 0 ? step : -step;
      if (!isFloat) this.display = Math.round(this.display);
    }
  }

  set(val: number): void { this.target = val; }
  sync(): void { this.display = this.target; }
  reset(): void { this.target = 0; this.display = 0; }
  get(): number { return this.display; }
  getInt(): number { return Math.round(this.display); }
}

export const HOME_TIPS = [
  "Use /update when the banner appears; it runs the right package-manager command for this install.",
  "Use /model to switch providers without leaving the chat.",
  "Press space on a model in /model to pin it for quick scoped cycling.",
  "Use /compact before long refactors to keep token pressure down.",
  "Paste an image path to attach a screenshot to your next prompt.",
  "Drop a screenshot into the composer when a visual bug is easier to show than describe.",
  "Use /btw for a side question without derailing the main thread.",
  "Use /tree to jump to an earlier point in the session.",
  "Use /fork from the session tree when you want to explore an alternate direction.",
  "Use /resume to jump back into an older session.",
  "Use /sessions as a natural alias for /resume.",
  "Use /providers when a model or login looks wrong.",
  "Use /login to connect Codex, Claude Code, Copilot, Gemini CLI, or Antigravity with OAuth.",
  "Use /login for providers that support native OAuth flows.",
  "Use /settings to tweak behavior without leaving the keyboard.",
  "Use Shift+Tab to toggle build and plan mode for the current session.",
  "Use Ctrl+T to cycle thinking levels when the selected model supports reasoning.",
  "Use Ctrl+O to expand or collapse tool output in the transcript.",
  "Use PageUp and PageDown to scroll the transcript from the keyboard.",
  "Use the mouse wheel to scroll chat history while the TUI is open.",
  "Use Tab while a response is running to queue a follow-up message.",
  "Use Enter while a response is running to queue steering for the next tool call.",
  "Use Alt+Up to pull the newest queued message back into the composer.",
  "Use Escape once to prime a stop, then Escape again to abort a running turn.",
  "Use /copy to copy the last assistant response.",
  "Use /export to save or copy a transcript.",
  "Use @ to attach project files from the keyboard.",
  "Use $ to insert a local skill prompt when skills are enabled.",
  "Use !! before a shell command when you want to run it without sending output to the model.",
  "Use ! before a shell command when you want the output brought back into the chat.",
  "Use /reload after changing local skills, prompts, extensions, or package resources.",
  "Use /packages to inspect installed package resources.",
  "Use /projects to jump between recent workspaces.",
  "Use /thinking to toggle reasoning controls from the command line.",
  "Use /caveman to cycle stricter execution behavior.",
  "Run brokecli --list-models when you want a plain list of detected model ids.",
  "Run brokecli -p for one-shot output when you do not need the full TUI.",
  "Run brokecli --rpc when another process needs JSON RPC instead of the interface.",
  "Auto routing only switches models automatically when auto mode is enabled.",
  "Explicit provider or model selections stay pinned; auto fallback does not override them.",
  "The transcript is saved automatically when session persistence is enabled.",
  "The startup page uses your terminal background; colors should not paint over it.",
  "Use /clear when you want a clean thread without leaving the workspace.",
  "Use /session to inspect or rename the active session.",
  "Use /hotkeys to review or reset editor shortcuts.",
  "Use /templates to insert reusable prompt blocks.",
  "Use /skills to browse loaded skill commands.",
];

export const APP_DIR = dirname(fileURLToPath(import.meta.url));
