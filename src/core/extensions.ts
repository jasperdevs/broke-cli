import { join } from "path";
import { homedir } from "os";
import { readdirSync, existsSync } from "fs";
import { createRequire } from "module";
import { isExtensionEnabled } from "./permissions.js";

export type ExtensionHook = (event: { type: string; data: unknown }) => void | Promise<void>;

export interface HookRegistry {
  on(event: string, callback: ExtensionHook): void;
  emit(event: string, data: unknown): Promise<void>;
}

export interface ExtensionInfo {
  id: string;
  enabled: boolean;
}

function createHookRegistry(): HookRegistry {
  const hooks = new Map<string, ExtensionHook[]>();

  return {
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
  };
}

export function loadExtensions(): HookRegistry {
  const registry = createHookRegistry();
  const extDir = join(homedir(), ".brokecli", "extensions");

  if (!existsSync(extDir)) return registry;

  let files: string[];
  try {
    files = readdirSync(extDir).filter((f) => f.endsWith(".js"));
  } catch {
    return registry;
  }

  const require = createRequire(import.meta.url);

  for (const file of files) {
    const extensionId = file.replace(/\.js$/i, "");
    if (!isExtensionEnabled(extensionId)) continue;
    try {
      const ext = require(join(extDir, file));
      if (typeof ext.register === "function") {
        ext.register(registry);
      }
    } catch {
      // Skip broken extensions silently
    }
  }

  return registry;
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
