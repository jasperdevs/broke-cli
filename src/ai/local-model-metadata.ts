export interface LocalModelMetadata {
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  toolCall?: boolean;
  input?: Array<"text" | "image">;
  quantization?: string;
  parameterSize?: string;
  architecture?: string;
  source?: string;
}

const localModelMetadata = new Map<string, Map<string, LocalModelMetadata>>();

export function clearLocalModelMetadata(): void {
  localModelMetadata.clear();
}

export function setLocalProviderModelMetadata(providerId: string, metadata: Record<string, LocalModelMetadata>): void {
  localModelMetadata.set(providerId, new Map(Object.entries(metadata)));
}

export function getLocalModelMetadata(providerId: string, modelId: string): LocalModelMetadata | null {
  return localModelMetadata.get(providerId)?.get(modelId) ?? null;
}
