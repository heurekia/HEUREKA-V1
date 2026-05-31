import { describe, it, expect } from "vitest";
import { parseLooseArray } from "./jsonExtract.js";

describe("parseLooseArray", () => {
  it("parses a clean JSON array", () => {
    expect(parseLooseArray('[{"a":1},{"b":2}]')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("strips markdown code fences", () => {
    const raw = "```json\n[{\"a\":1}]\n```";
    expect(parseLooseArray(raw)).toEqual([{ a: 1 }]);
  });

  it("strips fences without language tag", () => {
    expect(parseLooseArray("```\n[1,2,3]\n```")).toEqual([1, 2, 3]);
  });

  it("ignores preamble text before the array", () => {
    expect(parseLooseArray('Voici le résultat :\n\n[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it("ignores trailing content after the array", () => {
    expect(parseLooseArray('[{"a":1}] merci !')).toEqual([{ a: 1 }]);
  });

  it("unwraps { rules: [...] } when LLM ignored the bare-array instruction", () => {
    expect(parseLooseArray('{"rules":[{"a":1},{"a":2}]}')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("unwraps any first array value in the wrapping object", () => {
    expect(parseLooseArray('{"meta":{"n":1},"data":[{"x":true}]}')).toEqual([{ x: true }]);
  });

  it("ignores '[' or '}' inside string values", () => {
    const raw = '[{"text":"hello { world ] foo"},{"text":"another"}]';
    expect(parseLooseArray(raw)).toEqual([{ text: "hello { world ] foo" }, { text: "another" }]);
  });

  it("handles escaped quotes inside string values", () => {
    const raw = '[{"text":"she said \\"hi\\""}]';
    expect(parseLooseArray(raw)).toEqual([{ text: 'she said "hi"' }]);
  });

  it("salvages a truncated response by keeping complete objects", () => {
    // Simulates Claude hitting max_tokens mid-string in object #3
    const raw = '[{"a":1,"b":"ok"},{"a":2,"b":"ok"},{"a":3,"b":"truncated st';
    expect(parseLooseArray(raw)).toEqual([{ a: 1, b: "ok" }, { a: 2, b: "ok" }]);
  });

  it("salvages truncation that ends mid-key", () => {
    const raw = '[{"a":1},{"a":2},{"a":';
    expect(parseLooseArray(raw)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("does NOT mistake '}' inside a string for an object close during salvage", () => {
    // The truncated response contains a '}' inside an unterminated string.
    // The naive salvage would slice here and produce invalid JSON.
    const raw = '[{"a":1},{"text":"oops } in the string';
    expect(parseLooseArray(raw)).toEqual([{ a: 1 }]);
  });

  it("returns [] on completely unparseable input", () => {
    expect(parseLooseArray("not a json at all")).toEqual([]);
    expect(parseLooseArray("")).toEqual([]);
    expect(parseLooseArray("{ broken")).toEqual([]);
  });

  it("returns the array even when it contains nested arrays", () => {
    const raw = '[{"cases":[{"v":1},{"v":2}]},{"cases":[]}]';
    expect(parseLooseArray(raw)).toEqual([{ cases: [{ v: 1 }, { v: 2 }] }, { cases: [] }]);
  });

  it("handles markdown fences AND truncation together", () => {
    const raw = "```json\n[{\"a\":1},{\"a\":2},{\"a\":\"trunc";
    expect(parseLooseArray(raw)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("returns [] when array is opened but contains no complete object", () => {
    expect(parseLooseArray('[{"a":')).toEqual([]);
  });
});
