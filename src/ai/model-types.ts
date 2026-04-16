export interface ModelPricing {
  input: number;
  output: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface ModelLimits {
  context?: number;
  input?: number;
  output?: number;
}

export interface ModelSpec {
  id: string;
  name: string;
  family?: string;
  cost?: ModelPricing;
  limit: ModelLimits;
  providerId: string;
  attachment?: boolean;
  reasoning?: boolean;
  toolCall?: boolean;
  modalities?: {
    input?: string[];
    output?: string[];
  };
}
