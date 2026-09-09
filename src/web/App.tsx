import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clock3,
  Cloud,
  Code2,
  ExternalLink,
  GalleryHorizontalEnd,
  LoaderCircle,
  MessageSquareText,
  Plus,
  RefreshCw,
  Send,
  Share2,
  Sparkles,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import type { AppDetail, AppStatus, AppSummary, ChatMessage } from "../shared/types";
import { createApp, fetchApp, fetchApps, reviseApp } from "./api";

const EXAMPLES = [
  "ミニマルなTODOアプリを作って",
  "小さなコーヒースタンドのLP",
  "習慣を記録するダッシュボード",
];

const STATUS_COPY: Record<AppStatus, string> = {
  queued: "順番を待っています",
  building: "UIを組み立てています",
  ready: "公開準備ができました",
  failed: "ビルドを確認してください",
};

function Logo() {
  return <div className="logo"><span className="logo-mark"><WandSparkles size={17} /></span><span>AppForge</span></div>;
}

function statusIcon(status: AppStatus) {
  if (status === "ready") return <Check size={13} />;
  if (status === "failed") return <X size={13} />;
  return <LoaderCircle className="spin" size={13} />;
}

function relativeTime(value: string): string {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.round(diff / 60_000));
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  return `${Math.round(hours / 24)}日前`;
}

function EmptyConversation() {
  return (
    <div className="empty-conversation">
      <div className="assistant-avatar"><Sparkles size={15} /></div>
      <div className="assistant-bubble">
        <span className="bubble-label">AppForge</span>
        <p>つくりたいものを教えてください。デザインから公開準備まで、ここで一緒に仕上げます。</p>
      </div>
    </div>
  );
}

function Message({ message }: { message: ChatMessage }) {
  const assistant = message.role === "assistant";
  return (
    <div className={`message-row ${assistant ? "assistant" : "user"}`}>
      {assistant && <div className="assistant-avatar small"><Sparkles size={13} /></div>}
      <div className="message-bubble">
        {assistant && <span className="bubble-label">AppForge</span>}
        <p>{message.content}</p>
      </div>
    </div>
  );
}

function AppCard({ app, onOpen }: { app: AppSummary; onOpen: () => void }) {
  return (
    <button className="app-card" onClick={onOpen}>
      <div className="card-preview">
        {app.thumbnailUrl ? <img src={app.thumbnailUrl} alt="" /> : <div className="card-placeholder"><Sparkles size={24} /><span>Building preview</span></div>}
        <span className={`card-status ${app.status}`}>{statusIcon(app.status)}{app.status}</span>
        <span className="open-overlay">開く <ArrowRight size={14} /></span>
      </div>
      <div className="card-copy">
        <div><h3>{app.title}</h3><p>{app.description}</p></div>
        <span>{relativeTime(app.updatedAt)}</span>
      </div>
    </button>
  );
}

