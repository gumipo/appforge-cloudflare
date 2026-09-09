const MAX_HTML_BYTES = 500_000;

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function stripCodeFence(value: string): string {
  return value.trim().replace(/^```(?:html|json)?\s*/i, "").replace(/\s*```$/, "");
}

export function prepareGeneratedHtml(html: string, title: string, description: string): string {
  let output = stripCodeFence(html);
  if (!/^<!doctype html>/i.test(output)) output = `<!doctype html>\n${output}`;

  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const metadata = [
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<meta name="description" content="${safeDescription}">`,
    `<meta property="og:title" content="${safeTitle}">`,
    `<meta property="og:description" content="${safeDescription}">`,
    `<meta property="og:type" content="website">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data:; connect-src 'none'; media-src data:;">`,
  ].join("\n");

  if (/<head[^>]*>/i.test(output)) {
    output = output.replace(/<head([^>]*)>/i, `<head$1>\n${metadata}`);
  } else {
    output = output.replace(/<html([^>]*)>/i, `<html$1><head><title>${safeTitle}</title>${metadata}</head>`);
  }

  if (new TextEncoder().encode(output).byteLength > MAX_HTML_BYTES) {
    throw new Error("Generated app exceeded the 500 KB safety limit.");
  }
  return output;
}

export function injectSocialMetadata(
  document: string,
  metadata: { title: string; description: string; url: string; imageUrl?: string },
): string {
  const tags = [
    `<title>${escapeHtml(metadata.title)} · AppForge</title>`,
    `<meta name="description" content="${escapeHtml(metadata.description)}">`,
    `<meta property="og:title" content="${escapeHtml(metadata.title)}">`,
    `<meta property="og:description" content="${escapeHtml(metadata.description)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${escapeHtml(metadata.url)}">`,
    metadata.imageUrl ? `<meta property="og:image" content="${escapeHtml(metadata.imageUrl)}">` : "",
    `<meta name="twitter:card" content="summary_large_image">`,
  ].join("\n");
  return document.replace("<!--app-meta-->", tags);
}

