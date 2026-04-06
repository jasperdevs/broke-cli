import { handleKey, handlePaste } from "./app-input-methods.js";
import type { Keypress } from "./keypress.js";

type AppState = any;

export interface AppInputMethods {
  handleKey(key: Keypress): void;
  handlePaste(text: string): void;
}

export const appInputMethods: AppInputMethods = {
  handleKey(this: AppState, key: Keypress) { return handleKey(this, key); },
  handlePaste(this: AppState, text: string) { return handlePaste(this, text); },
};
