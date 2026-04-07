export type OAuthProviderId =
  | "anthropic"
  | "github-copilot"
  | "google-gemini-cli"
  | "google-antigravity"
  | "codex";

export type OAuthProviderKind = "external-cli" | "github-cli" | "google-browser-oauth";

export interface OAuthProviderSpec {
  id: OAuthProviderId;
  label: string;
  kind: OAuthProviderKind;
  command?: string;
  args?: string[];
}

export const OAUTH_PROVIDERS: OAuthProviderSpec[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude Pro/Max)",
    kind: "external-cli",
    command: "claude",
    args: ["auth", "login"],
  },
  {
    id: "github-copilot",
    label: "GitHub Copilot",
    kind: "github-cli",
    command: "gh",
  },
  {
    id: "google-gemini-cli",
    label: "Google Cloud Code Assist (Gemini CLI)",
    kind: "google-browser-oauth",
  },
  {
    id: "google-antigravity",
    label: "Antigravity (Gemini 3, Claude, GPT-OSS)",
    kind: "google-browser-oauth",
  },
  {
    id: "codex",
    label: "ChatGPT Plus/Pro (Codex Subscription)",
    kind: "external-cli",
    command: "codex",
    args: ["login"],
  },
];

export function getOAuthProviderSpec(providerId: string): OAuthProviderSpec | undefined {
  return OAUTH_PROVIDERS.find((provider) => provider.id === providerId);
}
