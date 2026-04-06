import { loadConfig } from "./config.js";

export interface BudgetCheck {
  allowed: boolean;
  warning?: string;
}

export function checkBudget(sessionCost: number): BudgetCheck {
  const config = loadConfig();
  const maxSession = config.budget?.maxSessionCost;

  if (maxSession && sessionCost >= maxSession) {
    return {
      allowed: false,
      warning: `Session budget exceeded ($${sessionCost.toFixed(4)} / $${maxSession.toFixed(2)} max). Use /clear to reset or increase budget in ~/.brokecli/config.json`,
    };
  }

  if (maxSession && sessionCost >= maxSession * 0.8) {
    return {
      allowed: true,
      warning: `Approaching session budget limit ($${sessionCost.toFixed(4)} / $${maxSession.toFixed(2)})`,
    };
  }

  return { allowed: true };
}
