import { GREEN, GRAY, RESET, DIM } from "../utils/ansi.js";

export interface StatusState {
  message?: string;
  isStreaming: boolean;
}

/** Render the status bar as a single string */
export function renderStatusBar(state: StatusState, _width: number): string {
  if (state.isStreaming) {
    return `${GREEN} ● streaming...${RESET}  ${GRAY}esc${RESET} cancel`;
  }

  if (state.message) {
    return ` ${state.message}`;
  }

  return `${DIM} /help commands  ctrl+c exit${RESET}`;
}
