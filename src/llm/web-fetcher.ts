export type WebFetchErrorCode = "FETCH_FAILED" | "FETCH_TOO_LARGE";

export class WebFetchError extends Error {
  constructor(
    public readonly code: WebFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WebFetchError";
  }
}

const CONTENT_CHAR_LIMIT = 20_000;
const LLM_CONTENT_CHAR_LIMIT = 8_000;
const MIN_ARTICLE_TEXT_CHARS = 200;

export function extractTextFromHtml(html: string): string {
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&#x2F;/g, "/")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  return text;
}

export async function fetchUrl(url: string): Promise<{ content: string }> {
  try {
    const target = url.trim();
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      throw new WebFetchError("FETCH_FAILED", `Invalid URL: ${url}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new WebFetchError("FETCH_FAILED", `Only HTTP(S) URLs can be fetched, got ${parsed.protocol}`);
    }

    const resp = await fetch(target, {
      headers: { "User-Agent": "AutoCreateVideo/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      throw new WebFetchError("FETCH_FAILED", `HTTP ${resp.status} ${resp.statusText}`);
    }
    const html = await resp.text();
    const text = extractTextFromHtml(html);
    if (text.length < MIN_ARTICLE_TEXT_CHARS) {
      throw new WebFetchError("FETCH_FAILED", "Article text is empty or too short after extraction");
    }
    if (text.length > CONTENT_CHAR_LIMIT) {
      throw new WebFetchError("FETCH_TOO_LARGE", `Article text is too large (${text.length} chars)`);
    }
    const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1]
      ?? null;

    let result = `URL: ${target}\nContent (text extracted from HTML):\n${text.slice(0, LLM_CONTENT_CHAR_LIMIT)}`;
    if (ogImage) {
      result += `\n\nog:image URL: ${ogImage}`;
    }
    if (text.length > LLM_CONTENT_CHAR_LIMIT) {
      result += `\n\n[Content truncated at ${LLM_CONTENT_CHAR_LIMIT} chars, original was ${text.length} chars]`;
    }
    return { content: result };
  } catch (e) {
    if (e instanceof WebFetchError) throw e;
    throw new WebFetchError("FETCH_FAILED", e instanceof Error ? e.message : String(e));
  }
}
