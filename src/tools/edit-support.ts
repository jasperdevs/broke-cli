export interface EditReplacement {
  oldText: string;
  newText: string;
}

export interface EditApplyResult {
  content: string;
  diff: string;
  firstChangedLine: number;
  oldLineCount: number;
  newLineCount: number;
  editCount: number;
}

function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function buildDiff(path: string, content: string, edits: Array<EditReplacement & { start: number }>): string {
  const lines = [`--- ${path}`, `+++ ${path}`];
  for (const edit of edits) {
    lines.push(`@@ line ${lineNumberAt(content, edit.start)} @@`);
    lines.push(...normalizeLineEndings(edit.oldText).split("\n").map((line) => `-${line}`));
    lines.push(...normalizeLineEndings(edit.newText).split("\n").map((line) => `+${line}`));
  }
  return lines.join("\n");
}

export function normalizeEditReplacements(input: {
  old_string?: string;
  new_string?: string;
  edits?: Array<{ oldText?: string; newText?: string; old_string?: string; new_string?: string }>;
}): EditReplacement[] {
  const edits = (input.edits ?? [])
    .map((edit) => ({ oldText: edit.oldText ?? edit.old_string ?? "", newText: edit.newText ?? edit.new_string ?? "" }))
    .filter((edit) => edit.oldText || edit.newText);
  if (typeof input.old_string === "string" || typeof input.new_string === "string") {
    edits.push({ oldText: input.old_string ?? "", newText: input.new_string ?? "" });
  }
  return edits;
}

export function applyEditReplacements(path: string, content: string, edits: EditReplacement[]): EditApplyResult {
  if (edits.length === 0) throw new Error("edits must contain at least one replacement");
  const ranges = edits.map((edit) => {
    if (!edit.oldText) throw new Error("oldText must not be empty");
    const first = content.indexOf(edit.oldText);
    if (first < 0) throw new Error("old_string not found in file");
    if (content.indexOf(edit.oldText, first + edit.oldText.length) >= 0) throw new Error("old_string must match exactly once");
    return { ...edit, start: first, end: first + edit.oldText.length };
  }).sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i]!.start < ranges[i - 1]!.end) throw new Error("edits must not overlap");
  }
  let next = "";
  let cursor = 0;
  for (const range of ranges) {
    next += content.slice(cursor, range.start) + range.newText;
    cursor = range.end;
  }
  next += content.slice(cursor);
  return {
    content: next,
    diff: buildDiff(path, content, ranges),
    firstChangedLine: lineNumberAt(content, ranges[0]!.start),
    oldLineCount: ranges.reduce((sum, edit) => sum + edit.oldText.split("\n").length, 0),
    newLineCount: ranges.reduce((sum, edit) => sum + edit.newText.split("\n").length, 0),
    editCount: ranges.length,
  };
}
