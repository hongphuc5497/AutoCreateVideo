import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseGeneratedScriptJson } from "./generated-script.js";

const load = (name: string) =>
  readFileSync(`tests/fixtures/${name}`, "utf8");

describe("parseGeneratedScriptJson", () => {
  it("accepts valid raw JSON", () => {
    expect(parseGeneratedScriptJson(load("sample-script-with-image.json")))
      .toMatchObject({ version: "1.0" });
  });

  it("accepts fenced JSON", () => {
    expect(parseGeneratedScriptJson(`\`\`\`json\n${load("sample-script-no-image.json")}\n\`\`\``))
      .toMatchObject({ version: "1.0" });
  });

  it("rejects JSON that does not match script schema", () => {
    expect(() => parseGeneratedScriptJson(JSON.stringify({ version: "1.0" })))
      .toThrow(/metadata/);
  });
});
