import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "../config.js";
import { AnthropicClient } from "./anthropic-client.js";
import { OpenAICompatibleClient } from "./openai-compatible-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = join(__dirname, "..", "..", ".claude", "skills", "create-news-video", "SKILL.md");
const CONTEXT_PATH = join(__dirname, "..", "..", "CONTEXT.md");

let _skillPrompt: string | null = null;

export function loadSkillPrompt(): string {
  if (_skillPrompt) return _skillPrompt;
  if (!existsSync(SKILL_PATH)) {
    throw new Error(`SKILL.md not found at ${SKILL_PATH}`);
  }
  if (!existsSync(CONTEXT_PATH)) {
    throw new Error(`CONTEXT.md not found at ${CONTEXT_PATH}`);
  }

  const skillMd = readFileSync(SKILL_PATH, "utf8");
  const contextMd = readFileSync(CONTEXT_PATH, "utf8");
  _skillPrompt = `${skillMd}

---
## Inlined Repository Context

The skill's linked CONTEXT.md source of truth is already included below. Do not call web_fetch for file:// URLs or local project files; use web_fetch only for the remote HTTP(S) article URL.

${contextMd}`;
  return _skillPrompt;
}

export interface LlmClient {
  generateScript(articleUrl: string, onProgress: (msg: string) => void): Promise<Record<string, unknown>>;
}

export function createLlmClient(cfg: Config): LlmClient {
  if (!cfg.llmApiKey) {
    throw new Error("Missing LLM_API_KEY");
  }

  switch (cfg.llmProvider) {
    case "anthropic":
      return new AnthropicClient(cfg);
    case "openai":
    case "deepseek":
      return new OpenAICompatibleClient(cfg);
    default: {
      const _never: never = cfg.llmProvider;
      throw new Error(`Unknown LLM provider: ${_never}`);
    }
  }
}
