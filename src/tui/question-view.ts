import type { Keypress } from "./keypress.js";
import { InputWidget } from "./input.js";
import type { QuestionAnswer, QuestionField, QuestionOption, QuestionRequest, QuestionResult, QuestionView } from "./app-types.js";
import { BOLD, DIM, RESET } from "../utils/ansi.js";
import { T, TXT, MUTED, OK, WARN } from "./app-shared.js";
import { truncateVisible, visibleWidth } from "../utils/terminal-width.js";
import { wordWrap } from "./render/formatting.js";

type AppState = any;

function padLine(line: string, width: number): string {
  const visible = visibleWidth(line);
  return visible >= width ? truncateVisible(line, width) : `${line}${" ".repeat(width - visible)}`;
}

function questionAnswered(view: QuestionView, fieldId: string): boolean {
  return !!view.answers[fieldId];
}

function allRequiredAnswered(view: QuestionView): boolean {
  return view.questions.every((field) => !field.required || questionAnswered(view, field.id));
}

function currentField(view: QuestionView): QuestionField | null {
  return view.activeIndex >= 0 && view.activeIndex < view.questions.length ? view.questions[view.activeIndex] : null;
}

function isSubmitTab(view: QuestionView): boolean {
  return view.questions.length > 1 && view.activeIndex === view.questions.length;
}

function normalizeEditorForField(view: QuestionView, field: QuestionField): void {
  if (field.kind !== "text") return;
  const existing = view.answers[field.id];
  if (typeof existing?.value === "string") view.editor.setText(existing.value);
  else view.editor.setText("");
}

export function createQuestionView(request: QuestionRequest, resolve: (result: QuestionResult) => void): QuestionView {
  const editor = new InputWidget();
  const view: QuestionView = {
    title: request.title,
    submitLabel: request.submitLabel,
    questions: request.questions,
    activeIndex: 0,
    optionCursor: 0,
    answers: {},
    editor,
    resolve,
  };
  const first = currentField(view);
  if (first) normalizeEditorForField(view, first);
  return view;
}

function moveQuestion(view: QuestionView, delta: number): void {
  if (view.questions.length <= 1) return;
  const maxIndex = view.questions.length;
  view.activeIndex = Math.max(0, Math.min(maxIndex, view.activeIndex + delta));
  view.optionCursor = 0;
  const field = currentField(view);
  if (field) normalizeEditorForField(view, field);
}

function serializeAnswers(view: QuestionView): QuestionAnswer[] {
  return view.questions
    .map((field) => view.answers[field.id])
    .filter((answer): answer is QuestionAnswer => !!answer);
}

function finishQuestionView(app: AppState, cancelled: boolean): void {
  const view = app.questionView as QuestionView;
  if (!view) return;
  const result: QuestionResult = {
    cancelled,
    answers: cancelled ? [] : serializeAnswers(view),
  };
  app.questionView = null;
  app.drawNow();
  view.resolve(result);
}

function storeSingleAnswer(view: QuestionView, field: QuestionField, option: QuestionOption): void {
  view.answers[field.id] = {
    id: field.id,
    kind: field.kind,
    value: option.value,
    label: option.label,
  };
}

function toggleMultiAnswer(view: QuestionView, field: QuestionField, option: QuestionOption): void {
  const existing = view.answers[field.id];
  const values = Array.isArray(existing?.value) ? [...existing.value] : [];
  const labels = Array.isArray(existing?.label) ? [...existing.label] : [];
  const idx = values.indexOf(option.value);
  if (idx >= 0) {
    values.splice(idx, 1);
    labels.splice(idx, 1);
  } else {
    const maxSelections = Math.max(1, field.maxSelections ?? field.options.length);
    if (values.length >= maxSelections) {
      values.shift();
      labels.shift();
    }
    values.push(option.value);
    labels.push(option.label);
  }
  if (values.length === 0) {
    delete view.answers[field.id];
    return;
  }
  view.answers[field.id] = {
    id: field.id,
    kind: field.kind,
    value: values,
    label: labels,
  };
}

function storeTextAnswer(view: QuestionView, field: QuestionField): boolean {
  const value = view.editor.getText().trim();
  if (!value && field.required) return false;
  if (!value) {
    delete view.answers[field.id];
    return true;
  }
  view.answers[field.id] = {
    id: field.id,
    kind: field.kind,
    value,
    label: value,
    custom: true,
  };
  return true;
}