export function App() {
  const [apps, setApps] = useState<AppSummary[]>([]);
  const [selected, setSelected] = useState<AppDetail | null>(null);
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const conversationRef = useRef<HTMLDivElement>(null);

  const loadApps = useCallback(async () => {
    const next = await fetchApps();
    setApps(next);
    return next;
  }, []);

  const openApp = useCallback(async (summary: AppSummary, updateHistory = true) => {
    setError(null);
    const detail = await fetchApp(summary.id);
    setSelected(detail);
    if (updateHistory) window.history.pushState({}, "", `/apps/${summary.slug}`);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const list = await loadApps();
        const match = window.location.pathname.match(/^\/apps\/([^/]+)/);
        if (match) {
          const fromPath = list.find((item) => item.slug === match[1]);
          if (fromPath) await openApp(fromPath, false);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "読み込みに失敗しました。");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadApps, openApp]);

  useEffect(() => {
    if (!selected || (selected.status !== "queued" && selected.status !== "building")) return;
    const timer = window.setInterval(() => {
      void fetchApp(selected.id).then((detail) => {
        setSelected(detail);
        if (detail.status === "ready" || detail.status === "failed") void loadApps();
      }).catch(() => undefined);
    }, 1_200);
    return () => window.clearInterval(timer);
  }, [selected, loadApps]);

  useEffect(() => {
    if (!selected || !conversationRef.current) return;
    conversationRef.current.scrollTo({ top: conversationRef.current.scrollHeight, behavior: "smooth" });
  }, [selected?.messages.length, selected?.status]);

  const canSubmit = prompt.trim().length >= 3 && !submitting && selected?.status !== "queued" && selected?.status !== "building";
  const buildActive = selected?.status === "queued" || selected?.status === "building";

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const value = prompt.trim();
    setPrompt("");
    setSubmitting(true);
    setError(null);
    try {
      const detail = selected ? await reviseApp(selected.id, value) : await createApp(value);
      setSelected(detail);
      window.history.pushState({}, "", `/apps/${detail.slug}`);
      await loadApps();
    } catch (cause) {
      setPrompt(value);
      setError(cause instanceof Error ? cause.message : "送信に失敗しました。");
    } finally {
      setSubmitting(false);
    }
  };

  const startNew = () => {
    setSelected(null);
    setPrompt("");
    setError(null);
    window.history.pushState({}, "", "/");
  };

  const share = async () => {
    if (!selected) return;
    await navigator.clipboard.writeText(`${window.location.origin}/apps/${selected.slug}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  };

  const recentApps = useMemo(() => apps.slice(0, 6), [apps]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand-button" onClick={startNew}><Logo /></button>
        <nav>
          <a href="#workspace">Workspace</a>
          <a href="#explore">Explore</a>
        </nav>
        <div className="top-actions">
          <span className="cloud-state"><Cloud size={14} /> Cloudflare ready</span>
          <button className="new-button" onClick={startNew}><Plus size={15} /> New app</button>
          <button className="avatar" aria-label="Account">H</button>
        </div>
      </header>

      <main>
        <section className="intro" id="workspace">
          <div>
            <div className="kicker"><span></span> AI app builder on the edge</div>
            <h1>Describe it.<br /><em>Ship it.</em></h1>
          </div>
          <p>アイデアを伝えるだけ。AppForgeがUIを組み立て、Cloudflareへデプロイし、共有できるプレビューまで用意します。</p>
        </section>

        <section className="studio">
          <div className="chat-panel">
            <div className="panel-header">
              <div><MessageSquareText size={16} /><span>Build chat</span></div>
              {selected && <button className="icon-button" onClick={startNew} title="新しい会話"><Plus size={16} /></button>}
            </div>
            <div className="conversation" ref={conversationRef}>
              {!selected ? <EmptyConversation /> : selected.messages.map((message) => <Message key={message.id} message={message} />)}
              {buildActive && (
                <div className="build-progress">
                  <span className="progress-icon"><LoaderCircle className="spin" size={15} /></span>
                  <div><b>{STATUS_COPY[selected.status]}</b><span>数秒でプレビューに反映されます</span></div>
                </div>
              )}
            </div>
            {!selected && (
              <div className="suggestions">
                <span>Try an example</span>
                <div>{EXAMPLES.map((example) => <button key={example} onClick={() => setPrompt(example)}>{example}<ArrowRight size={12} /></button>)}</div>
              </div>
            )}
            <div className="composer-wrap">
              {error && <div className="error-banner"><X size={14} />{error}</div>}
              <div className="composer">
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleSubmit();
                    }
                  }}
                  placeholder={selected ? "変更したいことを伝える…" : "どんなアプリを作りたいですか？"}
                  rows={3}
                  maxLength={2_000}
                  disabled={buildActive}
                />
                <div className="composer-footer">
                  <span><Zap size={12} /> Workers AI</span>
                  <button disabled={!canSubmit} onClick={() => void handleSubmit()} aria-label="送信">
                    {submitting ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}
                  </button>
                </div>
              </div>
              <small>Enterで送信 · Shift + Enterで改行</small>
            </div>
          </div>

          <div className="preview-panel">
            <div className="preview-toolbar">
              <div className="browser-dots"><span></span><span></span><span></span></div>
              <div className="address"><span className={selected?.status === "ready" ? "live-dot" : "idle-dot"}></span>{selected?.previewUrl ?? "Your preview will appear here"}</div>
              <button className="icon-button" onClick={() => selected && void fetchApp(selected.id).then(setSelected)} title="更新"><RefreshCw size={15} /></button>
              <button className="icon-button" onClick={() => selected?.previewUrl && window.open(selected.previewUrl, "_blank")} disabled={!selected?.previewUrl} title="別タブで開く"><ExternalLink size={15} /></button>
            </div>
            <div className="preview-stage">
              {selected?.status === "ready" && selected.previewUrl ? (
                <iframe
                  key={`${selected.id}-${selected.updatedAt}`}
                  src={selected.previewUrl}
                  title={`${selected.title} preview`}
                  sandbox="allow-scripts allow-forms allow-modals allow-popups"
                />
              ) : selected?.status === "failed" ? (
                <div className="preview-empty failed"><X size={30} /><h2>Build paused</h2><p>{selected.errorMessage ?? "チャットからもう一度試してください。"}</p></div>
              ) : (
                <div className="preview-empty">
                  {buildActive ? <div className="build-orbit"><LoaderCircle className="spin" size={28} /></div> : <div className="empty-glyph"><Code2 size={27} /></div>}
                  <h2>{buildActive ? "Bringing your idea to life" : "A blank canvas, for now"}</h2>
                  <p>{buildActive ? "デザイン、コード、公開設定を準備しています。" : "左のチャットでアイデアを伝えると、ここに動くアプリが現れます。"}</p>
                </div>
              )}
            </div>
            <div className="preview-footer">
              <span>{selected ? <><span className={`status-dot ${selected.status}`}></span>{STATUS_COPY[selected.status]}</> : <><Clock3 size={13} /> Waiting for an idea</>}</span>
              <div>
                <button onClick={() => void share()} disabled={!selected}><Share2 size={14} />{copied ? "Copied" : "Share"}</button>
                <button className="publish" onClick={() => selected?.previewUrl && window.open(selected.previewUrl, "_blank")} disabled={!selected?.previewUrl}>Open app <ExternalLink size={13} /></button>
              </div>
            </div>
          </div>
        </section>

        <section className="explore" id="explore">
          <div className="section-heading"><div><span className="section-icon"><GalleryHorizontalEnd size={16} /></span><div><h2>Recently forged</h2><p>あなたのワークスペースで生まれたアプリ</p></div></div>{apps.length > 6 && <button>View all <ArrowRight size={14} /></button>}</div>
          {loading ? <div className="loading-row"><LoaderCircle className="spin" /> Loading workspace…</div> : recentApps.length ? (
            <div className="app-grid">{recentApps.map((item) => <AppCard key={item.id} app={item} onOpen={() => void openApp(item)} />)}</div>
          ) : (
            <div className="empty-gallery"><Sparkles size={18} /><span>最初のアプリを作ると、ここに自動で並びます。</span></div>
          )}
        </section>
      </main>

      <footer className="site-footer"><Logo /><span>Built on Cloudflare’s edge.</span><button>System status <ChevronDown size={12} /></button></footer>
    </div>
  );
}
