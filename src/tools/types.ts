import type { Tool } from "ai";
import type { PermissionLevel } from "../safety/types.js";

/** A registered tool with metadata */
export interface ToolDefinition {
  /** The AI SDK tool object */
  tool: Tool;
  /** Display name */
  name: string;
  /** Where this tool came from */
  source: "builtin" | "mcp";
  /** Permission level */
  permission: PermissionLevel;
  /** Whether this tool is read-only (safe for plan mode) */
  readOnly: boolean;
}

/** The tool registry provides all available tools */
export interface ToolRegistry {
  /** Get all registered tools */
  all(): Record<string, ToolDefinition>;
  /** Get only read-only tools (for plan mode) */
  readOnly(): Record<string, ToolDefinition>;
  /** Get the AI SDK tools record for passing to streamText */
  forModel(planMode?: boolean): Record<string, Tool>;
  /** Register a tool */
  register(name: string, def: ToolDefinition): void;
}
