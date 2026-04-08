import {
  DEFAULT_SETTINGS,
  flushConfig,
  getSettings,
  loadGlobalConfig,
  loadProjectConfig,
  type PackageSource,
  type Settings,
  updateSetting,
  updateSettingsPatch,
} from "./config.js";

export class SettingsManager {
  private readonly inMemoryOnly: boolean;
  private settings: Settings;
  private readonly errors: string[] = [];

  private constructor(settings: Settings, inMemoryOnly: boolean) {
    this.settings = settings;
    this.inMemoryOnly = inMemoryOnly;
  }

  static create(): SettingsManager {
    return new SettingsManager(getSettings(), false);
  }

  static inMemory(settings?: Partial<Settings>): SettingsManager {
    return new SettingsManager({
      ...DEFAULT_SETTINGS,
      ...settings,
      compaction: { ...DEFAULT_SETTINGS.compaction, ...(settings?.compaction ?? {}) },
      retry: { ...DEFAULT_SETTINGS.retry, ...(settings?.retry ?? {}) },
      terminal: { ...DEFAULT_SETTINGS.terminal, ...(settings?.terminal ?? {}) },
      images: { ...DEFAULT_SETTINGS.images, ...(settings?.images ?? {}) },
      markdown: { ...DEFAULT_SETTINGS.markdown, ...(settings?.markdown ?? {}) },
      thinkingBudgets: { ...DEFAULT_SETTINGS.thinkingBudgets, ...(settings?.thinkingBudgets ?? {}) },
    }, true);
  }

  get(): Settings {
    return this.inMemoryOnly ? this.settings : getSettings();
  }

  applyOverrides(overrides: Partial<Settings>): void {
    this.settings = {
      ...this.get(),
      ...overrides,
      compaction: { ...this.get().compaction, ...(overrides.compaction ?? {}) },
      retry: { ...this.get().retry, ...(overrides.retry ?? {}) },
      terminal: { ...this.get().terminal, ...(overrides.terminal ?? {}) },
      images: { ...this.get().images, ...(overrides.images ?? {}) },
      markdown: { ...this.get().markdown, ...(overrides.markdown ?? {}) },
      thinkingBudgets: { ...this.get().thinkingBudgets, ...(overrides.thinkingBudgets ?? {}) },
    };
  }

  set<K extends keyof Settings>(key: K, value: Settings[K], scope: "global" | "project" = "global"): void {
    if (this.inMemoryOnly) {
      this.settings = { ...this.settings, [key]: value };
      return;
    }
    updateSetting(key, value, scope);
  }

  patch(patch: Partial<Settings>, scope: "global" | "project" = "global"): void {
    if (this.inMemoryOnly) {
      this.applyOverrides(patch);
      return;
    }
    updateSettingsPatch(patch, scope);
  }

  getPackages(scope: "global" | "project" = "global"): PackageSource[] {
    const config = scope === "project" ? loadProjectConfig() : loadGlobalConfig();
    return [...(config.settings?.packages ?? [])];
  }

  setPackages(packages: PackageSource[], scope: "global" | "project" = "global"): void {
    this.set("packages", packages, scope);
  }

  async flush(): Promise<void> {
    flushConfig();
  }

  drainErrors(): string[] {
    const drained = [...this.errors];
    this.errors.length = 0;
    return drained;
  }
}
