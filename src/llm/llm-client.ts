import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "../config.js";
import { AnthropicClient } from "./anthropic-client.js";
import { OpenAICompatibleClient } from "./openai-compatible-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = join(__dirname, "..", "..", ".claude", "skills", "create-news-video", "SKILL.md");

let _skillMd: string | null = null;

export function loadSkillPrompt(): string {
  if (_skillMd) return _skillMd;
  if (!existsSync(SKILL_PATH)) {
    throw new Error(`SKILL.md not found at ${SKILL_PATH}`);
  }
  _skillMd = readFileSync(SKILL_PATH, "utf8");
  return _skillMd;
}

export interface LlmClient {
  generateScript(articleUrl: string, onProgress: (msg: string) => void): Promise<Record<string, unknown>>;
}

export function createLlmClient(cfg: Config): LlmClient {
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