function advanceAfterAnswer(app: AppState): void {
  const view = app.questionView as QuestionView;
  if (!view) return;
  if (view.questions.length === 1) {
    finishQuestionView(app, false);
    return;
  }
  if (view.activeIndex < view.questions.length) {
    view.activeIndex = Math.min(view.questions.length, view.activeIndex + 1);
    view.optionCursor = 0;
    const field = currentField(view);
    if (field) normalizeEditorForField(view, field);
  }
  app.draw();
}

function formatTab(view: QuestionView, index: number, width: number): string {
  const isActive = view.activeIndex === index;
  const field = view.questions[index];
  const done = questionAnswered(view, field.id);
  const marker = done ? `${OK()}■${RESET}` : `${MUTED()}□${RESET}`;
  const base = `${marker} ${field.label}`;
  if (!isActive) return `${DIM}${truncateVisible(base, width)}${RESET}`;
  return `${T()}${BOLD}${truncateVisible(base, width)}${RESET}`;
}

function renderTabs(view: QuestionView, width: number): string[] {
  if (view.questions.length <= 1) return [];
  const segments = view.questions.map((_, index) => formatTab(view, index, Math.max(8, Math.floor(width / Math.max(2, view.questions.length + 1)))));
  const submitReady = allRequiredAnswered(view);
  const submitText = view.activeIndex === view.questions.length
    ? `${T()}${BOLD}✓ ${view.submitLabel}${RESET}`
    : submitReady
      ? `${OK()}✓ ${view.submitLabel}${RESET}`
      : `${DIM}✓ ${view.submitLabel}${RESET}`;
  return [` ${segments.join(`${DIM} · ${RESET}`)}${DIM} · ${RESET}${submitText}`];
}

function renderCurrentField(view: QuestionView, width: number): string[] {
  if (isSubmitTab(view)) {
    const lines: string[] = [` ${TXT()}${BOLD}${view.submitLabel}${RESET}`];
    lines.push("");
    for (const field of view.questions) {
      const answer = view.answers[field.id];
      const value = !answer
        ? `${DIM}[required]${RESET}`
        : Array.isArray(answer.label)
          ? answer.label.join(", ")
          : answer.label;
      lines.push(` ${T()}${field.label}${RESET} ${value}`);
    }
    return lines;
  }

  const field = currentField(view);
  if (!field) return [];
  const lines: string[] = [];
  lines.push(` ${TXT()}${BOLD}${field.prompt}${RESET}`);
  lines.push("");

  if (field.kind === "text") {
    const editorText = view.editor.getText();
    const wrapped = editorText.length > 0
      ? appWrap(view, editorText, width)
      : [`${DIM}${field.placeholder ?? "type response"}${RESET}`];
    for (const line of wrapped) lines.push(` ${line}`);
    return lines;
  }

  for (let i = 0; i < field.options.length; i++) {
    const option = field.options[i];
    const isCursor = i === view.optionCursor;
    const selected = field.kind === "multi"
      ? Array.isArray(view.answers[field.id]?.value) && view.answers[field.id].value.includes(option.value)
      : view.answers[field.id]?.value === option.value;
    const arrow = isCursor ? `${T()}>${RESET}` : " ";
    const mark = field.kind === "multi"
      ? selected ? `${OK()}[x]${RESET}` : `${DIM}[ ]${RESET}`
      : selected ? `${OK()}(•)${RESET}` : `${DIM}( )${RESET}`;
    lines.push(` ${arrow} ${mark} ${isCursor ? `${TXT()}${BOLD}${option.label}${RESET}` : `${TXT()}${option.label}${RESET}`}`);
    if (option.description) {
      for (const wrapped of wordWrap(option.description, Math.max(16, width - 8))) {
        lines.push(`     ${MUTED()}${wrapped}${RESET}`);
      }
    }
  }

  return lines;
}

function appWrap(view: QuestionView, text: string, width: number): string[] {
  const lines = text.split("\n");
  const wrapped: string[] = [];
  for (const line of lines) {
    const chunks = line.length === 0 ? [""] : wordWrap(line, Math.max(8, width - 2));
    wrapped.push(...chunks);
  }
  return wrapped;
}

function buildFooter(view: QuestionView): string {
  if (isSubmitTab(view)) return `${DIM}enter submit · esc cancel${RESET}`;
  const field = currentField(view);
  if (!field) return `${DIM}esc cancel${RESET}`;
  if (field.kind === "text") return `${DIM}shift+enter newline · enter next · tab switch · esc cancel${RESET}`;
  if (field.kind === "multi") return `${DIM}space toggle · enter next · tab switch · esc cancel${RESET}`;
  return `${DIM}↑↓ move · enter select · tab switch · esc cancel${RESET}`;
}

