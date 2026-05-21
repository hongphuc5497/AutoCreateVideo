import { afterEach, describe, expect, it, vi } from "vitest";
import { WebFetchError, extractTextFromHtml, fetchUrl } from "./web-fetcher.js";

function htmlWithText(text: string): string {
  return `
    <html>
      <head><meta property="og:image" content="https://example.com/cover.jpg"></head>
      <body><article>${text}</article></body>
    </html>
  `;
}

describe("fetchUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts article text and og:image", async () => {
    const article = "Đây là nội dung bài viết công nghệ. ".repeat(20);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(htmlWithText(article), { status: 200 })));

    const result = await fetchUrl("https://example.com/article");

    expect(result.content).toContain("URL: https://example.com/article");
    expect(result.content).toContain("Đây là nội dung bài viết công nghệ.");
    expect(result.content).toContain("og:image URL: https://example.com/cover.jpg");
  });

  it("throws FETCH_FAILED for HTTP failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404, statusText: "Not Found" })));

    await expect(fetchUrl("https://example.com/missing"))
      .rejects.toMatchObject({ code: "FETCH_FAILED" });
  });

  it("throws FETCH_FAILED for empty extraction", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html><body>tiny</body></html>", { status: 200 })));

    await expect(fetchUrl("https://example.com/tiny"))
      .rejects.toMatchObject({ code: "FETCH_FAILED" });
  });

  it("throws FETCH_TOO_LARGE before sending oversized text to the LLM", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(htmlWithText("a".repeat(20_001)), { status: 200 })));

    await expect(fetchUrl("https://example.com/huge"))
      .rejects.toBeInstanceOf(WebFetchError);
    await expect(fetchUrl("https://example.com/huge"))
      .rejects.toMatchObject({ code: "FETCH_TOO_LARGE" });
  });
});

describe("extractTextFromHtml", () => {
  it("removes non-content tags and decodes common entities", () => {
    expect(extractTextFromHtml("<style>x</style><script>y</script><p>A&amp;B &ldquo;test&rdquo;</p>"))
      .toBe('A&B "test"');
  });
});
