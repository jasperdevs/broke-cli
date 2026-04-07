const DEFAULT_SESSION_NAME_RE = /^[A-Z][a-z]{2} \d{1,2} #\d{4}$/;

export function createDefaultSessionName(now = new Date(), randomNumber = Math.floor(1000 + Math.random() * 9000)): string {
  const stamp = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const safeNumber = Math.max(1000, Math.min(9999, Math.floor(randomNumber)));
  return `${stamp} #${safeNumber}`;
}

export function isDefaultSessionName(name: string | null | undefined): boolean {
  const trimmed = name?.trim() ?? "";
  return !trimmed || trimmed === "New Session" || DEFAULT_SESSION_NAME_RE.test(trimmed);
}
