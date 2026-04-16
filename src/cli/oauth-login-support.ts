import { createHash, randomBytes } from "crypto";
import { spawnSync } from "child_process";
import { saveCredentials } from "../core/auth.js";

type LoginApp = {
  showQuestion(prompt: string, options?: string[]): Promise<string>;
  setStatus?(message: string): void;
};

function setLoginStatus(app: LoginApp, message: string): void {
  app.setStatus?.(message);
}

const COPILOT_GITHUB_ENV_KEYS = ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"] as const;
const COPILOT_HEADERS = {
  "User-Agent": "GitHubCopilotChat/0.35.0",
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": "copilot-chat/0.35.0",
  "Copilot-Integration-Id": "vscode-chat",
} as const;

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";

const GEMINI_REDIRECT_URI = "http://localhost:8085/oauth2callback";
const GEMINI_CLIENT_ID = decodeBase64(
  "NjgxMjU1ODA5Mzk1LW9vOGZ0Mm9wcmRybnA5ZTNhcWY2YXYzaG1kaWIxMzVqLmFwcHMuZ29vZ2xldXNlcmNvbnRlbnQuY29t",
);
const GEMINI_CLIENT_SECRET = decodeBase64("R09DU1BYLTR1SGdNUG0tMW83U2stZ2VWNkN1NWNsWEZzeGw=");

const ANTIGRAVITY_REDIRECT_URI = "http://localhost:51121/oauth-callback";
const ANTIGRAVITY_CLIENT_ID = decodeBase64(
  "MTA3MTAwNjA2MDU5MS10bWhzc2luMmgyMWxjcmUyMzV2dG9sb2poNGc0MDNlcC5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==",
);
const ANTIGRAVITY_CLIENT_SECRET = decodeBase64("R09DU1BYLUs1OEZXUjQ4NkxkTEoxbUxCOHNYQzR6NnFEQWY=");
const ANTIGRAVITY_DEFAULT_PROJECT_ID = "rising-fact-p41fc";

const GEMINI_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

const ANTIGRAVITY_SCOPES = [
  ...GEMINI_SCOPES,
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];

