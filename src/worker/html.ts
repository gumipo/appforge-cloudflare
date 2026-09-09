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

function runtimeClient(appId: string, versionId: string, origin: string, token: string): string {
  const safeAppId = JSON.stringify(appId);
  const safeVersionId = JSON.stringify(versionId);
  const safeOrigin = JSON.stringify(origin.replace(/\/$/, ""));
  const safeToken = JSON.stringify(token);
  return `<script>(()=>{const appId=${safeAppId},versionId=${safeVersionId},runtimeOrigin=${safeOrigin},token=${safeToken};const root=runtimeOrigin+'/api/runtime/apps/'+encodeURIComponent(appId)+'/';async function call(path,init){const response=await fetch(root+path,{credentials:location.origin===runtimeOrigin?'same-origin':'omit',...init,headers:{'content-type':'application/json','x-appforge-runtime-token':token,...(init&&init.headers||{})}});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'AppForge data request failed');return payload;}window.AppForge=Object.freeze({appId,versionId,session:()=>call('session').then(v=>v.session),data:Object.freeze({list:(collection)=>call('data/'+encodeURIComponent(collection)).then(v=>v.records),create:(collection,data)=>call('data/'+encodeURIComponent(collection),{method:'POST',body:JSON.stringify({data})}).then(v=>v.record),update:(collection,id,data)=>call('data/'+encodeURIComponent(collection)+'/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({data})}).then(v=>v.record),remove:(collection,id)=>call('data/'+encodeURIComponent(collection)+'/'+encodeURIComponent(id),{method:'DELETE'})})});})();</script>`;
}

export function prepareGeneratedHtml(
  html: string,
  title: string,
  description: string,
  runtime?: { appId: string; versionId: string; origin: string; token: string },
): string {
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
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data:; connect-src 'self'${runtime ? ` ${escapeHtml(runtime.origin)}` : ""}; media-src data:;">`,
    runtime ? runtimeClient(runtime.appId, runtime.versionId, runtime.origin, runtime.token) : "",
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
