type AppState = any;

export function getFileChipLabel(file: string): string {
  return `[${file.split(/[\\/]/).pop() || file}]`;
}

export function getImageChipLabel(index: number): string {
  return `[Image #${index + 1}]`;
}

function countInlineImageChips(text: string): number {
  return (text.match(/\[Image #\d+\]/g) ?? []).length;
}

export function snapCursorOutsideInlineChip(app: AppState): void {
  const text = app.input.getText();
  const cursor = app.input.getCursor();
  const labels = [
    ...(Array.from(app.fileContexts?.keys?.() ?? []) as string[]).map(getFileChipLabel),
    ...Array.from({ length: app.pendingImages?.length ?? 0 }, (_, index) => getImageChipLabel(index)),
  ];
  for (const label of labels) {
    let searchFrom = 0;
    while (searchFrom < text.length) {
      const index = text.indexOf(label, searchFrom);
      if (index < 0) break;
      const end = index + label.length;
      if (cursor > index && cursor < end) {
        app.input.setCursor(end);
        return;
      }
      searchFrom = end;
    }
  }
}

export function insertInlineImageChip(app: AppState): void {
  const label = getImageChipLabel((app.pendingImages?.length ?? 1) - 1);
  const text = app.input.getText();
  const cursor = app.input.getCursor();
  const trailingSpace = text[cursor] === " " || text[cursor] === "\n" ? "" : " ";
  app.input.setText(`${text.slice(0, cursor)}${label}${trailingSpace}${text.slice(cursor)}`, false);
  app.input.setCursor(cursor + label.length + trailingSpace.length);
}

export function ensureInlineImageChips(app: AppState): void {
  const missingCount = Math.max(0, (app.pendingImages?.length ?? 0) - countInlineImageChips(app.input.getText()));
  for (let i = 0; i < missingCount; i++) insertInlineImageChip(app);
}

export function stripInlineChipLabels(app: AppState, text: string): string {
  let sanitized = text;
  for (const file of Array.from(app.fileContexts?.keys?.() ?? []) as string[]) {
    sanitized = sanitized.split(getFileChipLabel(file)).join("");
  }
  for (let index = 0; index < (app.pendingImages?.length ?? 0); index++) {
    sanitized = sanitized.split(getImageChipLabel(index)).join("");
  }
  return sanitized.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
}
