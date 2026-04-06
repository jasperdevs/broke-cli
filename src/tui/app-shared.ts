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
  "Use /resume to jump back into an older session.",
  "Use /model to switch providers without leaving the chat.",
  "Use /compact before long refactors to keep token pressure down.",
  "Paste an image path to attach a screenshot to your next prompt.",
  "Use /settings to tweak behavior without leaving the keyboard.",
];

export const APP_DIR = dirname(fileURLToPath(import.meta.url));
