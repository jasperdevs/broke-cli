import type { InputElement } from "./input.js";

type AppState = any;

export function getFileChipLabel(file: string): string {
  return `[${file.split(/[\\/]/).pop() || file}]`;
}

export function getImageChipLabel(index: number): string {
  return `[Image #${index + 1}]`;
}

function getComposerElements(app: AppState): InputElement[] {
  return app.input.getElements?.() ?? [];
}

export function ensureInlineChipElements(app: AppState): void {
  const text = app.input.getText();
  const existing = getComposerElements(app);
  const preserved = existing.filter((element) => element.kind !== "image");
  const rebuilt: InputElement[] = [...preserved];

  for (let index = 0; index < (app.pendingImages?.length ?? 0); index++) {
    const attachment = app.pendingImages[index];
    const attachmentId = attachment?.attachmentId ?? `image:${index}`;
    if (attachment && !attachment.attachmentId) attachment.attachmentId = attachmentId;
    const label = getImageChipLabel(index);
    let searchFrom = 0;
    let occurrence = 0;
    while (searchFrom < text.length) {
      const start = text.indexOf(label, searchFrom);
      if (start < 0) break;
      const existingElement = existing.find((element) =>
        element.kind === "image"
        && String((element.meta as { attachmentId?: string } | undefined)?.attachmentId ?? "") === attachmentId
        && element.start === start,
      );
      rebuilt.push(existingElement ?? {
        id: attachmentId,
        kind: "image",
        label,
        start,
        end: start + label.length,
        meta: { attachmentId },
      });
      occurrence++;
      searchFrom = start + label.length;
    }
  }

  app.input.replaceElements(rebuilt.sort((a, b) => a.start - b.start));
}

export function hydrateInlineComposerElements(app: AppState): void {
  if ((app.input.getElements?.() ?? []).length > 0) return;
  const text = app.input.getText();
  const cursor = app.input.getCursor();
  const elements: InputElement[] = [];

  for (let index = 0; index < (app.pendingImages?.length ?? 0); index++) {
    const attachment = app.pendingImages[index];
    const attachmentId = attachment?.attachmentId ?? `image:${index}`;
    if (attachment && !attachment.attachmentId) attachment.attachmentId = attachmentId;
    const label = getImageChipLabel(index);
    let searchFrom = 0;
    while (searchFrom < text.length) {
      const start = text.indexOf(label, searchFrom);
      if (start < 0) break;
      elements.push({
        id: attachmentId,
        kind: "image",
        label,
        start,
        end: start + label.length,
        meta: { attachmentId },
      });
      searchFrom = start + label.length;
    }
  }

  if (elements.length === 0) return;
  app.input.setText(text, false, elements.sort((a, b) => a.start - b.start));
  app.input.setCursor(cursor);
}

export function insertInlineFileChip(app: AppState, file: string, replaceStart?: number, replaceEnd?: number): void {
  const text = app.input.getText();
  const cursor = app.input.getCursor();
  const insertion = file;
  const start = replaceStart ?? cursor;
  const end = replaceEnd ?? cursor;
  const beforeChar = start > 0 ? text[start - 1] : "";
  const afterChar = text[end] ?? "";
  const prefix = start > 0 && beforeChar !== " " && beforeChar !== "\n" ? " " : "";
  const suffix = afterChar !== " " && afterChar !== "\n" ? " " : "";
  app.input.setText(`${text.slice(0, start)}${prefix}${insertion}${suffix}${text.slice(end)}`, false);
  app.input.setCursor(start + prefix.length + insertion.length + suffix.length);
}

export function insertInlineImageChip(app: AppState, attachmentId: string, replaceStart?: number, replaceEnd?: number): void {
  const index = (app.pendingImages ?? []).findIndex((image: { attachmentId?: string }) => image.attachmentId === attachmentId);
  if (index < 0) return;
  app.input.insertElement(getImageChipLabel(index), "image", {
    id: attachmentId,
    meta: { attachmentId },
    replaceStart,
    replaceEnd,
  });
}

export function syncInlineImageChipLabels(app: AppState): void {
  ensureInlineChipElements(app);
  for (let index = 0; index < (app.pendingImages?.length ?? 0); index++) {
    const attachment = app.pendingImages[index];
    if (!attachment?.attachmentId) continue;
    const element = getComposerElements(app)
      .find((candidate) => candidate.kind === "image" && String((candidate.meta as { attachmentId?: string } | undefined)?.attachmentId ?? "") === attachment.attachmentId);
    if (!element) continue;
    app.input.updateElementLabel(element.id, getImageChipLabel(index));
  }
}

export function removeInlineImageChip(app: AppState, attachmentId: string): void {
  const element = getComposerElements(app)
    .find((candidate) => candidate.kind === "image" && String((candidate.meta as { attachmentId?: string } | undefined)?.attachmentId ?? "") === attachmentId);
  if (!element) return;
  app.input.removeElement(element.id);
}

export function stripInlineChipLabels(app: AppState): string {
  ensureInlineChipElements(app);
  return app.input.sanitizeText(["image"]);
}