function decodeBase64(value: string): string {
  return Buffer.from(value, "base64").toString("utf-8");
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function openExternalUrl(url: string): boolean {
  try {
    if (process.platform === "win32") {
      const result = spawnSync("cmd", ["/c", "start", "", url], { stdio: "ignore", windowsHide: true });
      return !result.error;
    }
    if (process.platform === "darwin") {
      const result = spawnSync("open", [url], { stdio: "ignore" });
      return !result.error;
    }
    const result = spawnSync("xdg-open", [url], { stdio: "ignore" });
    return !result.error;
  } catch {
    return false;
  }
}

function parseRedirectUrl(input: string): { code?: string; state?: string } {
  const trimmed = input.trim();
  if (!trimmed) return {};
  if (!URL.canParse(trimmed)) return {};
  const url = new URL(trimmed);
  return {
    code: url.searchParams.get("code") ?? undefined,
    state: url.searchParams.get("state") ?? undefined,
  };
}

async function exchangeGoogleAuthCode(options: {
  code: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      code: options.code,
      grant_type: "authorization_code",
      redirect_uri: options.redirectUri,
      code_verifier: options.verifier,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${await response.text()}`);
  }

  const payload = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!payload.access_token || !payload.refresh_token || !payload.expires_in) {
    throw new Error("Google OAuth did not return access and refresh tokens.");
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn: payload.expires_in,
  };
}

async function getGoogleUserEmail(accessToken: string): Promise<string | undefined> {
  try {
    const response = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return undefined;
    const payload = await response.json() as { email?: string };
    return payload.email;
  } catch {
    return undefined;
  }
}

function isVpcScAffectedUser(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return false;
  const error = (payload as { error?: { details?: Array<{ reason?: string }> } }).error;
  if (!error?.details) return false;
  return error.details.some((detail) => detail.reason === "SECURITY_POLICY_VIOLATED");
}

function getDefaultTier(allowedTiers?: Array<{ id?: string; isDefault?: boolean }>): { id?: string } {
  if (!allowedTiers || allowedTiers.length === 0) return { id: "legacy-tier" };
  return allowedTiers.find((tier) => tier.isDefault) ?? { id: "legacy-tier" };
}

async function discoverGeminiProject(accessToken: string): Promise<string> {
  const envProjectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": "google-api-nodejs-client/9.15.1",
    "X-Goog-Api-Client": "gl-node/24.11.1",
  };

  const loadResponse = await fetch(`${GOOGLE_CODE_ASSIST_ENDPOINT}/v1internal:loadCodeAssist`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      cloudaicompanionProject: envProjectId,
      metadata: {
        ideType: "IDE_UNSPECIFIED",
        platform: "PLATFORM_UNSPECIFIED",
        pluginType: "GEMINI",
        duetProject: envProjectId,
      },
    }),
  });

  let payload: {
    cloudaicompanionProject?: string;
    currentTier?: { id?: string };
    allowedTiers?: Array<{ id?: string; isDefault?: boolean }>;
  };

  if (!loadResponse.ok) {
    let errorPayload: unknown;
    try {
      errorPayload = await loadResponse.clone().json();
    } catch {
      errorPayload = undefined;
    }
    if (isVpcScAffectedUser(errorPayload)) {
      payload = { currentTier: { id: "standard-tier" } };
    } else {
      throw new Error(`Cloud Code Assist discovery failed: ${await loadResponse.text()}`);
    }
  } else {
    payload = await loadResponse.json() as {
      cloudaicompanionProject?: string;
      currentTier?: { id?: string };
      allowedTiers?: Array<{ id?: string; isDefault?: boolean }>;
    };
  }

  if (payload.currentTier) {
    if (payload.cloudaicompanionProject) return payload.cloudaicompanionProject;
    if (envProjectId) return envProjectId;
    throw new Error("Google Cloud Code Assist needs GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID for this account.");
  }

  const tierId = getDefaultTier(payload.allowedTiers).id ?? "free-tier";
  if (tierId !== "free-tier" && !envProjectId) {
    throw new Error("Google Cloud Code Assist needs GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID for this account.");
  }

  const onboardBody: Record<string, unknown> = {
    tierId,
    metadata: {
      ideType: "IDE_UNSPECIFIED",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
    },
  };
  if (tierId !== "free-tier" && envProjectId) {
    onboardBody.cloudaicompanionProject = envProjectId;
    (onboardBody.metadata as Record<string, unknown>).duetProject = envProjectId;
  }

  const onboardResponse = await fetch(`${GOOGLE_CODE_ASSIST_ENDPOINT}/v1internal:onboardUser`, {
    method: "POST",
    headers,
    body: JSON.stringify(onboardBody),
  });
  if (!onboardResponse.ok) {
    throw new Error(`Cloud Code Assist onboarding failed: ${await onboardResponse.text()}`);
  }

  const onboardPayload = await onboardResponse.json() as {
    response?: { cloudaicompanionProject?: { id?: string } };
  };

  return onboardPayload.response?.cloudaicompanionProject?.id ?? envProjectId ?? "";
}

async function discoverAntigravityProject(accessToken: string): Promise<string> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": "google-api-nodejs-client/9.15.1",
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "Client-Metadata": JSON.stringify({
      ideType: "IDE_UNSPECIFIED",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
    }),
  };

  for (const endpoint of ["https://cloudcode-pa.googleapis.com", "https://daily-cloudcode-pa.sandbox.googleapis.com"]) {
    try {
      const response = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          metadata: {
            ideType: "IDE_UNSPECIFIED",
            platform: "PLATFORM_UNSPECIFIED",
            pluginType: "GEMINI",
          },
        }),
      });
      if (!response.ok) continue;
      const payload = await response.json() as {
        cloudaicompanionProject?: string | { id?: string };
      };
      if (typeof payload.cloudaicompanionProject === "string" && payload.cloudaicompanionProject) {
        return payload.cloudaicompanionProject;
      }
      if (payload.cloudaicompanionProject && typeof payload.cloudaicompanionProject === "object" && payload.cloudaicompanionProject.id) {
        return payload.cloudaicompanionProject.id;
      }
    } catch {
      // fall through
    }
  }

  return ANTIGRAVITY_DEFAULT_PROJECT_ID;
}

async function runGoogleBrowserLogin(options: {
  app: LoginApp;
  providerId: "google-gemini-cli" | "google-antigravity";
  label: string;
}): Promise<void> {
  const { app, providerId, label } = options;
  const { verifier, challenge } = generatePkce();
  const redirectUri = providerId === "google-gemini-cli" ? GEMINI_REDIRECT_URI : ANTIGRAVITY_REDIRECT_URI;
  const clientId = providerId === "google-gemini-cli" ? GEMINI_CLIENT_ID : ANTIGRAVITY_CLIENT_ID;
  const clientSecret = providerId === "google-gemini-cli" ? GEMINI_CLIENT_SECRET : ANTIGRAVITY_CLIENT_SECRET;
  const scopes = providerId === "google-gemini-cli" ? GEMINI_SCOPES : ANTIGRAVITY_SCOPES;

  const authParams = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: scopes.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: verifier,
    access_type: "offline",
    prompt: "consent",
  });

  const authUrl = `${GOOGLE_AUTH_URL}?${authParams.toString()}`;
  const opened = openExternalUrl(authUrl);
  const prompt = opened
    ? `Complete ${label} login in your browser, then paste the full redirect URL here.`
    : `Open this URL in your browser, finish ${label} login, then paste the full redirect URL here:\n\n${authUrl}`;
  const redirect = (await app.showQuestion(prompt, undefined)).trim();
  if (!redirect || redirect === "[user skipped]") {
    setLoginStatus(app, `${label} login cancelled.`);
    return;
  }

  const parsed = parseRedirectUrl(redirect);
  if (!parsed.code) {
    setLoginStatus(app, `No authorization code found in the pasted ${label} redirect URL.`);
    return;
  }
  if (parsed.state && parsed.state !== verifier) {
    setLoginStatus(app, `${label} login failed because the OAuth state did not match.`);
    return;
  }

  const tokenData = await exchangeGoogleAuthCode({
    code: parsed.code,
    verifier,
    redirectUri,
    clientId,
    clientSecret,
  });
  const email = await getGoogleUserEmail(tokenData.accessToken);
  const projectId = providerId === "google-gemini-cli"
    ? await discoverGeminiProject(tokenData.accessToken)
    : await discoverAntigravityProject(tokenData.accessToken);

  saveCredentials(
    providerId,
    JSON.stringify({
      token: tokenData.accessToken,
      refresh: tokenData.refreshToken,
      projectId,
      email,
    }),
    Date.now() + tokenData.expiresIn * 1000 - 5 * 60 * 1000,
  );
}

function normalizeGitHubDomain(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const candidate = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  if (!URL.canParse(candidate)) return null;
  return new URL(candidate).hostname;
}

function readGitHubCliToken(hostname: string): string | null {
  for (const envKey of COPILOT_GITHUB_ENV_KEYS) {
    const value = process.env[envKey];
    if (value?.trim()) return value.trim();
  }
  try {
    const result = spawnSync("gh", ["auth", "token", "--hostname", hostname], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status !== 0 || result.error) return null;
    const token = result.stdout.trim();
    return token || null;
  } catch {
    return null;
  }
}

async function fetchGitHubCopilotToken(githubToken: string, hostname: string): Promise<{ access: string; expiresAt?: number }> {
  const endpoint = hostname === "github.com"
    ? "https://api.github.com/copilot_internal/v2/token"
    : `https://api.${hostname}/copilot_internal/v2/token`;
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${githubToken}`,
      ...COPILOT_HEADERS,
    },
  });
  if (!response.ok) {
    throw new Error(`Copilot token request failed: ${response.status} ${await response.text()}`);
  }
  const payload = await response.json() as { token?: string; expires_at?: number };
  if (!payload.token) throw new Error("GitHub did not return a Copilot API token.");
  return {
    access: payload.token,
    expiresAt: payload.expires_at ? payload.expires_at * 1000 - 5 * 60 * 1000 : undefined,
  };
}

export async function runGitHubCopilotLogin(app: LoginApp): Promise<void> {
  const hostChoice = await app.showQuestion("GitHub host", ["github.com", "custom"]);
  if (hostChoice === "[user skipped]") {
    setLoginStatus(app, "GitHub Copilot login cancelled.");
    return;
  }
  let hostname = "github.com";
  if (hostChoice === "custom") {
    const input = await app.showQuestion("GitHub Enterprise URL/domain", undefined);
    if (input === "[user skipped]") {
      setLoginStatus(app, "GitHub Copilot login cancelled.");
      return;
    }
    hostname = normalizeGitHubDomain(input.trim()) ?? "";
  }
  if (!hostname) {
    setLoginStatus(app, "Invalid GitHub Enterprise URL/domain.");
    return;
  }

  const args = hostname === "github.com"
    ? ["auth", "login", "--web"]
    : ["auth", "login", "--hostname", hostname, "--web"];
  const result = spawnSync("gh", args, { stdio: "inherit" });
  if (result.status !== 0 || result.error) {
    setLoginStatus(app, "GitHub Copilot login failed or was cancelled.");
    return;
  }

  const token = readGitHubCliToken(hostname);
  if (!token) {
    setLoginStatus(app, "GitHub auth succeeded, but no GitHub token could be read from gh.");
    return;
  }
  const copilot = await fetchGitHubCopilotToken(token, hostname);
  saveCredentials("github-copilot", JSON.stringify({
    access: copilot.access,
    refresh: token,
    hostname,
  }), copilot.expiresAt);
}

export async function runOAuthProviderLogin(options: {
  app: LoginApp;
  providerId: "google-gemini-cli" | "google-antigravity" | "github-copilot";
  label: string;
}): Promise<void> {
  if (options.providerId === "github-copilot") {
    await runGitHubCopilotLogin(options.app);
    return;
  }
  await runGoogleBrowserLogin({
    app: options.app,
    providerId: options.providerId,
    label: options.label,
  });
}
