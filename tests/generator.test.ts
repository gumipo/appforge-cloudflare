import { describe, expect, it, vi } from "vitest";
import { generateApp } from "../src/worker/generator";
import type { Env } from "../src/worker/types";

describe("AI provider selection", () => {
  it("uses the Workers AI binding by default", async () => {
    const artifact = {
      title: "勤怠管理",
      description: "出退勤を記録します",
      summary: "勤怠管理画面を作成",
      html: "<!doctype html><html><body>勤怠管理</body></html>",
      files: [{ path: "index.html", content: "<!doctype html><html><body>勤怠管理</body></html>" }],
      dataModel: [{ name: "attendance", fields: [{ name: "clockIn", type: "datetime", required: true }] }],
    };
    const run = vi.fn().mockResolvedValue({
      response: JSON.stringify(artifact),
      usage: { prompt_tokens: 100, completion_tokens: 200 },
    });
    const recordRun = vi.fn().mockResolvedValue(undefined);
    const bind = vi.fn().mockReturnValue({ run: recordRun });
    const prepare = vi.fn().mockReturnValue({ bind });
    const env = {
      AI_PROVIDER: "workers-ai",
      WORKERS_AI_MODEL: "@cf/qwen/qwen2.5-coder-32b-instruct",
      AI: { run },
      DB: { prepare },
    } as unknown as Env;

    const generated = await generateApp(env, "勤怠管理を作って", null, {
      tenantId: "tenant-1",
      appId: "app-1",
      versionId: "version-1",
    });

    expect(generated.title).toBe("勤怠管理");
    expect(run).toHaveBeenCalledWith("@cf/qwen/qwen2.5-coder-32b-instruct", expect.objectContaining({ max_tokens: 12_000 }));
    expect(bind).toHaveBeenCalledWith(expect.any(String), "tenant-1", "app-1", "version-1", "workers-ai", "@cf/qwen/qwen2.5-coder-32b-instruct", 100, 200, expect.any(String));
    expect(recordRun).toHaveBeenCalledOnce();
  });
});
