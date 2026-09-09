import { describe, expect, it } from "vitest";
import { injectSocialMetadata, prepareGeneratedHtml } from "../src/worker/html";
import { createFallbackApp, titleFromPrompt } from "../src/worker/templates";

describe("generated app HTML", () => {
  it("adds metadata and a restrictive CSP", () => {
    const prepared = prepareGeneratedHtml("<html><head><title>Test</title></head><body>Hello</body></html>", "Demo", "Description");
    expect(prepared).toContain('property="og:title" content="Demo"');
    expect(prepared).toContain("connect-src 'none'");
    expect(prepared).toMatch(/^<!doctype html>/i);
  });

  it("escapes values injected into the shell page", () => {
    const output = injectSocialMetadata("<head><!--app-meta--></head>", {
      title: '<script>alert("x")</script>',
      description: "safe & sound",
      url: "https://example.com/apps/demo",
    });
    expect(output).not.toContain("<script>alert");
    expect(output).toContain("&lt;script&gt;");
    expect(output).toContain("safe &amp; sound");
  });
});

describe("local fallback generation", () => {
  it("creates an interactive task app for a todo prompt", () => {
    const app = createFallbackApp("ミニマルなTODOアプリを作って");
    expect(app.title).toBe("ミニマルなTODOアプリ");
    expect(app.html).toContain("Add task");
    expect(app.html).toContain("data-move");
  });

  it("derives a concise title from Japanese requests", () => {
    expect(titleFromPrompt("習慣トラッカーを作成して！追加の説明")).toBe("習慣トラッカー");
  });
});
