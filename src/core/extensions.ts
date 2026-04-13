import { createRequire } from "module";
import type { ToolSet } from "ai";
import type { RegisteredSlashCommand } from "../cli/slash-command-registry.js";
import type { ParsedSlashCommand, SlashCommandResult } from "../cli/slash-command-types.js";
import type { ThemePalette } from "./theme-types.js";
import { listExtensionResources } from "./resources.js";
import { clearRegisteredThemes, registerThemePalettes } from "./themes.js";

export type ExtensionHook = (event: { type: string; data: unknown }) => void | Promise<void>;
export type ExtensionSlashCommand = RegisteredSlashCommand<ParsedSlashCommand, SlashCommandResult>;
export interface ExtensionProviderSurface {
  id: string;
  name: string;
}

export interface HookRegistry {
  on(event: string, callback: ExtensionHook): void;
  emit(event: string, data: unknown): Promise<void>;
  registerTools(tools: ToolSet): void;
  getTools(): ToolSet;
  registerSlashCommands(commands: ExtensionSlashCommand[]): void;
  getSlashCommands(): ExtensionSlashCommand[];
  registerThemes(themes: ThemePalette[]): void;
  getThemes(): ThemePalette[];
  getLoadErrors(): Record<string, string>;
  reload(): void;
}

export interface ExtensionInfo {
  id: string;
  enabled: boolean;
  path?: string;
  source?: string;
  loaded?: boolean;
  error?: string;
}

let lastExtensionLoadErrors = new Map<string, string>();
let lastLoadedExtensions = new Set<string>();

function createHookRegistry(): HookRegistry {
  const hooks = new Map<string, ExtensionHook[]>();
  const tools: ToolSet[] = [];
  const slashCommands: ExtensionSlashCommand[] = [];
  const themes: ThemePalette[] = [];
  const loadErrors = new Map<string, string>();
  const loadedExtensions = new Set<string>();
  const require = createRequire(import.meta.url);

  function resetHooks(): void {
    hooks.clear();
    tools.length = 0;
    slashCommands.length = 0;
    themes.length = 0;
    loadErrors.clear();
    loadedExtensions.clear();
    clearRegisteredThemes();
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
          loadedExtensions.add(extension.id);
        }
      } catch (error) {
        loadErrors.set(extension.id, error instanceof Error ? error.message : String(error));
      }
    }
    lastExtensionLoadErrors = new Map(loadErrors);
    lastLoadedExtensions = new Set(loadedExtensions);
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

    registerTools(nextTools: ToolSet): void {
      tools.push(nextTools);
    },

    getTools(): ToolSet {
      return Object.assign({}, ...tools);
    },

    registerSlashCommands(commands: ExtensionSlashCommand[]): void {
      slashCommands.push(...commands);
    },

    getSlashCommands(): ExtensionSlashCommand[] {
      return [...slashCommands];
    },

    registerThemes(nextThemes: ThemePalette[]): void {
      themes.push(...nextThemes);
      registerThemePalettes(nextThemes);
    },

    getThemes(): ThemePalette[] {
      return [...themes];
    },

    getLoadErrors(): Record<string, string> {
      return Object.fromEntries(loadErrors.entries());
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
  sharedRegistry = createHookRegistry();
  return sharedRegistry;
}

let sharedRegistry: HookRegistry | null = null;

export function getExtensionRegistry(): HookRegistry {
  if (!sharedRegistry) sharedRegistry = createHookRegistry();
  return sharedRegistry;
}

export function getExtensionTools(): ToolSet {
  return getExtensionRegistry().getTools();
}

export function getExtensionSlashCommands(): ExtensionSlashCommand[] {
  return getExtensionRegistry().getSlashCommands();
}

export function reloadExtensions(): HookRegistry {
  return loadExtensions();
}

export function listExtensions(): ExtensionInfo[] {
  return listExtensionResources().map((entry) => ({
    id: entry.id,
    enabled: entry.enabled,
    path: entry.path,
    source: entry.source,
    loaded: lastLoadedExtensions.has(entry.id),
    error: lastExtensionLoadErrors.get(entry.id),
  }));
}
