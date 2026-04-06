import { join } from "path";
import { homedir } from "os";
import { readdirSync, existsSync } from "fs";
import { createRequire } from "module";
import { isExtensionEnabled } from "./permissions.js";

export type ExtensionHook = (event: { type: string; data: unknown }) => void | Promise<void>;

export interface HookRegistry {
  on(event: string, callback: ExtensionHook): void;
  emit(event: string, data: unknown): Promise<void>;
  reload(): void;
}

export interface ExtensionInfo {
  id: string;
  enabled: boolean;
}

function createHookRegistry(): HookRegistry {
  const hooks = new Map<string, ExtensionHook[]>();
  const extDir = join(homedir(), ".brokecli", "extensions");
  const require = createRequire(import.meta.url);

  function resetHooks(): void {
    hooks.clear();
  }

  function registerExtensions(): void {
    if (!existsSync(extDir)) return;

    let files: string[];
    try {
      files = readdirSync(extDir).filter((f) => f.endsWith(".js"));
    } catch {
      return;
    }

    for (const file of files) {
      const extensionId = file.replace(/\.js$/i, "");
      if (!isExtensionEnabled(extensionId)) continue;
      try {
        const modulePath = join(extDir, file);
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
  const extDir = join(homedir(), ".brokecli", "extensions");
  if (!existsSync(extDir)) return [];
  try {
    return readdirSync(extDir)
      .filter((file) => file.endsWith(".js"))
      .map((file) => {
        const id = file.replace(/\.js$/i, "");
        return { id, enabled: isExtensionEnabled(id) };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}
