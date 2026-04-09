import type { Keypress } from "./keypress.js";

export interface InputElement<T = unknown> {
  id: string;
  kind: string;
  label: string;
  start: number;
  end: number;
  meta: T;
}

type InsertElementOptions<T> = {
  id?: string;
  meta: T;
  leadingSpace?: boolean;
  trailingSpace?: boolean;
  replaceStart?: number;
  replaceEnd?: number;
};

/**
 * Text input widget with atomic inline elements.
 * Elements stay in the text buffer as placeholder labels, but cursor movement
 * and deletion treat them as indivisible chips.
 */
export class InputWidget {
  private text = "";
  private cursor = 0;
  private history: string[] = [];
  private historyIndex = -1;
  private elements: InputElement[] = [];
  private nextElementId = 0;
  private changeListeners: Array<(text: string) => void> = [];

  private normalizeInsertedText(text: string): string {
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  getText(): string { return this.text; }
  getCursor(): number { return this.cursor; }

  getElements(): InputElement[] {
    return this.elements.map((element) => ({ ...element }));
  }

  private clampCursor(): void {
    this.cursor = Math.max(0, Math.min(this.cursor, this.text.length));
  }

  onChange(listener: (text: string) => void): void {
    this.changeListeners.push(listener);
  }

  setText(text: string, placeCursorAtEnd = true, elements?: InputElement[]): void {
    this.text = text;
    this.elements = (elements ?? []).map((element) => ({ ...element }))
      .filter((element) => element.start >= 0 && element.end <= text.length && element.start < element.end)
      .sort((a, b) => a.start - b.start);
    this.cursor = placeCursorAtEnd ? this.text.length : Math.min(this.cursor, this.text.length);
    this.clampCursor();
    this.snapCursorOutsideElement();
    this.emitChange();
  }

  setCursor(cursor: number): void {
    this.cursor = Math.max(0, Math.min(cursor, this.text.length));
    this.clampCursor();
    this.snapCursorOutsideElement();
  }

  clear(): void {
    this.text = "";
    this.cursor = 0;
    this.historyIndex = -1;
    this.elements = [];
    this.emitChange();
  }

  submit(): string {
    const value = this.text.trim();
    if (value) this.history.push(value);
    this.clear();
    return value;
  }

  paste(text: string): void {
    this.insertText(this.normalizeInsertedText(text));
  }

  insertText(text: string): void {
    text = this.normalizeInsertedText(text);
    if (!text) return;
    this.clampCursor();
    this.snapCursorOutsideElement();
    this.text = this.text.slice(0, this.cursor) + text + this.text.slice(this.cursor);
    this.shiftElements(this.cursor, text.length);
    this.cursor += text.length;
    this.emitChange();
  }

  insertElement<T>(label: string, kind: string, options: InsertElementOptions<T>): InputElement<T> {
    const replaceStart = options.replaceStart ?? this.cursor;
    const replaceEnd = options.replaceEnd ?? this.cursor;
    this.cursor = Math.max(0, Math.min(replaceStart, this.text.length));
    this.clampCursor();
    if (replaceEnd > replaceStart) {
      this.text = this.text.slice(0, replaceStart) + this.text.slice(replaceEnd);
      const delta = replaceEnd - replaceStart;
      this.elements = this.elements
        .filter((element) => element.end <= replaceStart || element.start >= replaceEnd)
        .map((element) => (
          element.start >= replaceEnd
            ? { ...element, start: element.start - delta, end: element.end - delta }
            : element
        ));
    }
    this.snapCursorOutsideElement();
    const leadingSpace = options.leadingSpace ?? (this.cursor > 0 && !/\s/u.test(this.text[this.cursor - 1] ?? ""));
    const trailingSpace = options.trailingSpace ?? (this.cursor >= this.text.length || !/\s/u.test(this.text[this.cursor] ?? ""));
    const prefix = leadingSpace ? " " : "";
    const suffix = trailingSpace ? " " : "";
    const insertion = `${prefix}${label}${suffix}`;
    const start = this.cursor + prefix.length;
    const end = start + label.length;
    this.text = this.text.slice(0, this.cursor) + insertion + this.text.slice(this.cursor);
    this.shiftElements(this.cursor, insertion.length);
    const element: InputElement<T> = {
      id: options.id ?? `${kind}:${this.nextElementId++}`,
      kind,
      label,
      start,
      end,
      meta: options.meta,
    };
    this.elements.push(element);
    this.elements.sort((a, b) => a.start - b.start);
    this.cursor = end + suffix.length;
    this.emitChange();
    return { ...element };
  }

  removeElementById(id: string): InputElement | null {
    const element = this.elements.find((candidate) => candidate.id === id);
    if (!element) return null;
    this.removeElementRange(element);
    return { ...element };
  }

  removeElement(id: string): InputElement | null {
    return this.removeElementById(id);
  }

  findElementById<T = unknown>(id: string): InputElement<T> | null {
    const element = this.elements.find((candidate) => candidate.id === id);
    return element ? { ...(element as InputElement<T>) } : null;
  }

  findElementContaining(cursor = this.cursor): InputElement | null {
    return this.elements.find((element) => cursor > element.start && cursor < element.end) ?? null;
  }

  findAdjacentElement(cursor = this.cursor, direction: "left" | "right" | "backspace" | "delete"): InputElement | null {
    for (const element of this.elements) {
      if ((direction === "left" || direction === "backspace") && (cursor === element.end || cursor === element.end + 1 && this.text[element.end] === " ")) {
        return { ...element };
      }
      if ((direction === "right" || direction === "delete") && cursor === element.start) {
        return { ...element };
      }
    }
    return null;
  }

  replaceElements(elements: InputElement[]): void {
    this.elements = elements.map((element) => ({ ...element })).sort((a, b) => a.start - b.start);
    this.clampCursor();
    this.snapCursorOutsideElement();
    this.emitChange();
  }

  updateElementLabel(id: string, label: string): void {
    const element = this.elements.find((candidate) => candidate.id === id);
    if (!element) return;
    const originalEnd = element.end;
    const delta = label.length - element.label.length;
    this.text = `${this.text.slice(0, element.start)}${label}${this.text.slice(element.end)}`;
    element.label = label;
    element.end = element.start + label.length;
    if (delta !== 0) {
      this.elements = this.elements.map((candidate) => (
        candidate.id === id || candidate.start < originalEnd
          ? candidate
          : { ...candidate, start: candidate.start + delta, end: candidate.end + delta }
      ));
      if (this.cursor > originalEnd) this.cursor += delta;
      else if (this.cursor > element.start) this.cursor = element.end;
    }
    this.elements.sort((a, b) => a.start - b.start);
    this.clampCursor();
    this.snapCursorOutsideElement();
    this.emitChange();
  }

  sanitizeText(kinds: string[]): string {
    let sanitized = this.text;
    const filtered = this.elements
      .filter((element) => kinds.includes(element.kind))
      .sort((a, b) => b.start - a.start);
    for (const element of filtered) {
      sanitized = sanitized.slice(0, element.start) + sanitized.slice(element.end);
    }
    return sanitized.replace(/[ \t]+\n/gu, "\n").replace(/[ \t]{2,}/gu, " ").trim();
  }

  private emitChange(): void {
    for (const listener of this.changeListeners) listener(this.text);
  }

  handleKey(key: Keypress): "submit" | "interrupt" | "none" {
    this.clampCursor();
    if (key.ctrl && key.name === "c") return "interrupt";

    const isModifiedEnter = !key.ctrl && (
      key.name === "linefeed"
      || ((key.shift || key.meta) && (key.name === "return" || key.name === "enter" || key.name === "linefeed"))
    );
    if (isModifiedEnter) {
      this.insertText("\n");
      return "none";
    }

    if (key.name === "return" || key.name === "enter") return "submit";
    if (key.name === "tab") return "none";

    if (this.handleAtomicElementKey(key)) return "none";
    if (this.applyEditingShortcut(key) || this.applyDeletionKey(key) || this.applyNavigationKey(key) || this.applyHistoryKey(key)) return "none";

    if (key.ctrl && (key.name === "v" || (key.shift && key.name === "v"))) {
      this.tryPasteFromClipboard();
      return "none";
    }

    if (key.char && !key.ctrl && !key.meta && key.char.length === 1) {
      this.insertText(key.char);
      return "none";
    }

    return "none";
  }

  private shiftElements(from: number, delta: number): void {
    if (delta === 0) return;
    this.elements = this.elements.map((element) => (
      element.start >= from
        ? { ...element, start: element.start + delta, end: element.end + delta }
        : element
    ));
  }

  private snapCursorOutsideElement(): void {
    this.clampCursor();
    const containing = this.findElementContaining();
    if (containing) this.cursor = Math.min(containing.end, this.text.length);
    this.clampCursor();
  }

  private removeElementRange(element: InputElement): void {
    let deleteStart = element.start;
    let deleteEnd = element.end;
    if (this.text[deleteEnd] === " ") {
      deleteEnd += 1;
    } else if (deleteStart > 0 && this.text[deleteStart - 1] === " ") {
      deleteStart -= 1;
    }
    this.text = this.text.slice(0, deleteStart) + this.text.slice(deleteEnd);
    const delta = deleteEnd - deleteStart;
    this.elements = this.elements
      .filter((candidate) => candidate.id !== element.id)
      .map((candidate) => (
        candidate.start >= deleteEnd
          ? { ...candidate, start: candidate.start - delta, end: candidate.end - delta }
          : candidate
      ));
    this.cursor = Math.min(deleteStart, this.text.length);
    this.clampCursor();
    this.emitChange();
  }

  private handleAtomicElementKey(key: Keypress): boolean {
    const containing = this.findElementContaining();
    if (containing) {
      if (key.name === "left") {
        this.cursor = containing.start;
        return true;
      }
      if (key.name === "right") {
        this.cursor = containing.end;
        return true;
      }
      if (key.name === "backspace" || key.name === "delete" || (!!key.char && !key.ctrl && !key.meta)) {
        this.removeElementRange(containing);
        if (key.char && !key.ctrl && !key.meta && key.char.length === 1) this.insertText(key.char);
        return true;
      }
    }

    if (key.name === "left" || key.name === "backspace") {
      const adjacent = this.findAdjacentElement(this.cursor, key.name === "left" ? "left" : "backspace");
      if (adjacent) {
        if (key.name === "left") this.cursor = adjacent.start;
        else this.removeElementRange(adjacent);
        return true;
      }
    }

    if (key.name === "right" || key.name === "delete") {
      const adjacent = this.findAdjacentElement(this.cursor, key.name === "right" ? "right" : "delete");
      if (adjacent) {
        if (key.name === "right") this.cursor = adjacent.end;
        else this.removeElementRange(adjacent);
        return true;
      }
    }

    return false;
  }

  private deletePreviousWord(): void {
    const adjacent = this.findAdjacentElement(this.cursor, "backspace");
    if (adjacent) {
      this.removeElementRange(adjacent);
      return;
    }
    if (this.cursor <= 0) return;
    let i = this.cursor;
    while (i > 0 && /\s/u.test(this.text[i - 1] ?? "")) i--;
    while (i > 0 && !/\s/u.test(this.text[i - 1] ?? "")) i--;
    this.text = this.text.slice(0, i) + this.text.slice(this.cursor);
    this.shiftElements(this.cursor, i - this.cursor);
    this.cursor = i;
    this.emitChange();
  }

  private applyDeletionKey(key: Keypress): boolean {
    if ((key.ctrl && key.name === "backspace") || (key.meta && key.name === "backspace") || (key.ctrl && key.name === "w") || (key.ctrl && key.name === "h")) {
      this.deletePreviousWord();
      return true;
    }
    if (key.name === "backspace") {
      if (this.cursor > 0) {
        this.text = this.text.slice(0, this.cursor - 1) + this.text.slice(this.cursor);
        this.shiftElements(this.cursor, -1);
        this.cursor--;
        this.emitChange();
      }
      return true;
    }
    if (key.name === "delete") {
      if (this.cursor < this.text.length) {
        this.text = this.text.slice(0, this.cursor) + this.text.slice(this.cursor + 1);
        this.shiftElements(this.cursor + 1, -1);
        this.emitChange();
      }
      return true;
    }
    return false;
  }

  private applyNavigationKey(key: Keypress): boolean {
    if (key.name === "left") {
      if (this.cursor > 0) this.cursor--;
      this.snapCursorOutsideElement();
      return true;
    }
    if (key.name === "right") {
      if (this.cursor < this.text.length) this.cursor++;
      this.snapCursorOutsideElement();
      return true;
    }
    if (key.name === "home" || (key.ctrl && key.name === "a")) {
      this.cursor = 0;
      return true;
    }
    if (key.name === "end" || (key.ctrl && key.name === "e")) {
      this.cursor = this.text.length;
      return true;
    }
    return false;
  }

  private applyHistoryKey(key: Keypress): boolean {
    if (key.name === "up") {
      if (this.history.length > 0) {
        if (this.historyIndex === -1) this.historyIndex = this.history.length - 1;
        else if (this.historyIndex > 0) this.historyIndex--;
        this.setText(this.history[this.historyIndex]!, true);
      }
      return true;
    }
    if (key.name === "down") {
      if (this.historyIndex >= 0) {
        if (this.historyIndex < this.history.length - 1) this.historyIndex++;
        else this.historyIndex = -1;
        this.setText(this.historyIndex >= 0 ? this.history[this.historyIndex]! : "", true);
      }
      return true;
    }
    return false;
  }

  private applyEditingShortcut(key: Keypress): boolean {
    if (key.ctrl && key.name === "u") {
      this.clear();
      return true;
    }
    if (key.meta && key.name === "d") {
      const adjacent = this.findAdjacentElement(this.cursor, "delete");
      if (adjacent) {
        this.removeElementRange(adjacent);
        return true;
      }
      if (this.cursor < this.text.length) {
        let i = this.cursor;
        while (i < this.text.length && this.text[i] === " ") i++;
        while (i < this.text.length && this.text[i] !== " ") i++;
        this.text = this.text.slice(0, this.cursor) + this.text.slice(i);
        this.shiftElements(i, this.cursor - i);
        this.emitChange();
      }
      return true;
    }
    return false;
  }

  private tryPasteFromClipboard(): boolean {
    try {
      const { execSync } = require("child_process");
      const clip = process.platform === "win32"
        ? execSync("powershell -command Get-Clipboard", { encoding: "utf-8" }).trim()
        : process.platform === "darwin"
          ? execSync("pbpaste", { encoding: "utf-8" }).trim()
          : execSync("xclip -selection clipboard -o", { encoding: "utf-8" }).trim();
      if (clip) this.paste(clip);
    } catch {
      // clipboard unavailable
    }
    return true;
  }
}
