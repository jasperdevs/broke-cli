import { createRequire } from "module";
import { listExtensionResources } from "./resources.js";

export type ExtensionHook = (event: { type: string; data: unknown }) => void | Promise<void>;

export interface HookRegistry {
  on(event: string, callback: ExtensionHook): void;
  emit(event: string, data: unknown): Promise<void>;
  reload(): void;
}

export interface ExtensionInfo {
  id: string;
  enabled: boolean;
  path?: string;
  source?: string;
}

function createHookRegistry(): HookRegistry {
  const hooks = new Map<string, ExtensionHook[]>();
  const require = createRequire(import.meta.url);

  function resetHooks(): void {
    hooks.clear();
  }

  function registerExtensions(): void {
    for (const extension of listExtensionResources()) {
      if (!extension.enabled) continue;
      try {
        const modulePath = extension.path;
        const resolvedPath = require.resolve(modulePath);
        delete require.cache[resolvedPath];
        const ext = require(modulePath);
        if (typeof ext.register === "function") {
          ext.register(registry);
        }
      } catch {
        // Skip broken extensions silently
      }
    }
  }

  const registry: HookRegistry = {
    on(event: string, callback: ExtensionHook): void {
      const list = hooks.get(event) ?? [];
      list.push(callback);
      hooks.set(event, list);
    },

    async emit(event: string, data: unknown): Promise<void> {
      const list = hooks.get(event);
      if (!list) return;
      for (const cb of list) {
        try {
          await cb({ type: event, data });
        } catch {
          // Extensions should not crash the host
        }
      }
    },

    reload(): void {
      resetHooks();
      registerExtensions();
    },
  };

  registerExtensions();
  return registry;
}

export function loadExtensions(): HookRegistry {
  return createHookRegistry();
}

export function listExtensions(): ExtensionInfo[] {
  return listExtensionResources().map((entry) => ({
    id: entry.id,
    enabled: entry.enabled,
    path: entry.path,
    source: entry.source,
  }));
}
