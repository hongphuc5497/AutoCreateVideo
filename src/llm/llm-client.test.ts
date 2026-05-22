import { describe, expect, it } from "vitest";
import { loadSkillPrompt } from "./llm-client.js";

describe("loadSkillPrompt", () => {
  it("inlines CONTEXT.md so API-mode LLMs do not fetch local files", () => {
    const prompt = loadSkillPrompt();

    expect(prompt).toContain("# Create News Video Skill");
    expect(prompt).toContain("## Inlined Repository Context");
    expect(prompt).toContain("## Input Specifications");
    expect(prompt).toContain("Do not call web_fetch for file:// URLs");
  });
});
