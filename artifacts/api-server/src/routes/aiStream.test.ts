import { describe, it, expect } from "vitest";
import { wantsEventStream, sseFrame, extractJsonStringField } from "./aiStream.js";

describe("wantsEventStream", () => {
  it("detects the SSE accept header", () => {
    expect(wantsEventStream("text/event-stream")).toBe(true);
    expect(wantsEventStream("text/event-stream, */*")).toBe(true);
    expect(wantsEventStream("TEXT/EVENT-STREAM")).toBe(true);
    expect(wantsEventStream(["application/json", "text/event-stream"])).toBe(true);
  });
  it("returns false for non-SSE / missing accept", () => {
    expect(wantsEventStream(undefined)).toBe(false);
    expect(wantsEventStream("application/json")).toBe(false);
    expect(wantsEventStream("")).toBe(false);
    expect(wantsEventStream(["application/json", "*/*"])).toBe(false);
  });
});

describe("sseFrame", () => {
  it("formats a valid SSE frame ending in a blank line", () => {
    expect(sseFrame("delta", { text: "hi" })).toBe(
      'event: delta\ndata: {"text":"hi"}\n\n',
    );
  });
  it("encodes embedded newlines via JSON so the frame stays single-line", () => {
    const frame = sseFrame("delta", { text: "a\nb" });
    expect(frame).toBe('event: delta\ndata: {"text":"a\\nb"}\n\n');
    // exactly one data line, terminated by the blank line
    const dataLines = frame.split("\n").filter((l) => l.startsWith("data:"));
    expect(dataLines).toHaveLength(1);
  });
});

describe("extractJsonStringField", () => {
  it("returns the full value from a complete JSON object", () => {
    expect(extractJsonStringField('{"answer":"hello there"}', "answer")).toBe(
      "hello there",
    );
  });

  it("returns the partial value while the literal is still open", () => {
    expect(extractJsonStringField('{"answer":"hello', "answer")).toBe("hello");
    expect(extractJsonStringField('{"answer":"', "answer")).toBe("");
  });

  it("returns empty until the field/colon/opening-quote have all arrived", () => {
    expect(extractJsonStringField("{", "answer")).toBe("");
    expect(extractJsonStringField('{"ans', "answer")).toBe("");
    expect(extractJsonStringField('{"answer"', "answer")).toBe("");
    expect(extractJsonStringField('{"answer":', "answer")).toBe("");
    expect(extractJsonStringField('{"answer": ', "answer")).toBe("");
  });

  it("tolerates whitespace around the colon", () => {
    expect(extractJsonStringField('{"answer"  :  "ok"}', "answer")).toBe("ok");
  });

  it("decodes standard escapes", () => {
    expect(extractJsonStringField('{"answer":"line1\\nline2"}', "answer")).toBe(
      "line1\nline2",
    );
    expect(extractJsonStringField('{"answer":"a\\tb"}', "answer")).toBe("a\tb");
    expect(extractJsonStringField('{"answer":"quote\\"end"}', "answer")).toBe(
      'quote"end',
    );
    expect(extractJsonStringField('{"answer":"back\\\\slash"}', "answer")).toBe(
      "back\\slash",
    );
    expect(extractJsonStringField('{"answer":"slash\\/end"}', "answer")).toBe(
      "slash/end",
    );
  });

  it("decodes \\u unicode escapes", () => {
    expect(extractJsonStringField('{"answer":"\\u00e9clair"}', "answer")).toBe(
      "éclair",
    );
  });

  it("stops cleanly on an escape split across the buffer boundary", () => {
    // trailing lone backslash: don't emit it, wait for the next char
    expect(extractJsonStringField('{"answer":"hi\\', "answer")).toBe("hi");
    // partial \u escape: emit text before it, hold the incomplete escape
    expect(extractJsonStringField('{"answer":"hi\\u00e', "answer")).toBe("hi");
  });

  it("does not read past the closing quote into other fields", () => {
    expect(
      extractJsonStringField('{"answer":"done","note":"extra"}', "answer"),
    ).toBe("done");
  });

  it("returns empty when the field is absent", () => {
    expect(extractJsonStringField('{"note":"no answer here"}', "answer")).toBe(
      "",
    );
    expect(extractJsonStringField("", "answer")).toBe("");
  });

  it("extracts a different named field", () => {
    expect(
      extractJsonStringField('{"answer":"a","note":"careful"}', "note"),
    ).toBe("careful");
  });
});
