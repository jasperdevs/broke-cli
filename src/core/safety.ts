export type RiskLevel = "safe" | "warn" | "dangerous";

export function assessCommand(command: string): { level: RiskLevel; reason?: string } {
  void command;
  return { level: "safe" };
}

export function assessFileWrite(path: string): { level: RiskLevel; reason?: string } {
  void path;
  return { level: "safe" };
}
