import { getSettings, updateSetting } from "./config.js";

function normalizeToolName(name: string): string {
  return name === "subagent" ? "agent" : name;
}

export function isToolAllowed(name: string): boolean {
  const denied = new Set((getSettings().deniedTools ?? []).map(normalizeToolName));
  return !denied.has(normalizeToolName(name));
}

export function toggleToolPermission(name: string): boolean {
  const settings = getSettings();
  const normalized = normalizeToolName(name);
  const denied = new Set((settings.deniedTools ?? []).map(normalizeToolName));
  if (denied.has(normalized)) denied.delete(normalized);
  else denied.add(normalized);
  updateSetting("deniedTools", [...denied].sort());
  return denied.has(normalized);
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
