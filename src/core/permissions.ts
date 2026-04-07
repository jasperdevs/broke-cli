import { getSettings, updateSetting } from "./config.js";

export function isToolAllowed(name: string): boolean {
  const denied = new Set(getSettings().deniedTools ?? []);
  return !denied.has(name);
}

export function toggleToolPermission(name: string): boolean {
  const settings = getSettings();
  const denied = new Set(settings.deniedTools ?? []);
  if (denied.has(name)) denied.delete(name);
  else denied.add(name);
  updateSetting("deniedTools", [...denied].sort());
  return denied.has(name);
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