export function drawQuestionView(app: AppState): void {
  const view = app.questionView as QuestionView;
  const { width, height } = app.screen;
  const separatorColor = app.getModeAccent();
  const innerWidth = Math.max(24, width - 2);
  const bodyHeight = Math.max(1, height - 4);
  const lines: string[] = [];
  lines.push(`${separatorColor}${"─".repeat(width)}${RESET}`);
  const currentIndex = Math.min(view.questions.length + 1, Math.max(1, view.activeIndex + 1));
  const headerLeft = `${T()}${BOLD}${view.title}${RESET} ${DIM}(${currentIndex}/${view.questions.length + 1})${RESET}`;
  const headerRight = `${DIM}esc cancel${RESET}`;
  const spacer = Math.max(1, innerWidth - visibleWidth(headerLeft) - visibleWidth(headerRight));
  lines.push(` ${headerLeft}${" ".repeat(spacer)}${headerRight}`);
  const body: string[] = [];
  body.push(...renderTabs(view, innerWidth));
  if (body.length > 0) body.push("");
  body.push(...renderCurrentField(view, innerWidth));
  body.push("");
  body.push(buildFooter(view));
  for (let i = 0; i < bodyHeight; i++) lines.push(padLine(body[i] ?? "", width));
  while (lines.length < height) lines.push("");
  app.screen.render(lines.map((line: string) => app.decorateFrameLine(line, width)));

  const field = currentField(view);
  if (field?.kind !== "text" || isSubmitTab(view)) {
    app.screen.hideCursor();
    return;
  }

  const tabsOffset = view.questions.length > 1 ? 2 : 0;
  const promptOffset = 2;
  const editorOffset = tabsOffset + promptOffset;
  const layout = app.getInputCursorLayout(view.editor.getText(), view.editor.getCursor(), innerWidth);
  const row = Math.min(height, 3 + editorOffset + layout.row);
  const col = Math.min(width, 2 + layout.col);
  app.screen.setCursor(row, col);
}

export function handleQuestionViewKey(app: AppState, key: Keypress): void {
  const view = app.questionView as QuestionView;
  if (!view) return;

  if (key.name === "escape" || (key.ctrl && key.name === "c")) {
    finishQuestionView(app, true);
    return;
  }

  if ((key.name === "tab" && !key.shift) || key.name === "right") {
    moveQuestion(view, 1);
    app.draw();
    return;
  }
  if ((key.name === "tab" && key.shift) || key.name === "left") {
    moveQuestion(view, -1);
    app.draw();
    return;
  }

  if (isSubmitTab(view)) {
    if ((key.name === "return" || key.name === "enter") && !key.shift && !key.meta && !key.ctrl && allRequiredAnswered(view)) {
      finishQuestionView(app, false);
      return;
    }
    app.draw();
    return;
  }

  const field = currentField(view);
  if (!field) {
    app.draw();
    return;
  }

  if (field.kind === "text") {
    if (key.name === "up" || key.name === "down") {
      app.draw();
      return;
    }
    if ((key.name === "return" || key.name === "enter") && !key.shift && !key.meta && !key.ctrl) {
      if (storeTextAnswer(view, field)) {
        advanceAfterAnswer(app);
      } else {
        app.draw();
      }
      return;
    }
    view.editor.handleKey(key);
    app.draw();
    return;
  }

  if (key.name === "up") {
    view.optionCursor = Math.max(0, view.optionCursor - 1);
    app.draw();
    return;
  }
  if (key.name === "down") {
    view.optionCursor = Math.min(field.options.length - 1, view.optionCursor + 1);
    app.draw();
    return;
  }

  const option = field.options[view.optionCursor];
  if (!option) {
    app.draw();
    return;
  }

  if (field.kind === "multi" && key.name === "space") {
    toggleMultiAnswer(view, field, option);
    app.draw();
    return;
  }

  if ((key.name === "return" || key.name === "enter") && !key.shift && !key.meta && !key.ctrl) {
    if (field.kind === "single") {
      storeSingleAnswer(view, field, option);
      advanceAfterAnswer(app);
      return;
    }
    if (field.kind === "multi") {
      const answer = view.answers[field.id];
      if (field.required && (!answer || !Array.isArray(answer.value) || answer.value.length === 0)) {
        app.draw();
        return;
      }
      advanceAfterAnswer(app);
      return;
    }
  }

  app.draw();
}
