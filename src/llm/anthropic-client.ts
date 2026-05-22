import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config.js";
import type { LlmClient } from "./llm-client.js";
import { loadSkillPrompt } from "./llm-client.js";
import { fetchUrl } from "./web-fetcher.js";
import { formatGeneratedScriptError, parseGeneratedScriptJson } from "./generated-script.js";

const WEB_FETCH_TOOL: Anthropic.Tool = {
  name: "web_fetch",
  description: "Fetch content from an HTTP(S) article URL. Use this to read the article content and extract the og:image URL. Do not use it for file:// URLs or local project files.",
  input_schema: {
    type: "object" as const,
    properties: {
      url: { type: "string", description: "The URL to fetch" },
    },
    required: ["url"],
  },
};
const MAX_SCRIPT_CORRECTION_ATTEMPTS = 2;

export class AnthropicClient implements LlmClient {
  private client: Anthropic;

  constructor(private cfg: Config) {
    this.client = new Anthropic({ apiKey: cfg.llmApiKey!, timeout: 120_000 });
  }

  async generateScript(
    articleUrl: string,
    onProgress: (msg: string) => void,
  ): Promise<Record<string, unknown>> {
    const skillPrompt = loadSkillPrompt();
    const systemPrompt = `${skillPrompt}

---
## API CONTEXT

You are an API endpoint, not a Claude Code session. You are called by a server to generate script.json from an article URL.

Important differences from the instructions above:
- You do NOT have Write, Bash, or WebFetch tools. You only have the web_fetch tool defined below.
- Instead of writing script.json to disk, respond with ONLY the JSON object (the script.json content).
- Steps 1-2 (detect input type, fetch remote article content) are done via the web_fetch tool.
- Step 3 (slug + output dir) is handled by the server — skip it.
- Step 7 (run pipeline) is handled by the server — skip it.
- Step 8 (report success) is handled by the server — skip it.
- The linked CONTEXT.md is already in this system prompt. Do not fetch local files.
- When generating script.json, follow Steps 4-6 exactly from the instructions above.
- Output ONLY valid JSON, no markdown fences, no surrounding text.`;

    onProgress("Analyzing article...");

    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: `Generate a Vietnamese news video script for this article URL: ${articleUrl}

First, use the web_fetch tool only for the HTTP(S) article URL. Do not fetch file:// URLs or project-local docs. If the article fetch fails, report the fetch failure. Then follow Steps 4-6 of the skill to generate script.json.

Remember: output ONLY the raw JSON object, no markdown fences.`,
      },
    ];
    let correctionAttempts = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const response = await this.client.messages.create({
        model: this.cfg.llmModel,
        max_tokens: 8192,
        system: systemPrompt,
        messages,
        tools: [WEB_FETCH_TOOL],
      });

      const toolCalls: Anthropic.ToolUseBlock[] = [];
      let text = "";

      for (const block of response.content) {
        if (block.type === "tool_use") {
          toolCalls.push(block);
        } else if (block.type === "text") {
          text += block.text;
        }
      }

      if (toolCalls.length > 0) {
        messages.push({ role: "assistant", content: response.content });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const toolCall of toolCalls) {
          if (toolCall.name === "web_fetch") {
            const url = (toolCall.input as { url: string }).url;
            onProgress(`Fetching ${url}...`);
            const result = await fetchUrl(url);
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolCall.id,
              content: result.content,
            });
          } else {
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolCall.id,
              content: `Unknown tool: ${toolCall.name}`,
            });
          }
        }
        messages.push({ role: "user", content: toolResults });
        continue;
      }

      onProgress("Parsing script.json...");
      try {
        return parseGeneratedScriptJson(text);
      } catch (e) {
        if (correctionAttempts >= MAX_SCRIPT_CORRECTION_ATTEMPTS) {
          throw e;
        }
        correctionAttempts += 1;
        onProgress("Retrying after script validation error...");
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content: `The previous response was not valid script.json.

Validation error:
${formatGeneratedScriptError(e)}

Return a corrected script.json object only. Preserve the article meaning, but strictly satisfy every schema length, enum, first-scene hook, last-scene outro, and required-field rule. Output ONLY the raw JSON object, with no markdown fences or surrounding text.`,
        });
        continue;
      }
    }
  }
}
