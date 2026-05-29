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
<<<<<<< Updated upstream
    const resp = await fetch(url, {
=======
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

    // Block internal/private network addresses (SSRF prevention)
    const BLOCKED_HOSTS = [
      "localhost", "127.0.0.1", "::1", "0.0.0.0",
      "169.254.169.254",               // AWS IMDS / link-local
      "metadata.google.internal",      // GCP metadata
    ];
    const hostname = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTS.includes(hostname) ||
        hostname.startsWith("10.") ||
        hostname.startsWith("192.168.") ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) {
      throw new WebFetchError("FETCH_FAILED", "Internal and private network addresses are not allowed");
    }

    const resp = await fetch(target, {
>>>>>>> Stashed changes
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
