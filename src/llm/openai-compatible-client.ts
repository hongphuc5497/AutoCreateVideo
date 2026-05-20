import OpenAI from "openai";
import type { Config } from "../config.js";
import type { LlmClient } from "./llm-client.js";
import { loadSkillPrompt } from "./llm-client.js";
import { fetchUrl } from "./web-fetcher.js";

function isFunctionCall(tc: OpenAI.ChatCompletionMessageToolCall): tc is OpenAI.ChatCompletionMessageFunctionToolCall {
  return (tc as OpenAI.ChatCompletionMessageFunctionToolCall).function !== undefined;
}

const WEB_FETCH_TOOL: OpenAI.ChatCompletionTool = {
  type: "function",
  function: {
    name: "web_fetch",
    description: "Fetch content from a URL. Use this to read the article content and extract the og:image URL.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch" },
      },
      required: ["url"],
    },
  },
};

export class OpenAICompatibleClient implements LlmClient {
  private client: OpenAI;

  constructor(private cfg: Config) {
    this.client = new OpenAI({
      apiKey: cfg.llmApiKey!,
      baseURL: cfg.llmProvider === "deepseek"
        ? (cfg.llmEndpoint ?? "https://api.deepseek.com/v1")
        : (cfg.llmEndpoint || undefined),
      timeout: 120_000,
      maxRetries: 1,
    });
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
- You do NOT have Write, Bash, or WebFetch tools. You only have the web_fetch function defined below.
- Instead of writing script.json to disk, respond with ONLY the JSON object (the script.json content).
- Steps 1-2 (detect input type, fetch content) are done via the web_fetch function.
- Step 3 (slug + output dir) is handled by the server — skip it.
- Step 7 (run pipeline) is handled by the server — skip it.
- Step 8 (report success) is handled by the server — skip it.
- When generating script.json, follow Steps 4-6 exactly from the instructions above.
- Output ONLY valid JSON, no markdown fences, no surrounding text.`;

    onProgress("Analyzing article...");

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: "user",
        content: `Generate a Vietnamese news video script for this article URL: ${articleUrl}

First, use the web_fetch function to fetch the article content. If the fetch fails, try alternative approaches to get the content. Then follow Steps 4-6 of the skill to generate script.json.

Remember: output ONLY the raw JSON object, no markdown fences.`,
      },
    ];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const response = await this.client.chat.completions.create({
        model: this.cfg.llmModel,
        max_tokens: 8192,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        tools: [WEB_FETCH_TOOL],
      });

      const choice = response.choices[0];
      if (!choice) {
        throw new Error("No response from LLM");
      }

      // Persist reasoning_content for DeepSeek thinking models
      const rawMsg = choice.message as unknown as Record<string, unknown>;
      const reasoning = rawMsg.reasoning_content as string | undefined;

      if (choice.message.tool_calls?.length) {
        const assistantMsg: Record<string, unknown> = {
          role: "assistant",
          content: choice.message.content,
          tool_calls: choice.message.tool_calls,
        };
        if (reasoning) assistantMsg.reasoning_content = reasoning;
        messages.push(assistantMsg as unknown as OpenAI.ChatCompletionAssistantMessageParam);

        for (const toolCall of choice.message.tool_calls) {
          if (!isFunctionCall(toolCall)) continue;
          if (toolCall.function.name === "web_fetch") {
            const { url } = JSON.parse(toolCall.function.arguments);
            onProgress(`Fetching ${url}...`);
            const result = await fetchUrl(url);
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: result.content,
            });
          } else {
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: `Unknown function: ${toolCall.function.name}`,
            });
          }
        }
        continue;
      }

      const text = choice.message.content ?? "";
      onProgress("Parsing script.json...");
      const jsonText = text.trim();
      const jsonMatch = jsonText.match(/(?:```(?:json)?\s*)?([\s\S]*?)(?:\s*```)?$/);
      const cleanJson = jsonMatch ? jsonMatch[1].trim() : jsonText;
      try {
        return JSON.parse(cleanJson) as Record<string, unknown>;
      } catch {
        onProgress("Retrying after JSON parse error...");
        const retryMsg: Record<string, unknown> = { role: "assistant", content: text };
        if (reasoning) retryMsg.reasoning_content = reasoning;
        messages.push(retryMsg as unknown as OpenAI.ChatCompletionAssistantMessageParam);
        messages.push({
          role: "user",
          content: `The previous response was not valid JSON. Parse error. Please output ONLY the raw JSON object for script.json, with no markdown fences or surrounding text.`,
        });
        continue;
      }
    }
  }
}
