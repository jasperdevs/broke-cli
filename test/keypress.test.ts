import { describe, expect, it } from "vitest";
import { decodeSpecialKeySequence } from "../src/tui/keypress.js";

describe("decodeSpecialKeySequence", () => {
  it("decodes modified enter sequences across common terminal formats", () => {
    expect(decodeSpecialKeySequence("\x1b[13;2u")).toEqual({ name: "return", char: "", ctrl: false, meta: false, shift: true });
    expect(decodeSpecialKeySequence("\x1b[13;5u")).toEqual({ name: "return", char: "", ctrl: true, meta: false, shift: false });
    expect(decodeSpecialKeySequence("\x1b[27;2;13~")).toEqual({ name: "return", char: "", ctrl: false, meta: false, shift: true });
    expect(decodeSpecialKeySequence("\x1b[27;2;13u")).toEqual({ name: "return", char: "", ctrl: false, meta: false, shift: true });
    expect(decodeSpecialKeySequence("\x1b[13;3~")).toEqual({ name: "return", char: "", ctrl: false, meta: true, shift: false });
  });

  it("decodes linefeed and backspace variants used by modified newline shortcuts", () => {
    expect(decodeSpecialKeySequence("\x1b[10;2u")).toEqual({ name: "linefeed", char: "", ctrl: false, meta: false, shift: true });
    expect(decodeSpecialKeySequence("\x1b[10;6u")).toEqual({ name: "linefeed", char: "", ctrl: true, meta: false, shift: true });
    expect(decodeSpecialKeySequence("\x1b[10;2~")).toEqual({ name: "linefeed", char: "", ctrl: false, meta: false, shift: true });
    expect(decodeSpecialKeySequence("\x1b[27;2;10~")).toEqual({ name: "linefeed", char: "", ctrl: false, meta: false, shift: true });
    expect(decodeSpecialKeySequence("\x1b[27;2;10u")).toEqual({ name: "linefeed", char: "", ctrl: false, meta: false, shift: true });
    expect(decodeSpecialKeySequence("\x1b[127;5u")).toEqual({ name: "backspace", char: "", ctrl: true, meta: false, shift: false });
    expect(decodeSpecialKeySequence("\x1b\r")).toEqual({ name: "return", char: "", ctrl: false, meta: false, shift: true });
    expect(decodeSpecialKeySequence("\x1b[13;2~")).toEqual({ name: "return", char: "", ctrl: false, meta: false, shift: true });
  });
});

describe("escape sequence assembly", () => {
  it("treats partial CSI enter sequences as incomplete until the terminator arrives", () => {
    expect(decodeSpecialKeySequence("\x1b[13;2")).toBeNull();
    expect(decodeSpecialKeySequence("\x1b[13;2u")).toEqual({ name: "return", char: "", ctrl: false, meta: false, shift: true });
  });

  it("keeps split shift-enter sequences decodable once the final chunk arrives", () => {
    const firstChunk = "\x1b[27;2;";
    const secondChunk = "13~";
    expect(decodeSpecialKeySequence(firstChunk)).toBeNull();
    expect(decodeSpecialKeySequence(firstChunk + secondChunk)).toEqual({ name: "return", char: "", ctrl: false, meta: false, shift: true });
  });
});
