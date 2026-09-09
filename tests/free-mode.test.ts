import { afterEach, describe, expect, it, vi } from "vitest";
import { deployVersionedHtml } from "../src/worker/deployer";
import { createThumbnail } from "../src/worker/thumbnail";
import type { Env } from "../src/worker/types";

afterEach(() => vi.restoreAllMocks());

describe("free tier mode", () => {
  it("does not upload a generated Worker even when credentials exist", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const env = {
      FREE_TIER_ONLY: "true",
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_API_TOKEN: "secret",
      CF_WORKERS_SUBDOMAIN: "example",
    } as unknown as Env;

    await expect(deployVersionedHtml(env, "generated-app", "<h1>Hello</h1>")).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses the SVG thumbnail without starting Browser Rendering", async () => {
    const quickAction = vi.fn();
    const put = vi.fn().mockResolvedValue(undefined);
    const env = {
      FREE_TIER_ONLY: "true",
      BROWSER: { quickAction },
      THUMBNAILS: { put },
    } as unknown as Env;

    const key = await createThumbnail(env, "app-1", "version-1", "https://example.com", "勤怠管理", "打刻を管理");

    expect(key).toBe("apps/app-1/versions/version-1/og.svg");
    expect(quickAction).not.toHaveBeenCalled();
    expect(put).toHaveBeenCalledOnce();
  });
});
