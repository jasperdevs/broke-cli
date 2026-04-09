import { describe, expect, it } from "vitest";
import { App } from "../src/tui/app.js";
import { createQuestionView, handleQuestionViewKey } from "../src/tui/question-view.js";

describe("input and scroll regressions", () => {
  it("uses Shift+Enter for newline and does not treat Ctrl+J as a multiline shortcut", () => {
    const app = new App() as any;
    let submitted = "";
    app.onSubmit = (text: string) => { submitted = text; };

    app.handlePaste("hello");
    app.handleKey({ name: "return", char: "", ctrl: false, meta: false, shift: true });
    expect(app.input.getText()).toBe("hello\n");

    app.handleKey({ name: "j", char: "\n", ctrl: true, meta: false, shift: false });
    expect(app.input.getText()).toBe("hello\n");

    app.handlePaste("world");
    app.handleKey({ name: "return", char: "", ctrl: false, meta: false, shift: false });
    expect(submitted).toBe("hello\nworld");
  });

  it("normalizes pasted CRLF text and keeps editing/backspace behavior consistent inside it", () => {
    const app = new App() as any;
    app.handlePaste("alpha\r\nbravo\r\ncharlie");
    expect(app.input.getText()).toBe("alpha\nbravo\ncharlie");

    app.input.setCursor("alpha\nbra".length);
    app.handleKey({ name: "x", char: "X", ctrl: false, meta: false, shift: true });
    expect(app.input.getText()).toBe("alpha\nbraXvo\ncharlie");

    app.handleKey({ name: "backspace", char: "", ctrl: false, meta: false, shift: false });
    expect(app.input.getText()).toBe("alpha\nbravo\ncharlie");

    app.handleKey({ name: "backspace", char: "", ctrl: false, meta: false, shift: false });
    expect(app.input.getText()).toBe("alpha\nbrvo\ncharlie");
  });

  it("keeps multiline paste as normal text while moving and deleting across lines", () => {
    const app = new App() as any;
    app.handlePaste("one\ntwo\nthree");
    app.input.setCursor("one\ntwo\n".length);
    app.handleKey({ name: "backspace", char: "", ctrl: false, meta: false, shift: false });
    expect(app.input.getText()).toBe("one\ntwothree");

    app.handleKey({ name: "left", char: "", ctrl: false, meta: false, shift: false });
    app.handleKey({ name: "delete", char: "", ctrl: false, meta: false, shift: false });
    expect(app.input.getText()).toBe("one\ntwthree");
  });

  it("keeps the viewport anchored only when the transcript is actually at the bottom", () => {
    const app = new App() as any;
    let rendered: string[] = [];
    app.screen = {
      height: 12,
      width: 60,
      hasSidebar: false,
      mainWidth: 60,
      sidebarWidth: 0,
      render: (lines: string[]) => { rendered = lines; },
      setCursor: () => {},
      hideCursor: () => {},
      forceRedraw: () => {},
    };
    app.messages = Array.from({ length: 30 }, (_, i) => ({ role: "assistant", content: `message ${i}` }));

    app.scrollToBottom();
    app.appendToLastMessage("\nextra line at bottom");
    app.drawImmediate();
    expect(rendered.join("\n")).toContain("extra line at bottom");

    app.handleKey({ name: "pageup", char: "", ctrl: false, meta: false, shift: false });
    const scrolledUpOffset = app.scrollOffset;
    app.appendToLastMessage("\nnew streamed line");
    expect(app.scrollOffset).toBe(scrolledUpOffset);
    app.drawImmediate();
    expect(rendered.join("\n")).not.toContain("new streamed line");

    app.scrollToBottom();
    app.appendToLastMessage("\nfinal line");
    app.drawImmediate();
    expect(rendered.join("\n")).toContain("final line");
  });

  it("keeps the same newline rules inside question/modal text editors", () => {
    const app = new App() as any;
    app.questionView = createQuestionView({
      title: "Question",
      submitLabel: "Submit",
      questions: [
        {
          id: "notes",
          label: "Notes",
          prompt: "Add notes",
          kind: "text",
          options: [],
          required: true,
        },
      ],
    }, () => {});

    handleQuestionViewKey(app, { name: "a", char: "a", ctrl: false, meta: false, shift: false });
    handleQuestionViewKey(app, { name: "return", char: "", ctrl: false, meta: false, shift: true });
    handleQuestionViewKey(app, { name: "b", char: "b", ctrl: false, meta: false, shift: false });
    expect(app.questionView.editor.getText()).toBe("a\nb");

    handleQuestionViewKey(app, { name: "j", char: "\n", ctrl: true, meta: false, shift: false });
    expect(app.questionView.editor.getText()).toBe("a\nb");
  });

  it("normalizes setText input so every editor path shares one newline model", () => {
    const app = new App() as any;
    app.input.setText("left\r\nright\rcenter");
    expect(app.input.getText()).toBe("left\nright\ncenter");
  });
});
