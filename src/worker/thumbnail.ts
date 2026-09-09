import { escapeHtml } from "./html";
import type { Env } from "./types";

function fallbackThumbnail(title: string, description: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f7f7ee"/><stop offset="1" stop-color="#e5efe5"/></linearGradient></defs><rect width="1200" height="630" fill="url(#g)"/><circle cx="1020" cy="90" r="230" fill="#ff7043" opacity=".94"/><circle cx="1060" cy="120" r="126" fill="#ffcf72" opacity=".9"/><rect x="70" y="65" width="68" height="68" rx="19" fill="#194d3a"/><path d="M91 100l13 13 24-28" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><text x="70" y="220" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="#ff6b3d" letter-spacing="3">BUILT WITH APPFORGE</text><text x="70" y="330" font-family="Arial,sans-serif" font-size="72" font-weight="800" fill="#17211b">${escapeHtml(title.slice(0, 28))}</text><text x="70" y="405" font-family="Arial,sans-serif" font-size="28" fill="#667068">${escapeHtml(description.slice(0, 60))}</text><rect x="70" y="500" width="220" height="58" rx="29" fill="#194d3a"/><text x="180" y="538" text-anchor="middle" font-family="Arial,sans-serif" font-size="20" font-weight="700" fill="#fff">Live preview →</text></svg>`;
}

export async function createThumbnail(
  env: Env,
  appId: string,
  versionId: string,
  targetUrl: string,
  title: string,
  description: string,
): Promise<string | null> {
  if (!env.THUMBNAILS) return null;
  const key = `apps/${appId}/versions/${versionId}/og.png`;

  if (env.BROWSER && targetUrl.startsWith("https://")) {
    try {
      const response = await env.BROWSER.quickAction("screenshot", {
        url: targetUrl,
        viewport: { width: 1200, height: 630 },
        screenshotOptions: { type: "png", fullPage: false },
        gotoOptions: { waitUntil: "networkidle0", timeout: 30_000 },
      });
      if (response.ok) {
        await env.THUMBNAILS.put(key, await response.arrayBuffer(), {
          httpMetadata: { contentType: "image/png", cacheControl: "public, max-age=31536000, immutable" },
        });
        return key;
      }
    } catch (error) {
      console.warn("Browser screenshot failed; saving a generated placeholder.", error);
    }
  }

  const svgKey = `apps/${appId}/versions/${versionId}/og.svg`;
  await env.THUMBNAILS.put(svgKey, fallbackThumbnail(title, description), {
    httpMetadata: { contentType: "image/svg+xml", cacheControl: "public, max-age=3600" },
  });
  return svgKey;
}
