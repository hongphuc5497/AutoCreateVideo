import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config.js";
import type { LlmClient } from "./llm-client.js";
import { loadSkillPrompt } from "./llm-client.js";
import { fetchUrl } from "./web-fetcher.js";

const WEB_FETCH_TOOL: Anthropic.Tool = {
  name: "web_fetch",
  description: "Fetch content from a URL. Use this to read the article content and extract the og:image URL.",
  input_schema: {
    type: "object" as const,
    properties: {
      url: { type: "string", description: "The URL to fetch" },
    },
    required: ["url"],
  },
};

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
- Steps 1-2 (detect input type, fetch content) are done via the web_fetch tool.
- Step 3 (slug + output dir) is handled by the server — skip it.
- Step 7 (run pipeline) is handled by the server — skip it.
- Step 8 (report success) is handled by the server — skip it.
- When generating script.json, follow Steps 4-6 exactly from the instructions above.
- Output ONLY valid JSON, no markdown fences, no surrounding text.`;

    onProgress("Analyzing article...");

    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: `Generate a Vietnamese news video script for this article URL: ${articleUrl}

First, use the web_fetch tool to fetch the article content. If the fetch fails, try alternative approaches to get the content. Then follow Steps 4-6 of the skill to generate script.json.

Remember: output ONLY the raw JSON object, no markdown fences.`,
      },
    ];

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
      const jsonText = text.trim();
      const jsonMatch = jsonText.match(/(?:```(?:json)?\s*)?([\s\S]*?)(?:\s*```)?$/);
      const cleanJson = jsonMatch ? jsonMatch[1].trim() : jsonText;
      try {
        return JSON.parse(cleanJson) as Record<string, unknown>;
      } catch {
        onProgress("Retrying after JSON parse error...");
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content: `The previous response was not valid JSON. Parse error. Please output ONLY the raw JSON object for script.json, with no markdown fences or surrounding text.`,
        });
        continue;
      }
    }
  }
}
