import { getSettings, updateSetting } from "./config.js";

export function isToolAllowed(name: string): boolean {
  const disabled = new Set(getSettings().disabledTools ?? []);
  return !disabled.has(name);
}

export function isExtensionEnabled(name: string): boolean {
  return !(getSettings().disabledExtensions ?? []).includes(name);
}

export function toggleExtensionEnabled(name: string): boolean {
  const settings = getSettings();
  const disabled = new Set(settings.disabledExtensions ?? []);
  if (disabled.has(name)) disabled.delete(name);
  else disabled.add(name);
  updateSetting("disabledExtensions", [...disabled].sort());
  return !disabled.has(name);
}
