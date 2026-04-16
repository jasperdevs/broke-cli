export type TruncationKind = "chars" | "entries" | "matches" | "results";

export interface ToolTruncation {
  truncated: true;
  kind: TruncationKind;
  shown: number;
  total?: number;
  limit: number;
}

export interface ToolResultDetails {
  truncation?: ToolTruncation;
  fullOutputPath?: string;
}

export function truncation(kind: TruncationKind, shown: number, limit: number, total?: number): ToolResultDetails {
  return { truncation: { truncated: true, kind, shown, limit, total } };
}
