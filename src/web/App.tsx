import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  Clock3,
  Cloud,
  Code2,
  Database,
  Eye,
  ExternalLink,
  GalleryHorizontalEnd,
  LoaderCircle,
  MessageSquareText,
  Plus,
  RefreshCw,
  Send,
  Share2,
  Sparkles,
  UserPlus,
  Users,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import type { AppDetail, AppStatus, AppSummary, AppVersionSummary, ChatMessage, DataCollection, HealthInfo, SessionInfo, WorkspaceInvite, WorkspaceMember } from "../shared/types";
import { createApp, createWorkspace, fetchApp, fetchApps, fetchHealth, fetchSession, fetchWorkspacePeople, inviteWorkspaceMember, publishAppVersion, reviseApp, selectTenant } from "./api";

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
        <span className={`card-status ${app.status}`}>{statusIcon(app.status)}v{app.latestVersionNumber ?? 1} · {app.status}</span>
        <span className="open-overlay">開く <ArrowRight size={14} /></span>
      </div>
      <div className="card-copy">
        <div><h3>{app.title}</h3><p>{app.description}</p></div>
        <span>{relativeTime(app.updatedAt)}</span>
      </div>
    </button>
  );
}

function DataModelView({ collections, versionNumber }: { collections: DataCollection[]; versionNumber: number }) {
  if (!collections.length) {
    return <div className="data-model-empty"><Database size={30} /><h2>Data model is empty</h2><p>データを保存する機能をチャットで追加すると、コレクションと参照関係がここに表示されます。</p></div>;
  }

  const columns = Math.min(3, collections.length === 1 ? 1 : 2);
  const cardWidth = 250;
  const gapX = 110;
  const gapY = 44;
  const margin = 34;
  const heights = collections.map((collection) => 72 + (collection.fields.length + 1) * 24);
  const rowCount = Math.ceil(collections.length / columns);
  const rowHeights = Array.from({ length: rowCount }, (_, row) => Math.max(...heights.slice(row * columns, (row + 1) * columns)));
  const positions = collections.map((_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const y = margin + rowHeights.slice(0, row).reduce((sum, value) => sum + value + gapY, 0);
    return { x: margin + column * (cardWidth + gapX), y, height: heights[index] };
  });
  const width = margin * 2 + columns * cardWidth + (columns - 1) * gapX;
  const height = margin * 2 + rowHeights.reduce((sum, value) => sum + value, 0) + Math.max(0, rowCount - 1) * gapY;
  const markerId = `relation-arrow-${versionNumber}`;

  const relations = collections.flatMap((collection, collectionIndex) => collection.fields.flatMap((field, fieldIndex) => {
    if (!field.references) return [];
    const targetIndex = collections.findIndex((candidate) => candidate.name === field.references?.collection);
    if (targetIndex < 0) return [];
    return [{ collection, collectionIndex, field, fieldIndex, targetIndex }];
  }));

  return (
    <div className="data-model-view">
      <div className="data-model-heading"><div><Database size={15} /><span>Data model · v{versionNumber}</span></div><small>{collections.length} collections · {relations.length} relations</small></div>
      <div className="data-model-canvas">
        <svg className="data-model-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Version ${versionNumber} data model with ${collections.length} collections and ${relations.length} relations`}>
          <defs><marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" /></marker></defs>
          {relations.map(({ collectionIndex, field, fieldIndex, targetIndex }) => {
            const from = positions[collectionIndex];
            const to = positions[targetIndex];
            const leftToRight = from.x <= to.x;
            const startX = leftToRight ? from.x + cardWidth : from.x;
            const endX = leftToRight ? to.x : to.x + cardWidth;
            const startY = from.y + 72 + (fieldIndex + 1) * 24 - 10;
            const endY = to.y + 72 + 12;
            const bend = Math.max(48, Math.abs(endX - startX) * .45);
            const direction = leftToRight ? 1 : -1;
            const d = `M ${startX} ${startY} C ${startX + bend * direction} ${startY}, ${endX - bend * direction} ${endY}, ${endX} ${endY}`;
            return <g key={`${collectionIndex}-${field.name}-${targetIndex}`}><path className="relation-line" d={d} markerEnd={`url(#${markerId})`} /><text className="relation-label" x={(startX + endX) / 2} y={(startY + endY) / 2 - 6} textAnchor="middle">{field.name}</text></g>;
          })}
          {collections.map((collection, index) => {
            const position = positions[index];
            return (
              <g className="model-node" key={collection.name} transform={`translate(${position.x} ${position.y})`}>
                <rect className="node-surface" width={cardWidth} height={position.height} rx="14" />
                <path className="node-header" d={`M0 14 Q0 0 14 0 H${cardWidth - 14} Q${cardWidth} 0 ${cardWidth} 14 V44 H0 Z`} />
                <text className="node-title" x="15" y="28">{collection.name}</text>
                <text className="node-kind" x={cardWidth - 15} y="28" textAnchor="end">COLLECTION</text>
                <line className="node-divider" x1="0" x2={cardWidth} y1="44" y2="44" />
                <text className="field-key" x="15" y="69">PK</text><text className="field-name" x="47" y="69">id</text><text className="field-type" x={cardWidth - 15} y="69" textAnchor="end">text</text>
                {collection.fields.map((field, fieldIndex) => {
                  const y = 69 + (fieldIndex + 1) * 24;
                  return <g key={field.name}><text className={field.references ? "field-key relation" : "field-key"} x="15" y={y}>{field.references ? "FK" : field.required ? "●" : "○"}</text><text className="field-name" x="47" y={y}>{field.name}</text><text className="field-type" x={cardWidth - 15} y={y} textAnchor="end">{field.references ? `→ ${field.references.collection}` : field.type}</text></g>;
                })}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="model-legend"><span><b>PK</b> primary key</span><span><b>FK</b> reference</span><span><b>●</b> required</span><span><b>○</b> optional</span></div>
    </div>
  );
}

export function App() {
  const [apps, setApps] = useState<AppSummary[]>([]);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [selected, setSelected] = useState<AppDetail | null>(null);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"preview" | "data">("preview");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceInvite["role"]>("editor");
  const [workspaceName, setWorkspaceName] = useState("");
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
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
    setActiveVersionId(detail.latestVersionId);
    setPreviewMode("preview");
    if (updateHistory) window.history.pushState({}, "", `/apps/${summary.slug}`);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [nextSession, nextHealth] = await Promise.all([fetchSession(), fetchHealth()]);
        setSession(nextSession);
        setHealth(nextHealth);
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
        if (detail.latestVersionId && detail.status === "ready") setActiveVersionId(detail.latestVersionId);
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
      setActiveVersionId(detail.latestVersionId);
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
    setActiveVersionId(null);
    setPreviewMode("preview");
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
  const activeVersion = useMemo<AppVersionSummary | null>(() => {
    if (!selected) return null;
    return selected.versions.find((version) => version.id === activeVersionId) ?? selected.versions[0] ?? null;
  }, [selected, activeVersionId]);

  const handlePublish = async () => {
    if (!selected || !activeVersion || activeVersion.status === "building" || activeVersion.status === "queued") return;
    setSubmitting(true);
    setError(null);
    try {
      const detail = await publishAppVersion(selected.id, activeVersion.id);
      setSelected(detail);
      await loadApps();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "公開に失敗しました。");
    } finally {
      setSubmitting(false);
    }
  };

  const switchTenant = async (id: string) => {
    selectTenant(id);
    setSelected(null);
    setActiveVersionId(null);
    setSession(await fetchSession());
    await loadApps();
    window.history.pushState({}, "", "/");
  };

  const openSettings = async () => {
    setSettingsOpen(true);
    setSettingsMessage(null);
    if (!session || (session.tenant.role !== "owner" && session.tenant.role !== "admin")) return;
    try {
      const people = await fetchWorkspacePeople();
      setMembers(people.members);
      setInvites(people.invites);
    } catch (cause) {
      setSettingsMessage(cause instanceof Error ? cause.message : "メンバーを読み込めませんでした。");
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setSettingsBusy(true);
    setSettingsMessage(null);
    try {
      await inviteWorkspaceMember(inviteEmail.trim(), inviteRole);
      const people = await fetchWorkspacePeople();
      setMembers(people.members);
      setInvites(people.invites);
      setInviteEmail("");
      setSettingsMessage("招待を登録しました。相手がCloudflare Accessでログインすると参加できます。");
    } catch (cause) {
      setSettingsMessage(cause instanceof Error ? cause.message : "招待に失敗しました。");
    } finally {
      setSettingsBusy(false);
    }
  };

  const handleCreateWorkspace = async () => {
    if (workspaceName.trim().length < 2) return;
    setSettingsBusy(true);
    setSettingsMessage(null);
    try {
      const tenant = await createWorkspace(workspaceName.trim());
      setWorkspaceName("");
      await switchTenant(tenant.id);
      setSettingsOpen(false);
    } catch (cause) {
      setSettingsMessage(cause instanceof Error ? cause.message : "ワークスペースを作成できませんでした。");
    } finally {
      setSettingsBusy(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand-button" onClick={startNew}><Logo /></button>
        <nav>
          <a href="#workspace">Workspace</a>
          <a href="#explore">Explore</a>
        </nav>
        <div className="top-actions">
          {session && session.tenants.length > 1 ? (
            <select className="workspace-select" value={session.tenant.id} onChange={(event) => void switchTenant(event.target.value)} aria-label="Workspace">
              {session.tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
            </select>
          ) : <span className="cloud-state"><Cloud size={14} /> {session?.tenant.name ?? "Cloudflare ready"}</span>}
          <button className="new-button" onClick={startNew}><Plus size={15} /> New app</button>
          <button className="avatar" aria-label="Account and workspace settings" title={session?.user.email} onClick={() => void openSettings()}>{session?.user.name.slice(0, 1).toUpperCase() ?? "H"}</button>
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
                  <span><Zap size={12} />{health?.aiProvider === "anthropic" ? "Claude · Anthropic" : health?.aiProvider === "fallback" ? "Local fallback" : "Workers AI · Qwen"}</span>
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
              {selected && activeVersion && (
                <select className="version-select" value={activeVersion.id} onChange={(event) => setActiveVersionId(event.target.value)} aria-label="Version">
                  {selected.versions.map((version) => <option key={version.id} value={version.id}>v{version.versionNumber}{version.id === selected.publishedVersionId ? " · Published" : ` · ${version.status}`}</option>)}
                </select>
              )}
              {selected && activeVersion && <div className="view-switch" aria-label="Preview mode"><button className={previewMode === "preview" ? "active" : ""} onClick={() => setPreviewMode("preview")}><Eye size={12} />Preview</button><button className={previewMode === "data" ? "active" : ""} onClick={() => setPreviewMode("data")}><Database size={12} />Data</button></div>}
              <div className="address"><span className={activeVersion?.previewUrl ? "live-dot" : "idle-dot"}></span>{previewMode === "data" && activeVersion ? `${activeVersion.dataModel.length} collections in v${activeVersion.versionNumber}` : activeVersion?.previewUrl ?? "Your preview will appear here"}</div>
              <button className="icon-button" onClick={() => selected && void fetchApp(selected.id).then(setSelected)} title="更新"><RefreshCw size={15} /></button>
              <button className="icon-button" onClick={() => activeVersion?.previewUrl && window.open(activeVersion.previewUrl, "_blank")} disabled={!activeVersion?.previewUrl} title="別タブで開く"><ExternalLink size={15} /></button>
            </div>
            <div className="preview-stage">
              {previewMode === "data" && activeVersion ? <DataModelView collections={activeVersion.dataModel} versionNumber={activeVersion.versionNumber} /> : activeVersion?.previewUrl && (activeVersion.status === "ready" || activeVersion.status === "published") ? (
                <iframe
                  key={`${activeVersion.id}-${activeVersion.updatedAt}`}
                  src={activeVersion.previewUrl}
                  title={`${selected?.title ?? "App"} preview`}
                  sandbox="allow-scripts allow-forms allow-modals allow-popups"
                />
              ) : activeVersion?.status === "failed" ? (
                <div className="preview-empty failed"><X size={30} /><h2>Build paused</h2><p>{activeVersion.errorMessage ?? "チャットからもう一度試してください。"}</p></div>
              ) : (
                <div className="preview-empty">
                  {buildActive ? <div className="build-orbit"><LoaderCircle className="spin" size={28} /></div> : <div className="empty-glyph"><Code2 size={27} /></div>}
                  <h2>{buildActive ? "Bringing your idea to life" : "A blank canvas, for now"}</h2>
                  <p>{buildActive ? "デザイン、コード、公開設定を準備しています。" : "左のチャットでアイデアを伝えると、ここに動くアプリが現れます。"}</p>
                </div>
              )}
            </div>
            <div className="preview-footer">
              <span>{activeVersion ? <><span className={`status-dot ${activeVersion.status}`}></span>v{activeVersion.versionNumber} · {activeVersion.status}</> : <><Clock3 size={13} /> Waiting for an idea</>}</span>
              <div>
                <button onClick={() => void share()} disabled={!selected}><Share2 size={14} />{copied ? "Copied" : "Share"}</button>
                {selected && activeVersion && activeVersion.id !== selected.publishedVersionId && (
                  <button className="publish" onClick={() => void handlePublish()} disabled={submitting || activeVersion.status !== "ready"}>
                    {selected.publishedVersionId && activeVersion.versionNumber < (selected.latestVersionNumber ?? 0) ? `Rollback to v${activeVersion.versionNumber}` : `Publish v${activeVersion.versionNumber}`} <Cloud size={13} />
                  </button>
                )}
                <button onClick={() => activeVersion?.previewUrl && window.open(activeVersion.previewUrl, "_blank")} disabled={!activeVersion?.previewUrl}>Open <ExternalLink size={13} /></button>
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

      {settingsOpen && session && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSettingsOpen(false)}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-settings-title">
            <div className="settings-header">
              <div><span className="settings-icon"><Building2 size={18} /></span><div><h2 id="workspace-settings-title">Workspace settings</h2><p>{session.tenant.name} · {session.tenant.role}</p></div></div>
              <button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Close"><X size={17} /></button>
            </div>
            <div className="settings-account"><span className="avatar large">{session.user.name.slice(0, 1).toUpperCase()}</span><div><b>{session.user.name}</b><span>{session.user.email}</span></div></div>
            {(session.tenant.role === "owner" || session.tenant.role === "admin") && (
              <div className="settings-block">
                <div className="settings-label"><Users size={14} /><span>Members</span><small>{members.length}</small></div>
                <div className="member-list">
                  {members.map((member) => <div className="member-row" key={member.id}><span className="member-avatar">{member.name.slice(0, 1).toUpperCase()}</span><div><b>{member.name}</b><span>{member.email}</span></div><em>{member.role}</em></div>)}
                  {invites.filter((invite) => invite.status === "pending").map((invite) => <div className="member-row pending" key={invite.id}><span className="member-avatar"><UserPlus size={13} /></span><div><b>{invite.email}</b><span>ログイン待ち</span></div><em>{invite.role}</em></div>)}
                </div>
                <div className="inline-form">
                  <input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="member@example.com" />
                  <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as WorkspaceInvite["role"])}><option value="admin">Admin</option><option value="editor">Editor</option><option value="viewer">Viewer</option></select>
                  <button onClick={() => void handleInvite()} disabled={settingsBusy || !inviteEmail.trim()}><UserPlus size={13} /> Invite</button>
                </div>
              </div>
            )}
            <div className="settings-block">
              <div className="settings-label"><Building2 size={14} /><span>New workspace</span></div>
              <div className="inline-form"><input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="チーム名" /><button onClick={() => void handleCreateWorkspace()} disabled={settingsBusy || workspaceName.trim().length < 2}>Create</button></div>
            </div>
            {settingsMessage && <p className="settings-message">{settingsMessage}</p>}
          </section>
        </div>
      )}

      <footer className="site-footer"><Logo /><span>Built on Cloudflare’s edge.</span><button>System status <ChevronDown size={12} /></button></footer>
    </div>
  );
}
