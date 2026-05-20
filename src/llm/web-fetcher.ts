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
    const resp = await fetch(url, {
      headers: { "User-Agent": "AutoCreateVideo/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      return { content: `Failed to fetch: HTTP ${resp.status} ${resp.statusText}` };
    }
    const html = await resp.text();
    const text = extractTextFromHtml(html);
    const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1]
      ?? null;

    let result = `URL: ${url}\nContent (text extracted from HTML):\n${text.slice(0, 8000)}`;
    if (ogImage) {
      result += `\n\nog:image URL: ${ogImage}`;
    }
    if (text.length > 8000) {
      result += `\n\n[Content truncated at 8000 chars, original was ${text.length} chars]`;
    }
    return { content: result };
  } catch (e) {
    return { content: `Fetch error: ${e instanceof Error ? e.message : String(e)}` };
  }
}
