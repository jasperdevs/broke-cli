const runtimeProviderApiKeys = new Map<string, string>();

export function getRuntimeProviderApiKey(provider: string): string | undefined {
  return runtimeProviderApiKeys.get(provider);
}

export function setRuntimeProviderApiKey(provider: string, apiKey: string | null): void {
  if (!apiKey) runtimeProviderApiKeys.delete(provider);
  else runtimeProviderApiKeys.set(provider, apiKey);
}

export function clearRuntimeProviderApiKeys(): void {
  runtimeProviderApiKeys.clear();
}
