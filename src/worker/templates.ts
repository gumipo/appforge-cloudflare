import { escapeHtml } from "./html";
import type { GeneratedApp } from "./types";

type TemplateResult = Pick<GeneratedApp, "title" | "description" | "html">;

export function titleFromPrompt(prompt: string): string {
  const cleaned = prompt
    .replace(/[。、.!?！？].*$/s, "")
    .replace(/(を|の)?(作って|作成して|つくって|お願いします|ほしい).*$/i, "")
    .trim();
  if (!cleaned) return "New app";
  return cleaned.slice(0, 42);
}

const baseStyles = `
  :root{color-scheme:light;--ink:#17211b;--muted:#68716b;--line:#dfe5df;--paper:#f8faf6;--card:#fff;--accent:#ff6b3d;--green:#194d3a}
  *{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--paper);color:var(--ink)}
  button,input{font:inherit}button{cursor:pointer}.shell{min-height:100vh}.nav{height:68px;padding:0 5vw;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);background:rgba(248,250,246,.92)}
  .brand{display:flex;gap:10px;align-items:center;font-weight:800;letter-spacing:-.03em}.mark{width:28px;height:28px;border-radius:9px;background:var(--green);display:grid;place-items:center;color:white}.nav small{color:var(--muted)}
  .pill{border:1px solid var(--line);padding:8px 12px;border-radius:99px;color:var(--muted);background:white}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.14em;color:var(--accent);font-weight:800}
  h1{font-size:clamp(42px,7vw,82px);line-height:.98;letter-spacing:-.065em;margin:18px 0 22px;max-width:840px}p{line-height:1.65;color:var(--muted)}
  .primary{border:0;border-radius:14px;background:var(--green);color:white;padding:13px 18px;font-weight:750;box-shadow:0 8px 24px rgba(25,77,58,.18)}
  @media(max-width:700px){.nav{padding:0 20px}.nav small{display:none}}
`;

function todoTemplate(title: string, prompt: string): TemplateResult {
  const safeTitle = escapeHtml(title);
  const safePrompt = escapeHtml(prompt);
  return {
    title,
    description: "A calm, focused task board generated from your AppForge prompt.",
    html: `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${safeTitle}</title><style>${baseStyles}
      .board{padding:52px 5vw 70px;max-width:1280px;margin:auto}.hero{display:flex;align-items:end;justify-content:space-between;gap:24px;margin-bottom:42px}.hero h1{font-size:clamp(40px,6vw,72px);margin-bottom:8px}.date{color:var(--muted);font-size:14px}
      .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:22px}.stat{background:white;border:1px solid var(--line);border-radius:18px;padding:18px}.stat b{font-size:28px;display:block}.stat span{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em}
      .composer{display:flex;gap:10px;background:white;border:1px solid var(--line);border-radius:18px;padding:10px;margin-bottom:22px}.composer input{flex:1;border:0;outline:0;padding:8px;background:transparent}.columns{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.column{background:#eef2ec;border-radius:22px;padding:16px;min-height:320px}.column-head{display:flex;justify-content:space-between;align-items:center;margin:0 2px 16px}.column h2{font-size:14px;margin:0}.count{font-size:12px;background:white;border-radius:99px;padding:4px 8px;color:var(--muted)}
      .task{border:1px solid var(--line);background:white;border-radius:16px;padding:16px;margin-bottom:10px;box-shadow:0 4px 14px rgba(30,45,35,.04)}.task p{margin:0 0 18px;color:var(--ink);font-weight:650;line-height:1.4}.task-footer{display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--muted)}.dot{width:8px;height:8px;border-radius:50%;background:var(--accent);display:inline-block;margin-right:5px}.task button{border:0;background:#f1f4f0;border-radius:8px;padding:5px 8px;color:var(--green)}
      .prompt-note{font-size:12px;color:var(--muted);max-width:420px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}@media(max-width:800px){.columns{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr}.hero{align-items:start;flex-direction:column}}
    </style></head><body><div class="shell"><nav class="nav"><div class="brand"><span class="mark">✓</span>${safeTitle}</div><small>Focus on what matters today.</small><span class="pill">Personal</span></nav><main class="board"><section class="hero"><div><div class="eyebrow">Today’s workspace</div><h1>Make space<br>for progress.</h1><div class="date" id="date"></div></div><div><button class="primary" id="focus">Start focus session</button></div></section><section class="stats"><div class="stat"><b id="total">4</b><span>Total tasks</span></div><div class="stat"><b id="done">1</b><span>Completed</span></div><div class="stat"><b>75%</b><span>Weekly pace</span></div></section><form class="composer" id="form"><input id="input" maxlength="80" placeholder="Add a task and press Enter…"><button class="primary">Add task</button></form><div class="columns"><section class="column" data-column="todo"><div class="column-head"><h2>Up next</h2><span class="count">2</span></div><article class="task"><p>Shape the first product flow</p><div class="task-footer"><span><i class="dot"></i>High priority</span><button data-move>Move →</button></div></article><article class="task"><p>Write a tiny launch checklist</p><div class="task-footer"><span>Today</span><button data-move>Move →</button></div></article></section><section class="column" data-column="doing"><div class="column-head"><h2>In motion</h2><span class="count">1</span></div><article class="task"><p>Polish the onboarding screen</p><div class="task-footer"><span><i class="dot"></i>Design</span><button data-move>Move →</button></div></article></section><section class="column" data-column="done"><div class="column-head"><h2>Done</h2><span class="count">1</span></div><article class="task"><p>Choose a clear product name</p><div class="task-footer"><span>Completed</span><button data-move>Reset ↺</button></div></article></section></div><p class="prompt-note" title="${safePrompt}">Built from: ${safePrompt}</p></main></div><script>
      const columns=[...document.querySelectorAll('.column')];
      const refresh=()=>{document.querySelector('#total').textContent=document.querySelectorAll('.task').length;document.querySelector('#done').textContent=columns[2].querySelectorAll('.task').length;columns.forEach(c=>c.querySelector('.count').textContent=c.querySelectorAll('.task').length)};
      const wire=(button)=>button.onclick=()=>{const card=button.closest('.task'),col=card.closest('.column'),index=columns.indexOf(col),next=columns[(index+1)%columns.length];next.append(card);button.textContent=index===1?'Reset ↺':'Move →';refresh()};document.querySelectorAll('[data-move]').forEach(wire);
      document.querySelector('#form').onsubmit=e=>{e.preventDefault();const input=document.querySelector('#input');if(!input.value.trim())return;const card=document.createElement('article');card.className='task';card.innerHTML='<p></p><div class="task-footer"><span>Just added</span><button data-move>Move →</button></div>';card.querySelector('p').textContent=input.value.trim();columns[0].append(card);wire(card.querySelector('button'));input.value='';refresh()};
      document.querySelector('#date').textContent=new Intl.DateTimeFormat('ja-JP',{dateStyle:'full'}).format(new Date());document.querySelector('#focus').onclick=e=>{e.currentTarget.textContent='25:00 · Stay focused';};
    </script></body></html>`,
  };
}

function productTemplate(title: string, prompt: string): TemplateResult {
  const safeTitle = escapeHtml(title);
  const safePrompt = escapeHtml(prompt);
  return {
    title,
    description: `A polished concept for ${title}, generated with AppForge.`,
    html: `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${safeTitle}</title><style>${baseStyles}
      .hero{padding:10vh 5vw 7vh;max-width:1280px;margin:auto}.hero p{max-width:620px;font-size:18px}.actions{display:flex;gap:10px;margin-top:32px}.secondary{border:1px solid var(--line);background:white;border-radius:14px;padding:13px 18px;font-weight:700}.grid{max-width:1280px;margin:auto;padding:0 5vw 9vh;display:grid;grid-template-columns:1.2fr .8fr;gap:16px}.card{border:1px solid var(--line);border-radius:26px;background:white;overflow:hidden}.visual{min-height:390px;padding:32px;background:linear-gradient(145deg,#173e31,#27684f);color:white;display:flex;flex-direction:column;justify-content:space-between}.visual h2{font-size:clamp(32px,5vw,62px);letter-spacing:-.05em;margin:0}.orb{width:180px;height:180px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffe6a7,#ff7c52 55%,#b82f57);align-self:flex-end;box-shadow:0 20px 80px rgba(0,0,0,.25)}.side{padding:28px}.feature{padding:18px 0;border-bottom:1px solid var(--line)}.feature:last-child{border:0}.feature b{display:block;margin-bottom:5px}.feature p{margin:0;font-size:14px}.quote{padding:26px 5vw;border-top:1px solid var(--line);font-size:13px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}@media(max-width:800px){.grid{grid-template-columns:1fr}.visual{min-height:320px}}
    </style></head><body><div class="shell"><nav class="nav"><div class="brand"><span class="mark">✦</span>${safeTitle}</div><small>Thoughtful products for everyday life.</small><span class="pill">Early access</span></nav><main><section class="hero"><div class="eyebrow">A new way forward</div><h1>${safeTitle}<br>made beautifully simple.</h1><p>Turn the complicated into something calm, useful, and human. This interactive concept was shaped directly from your idea.</p><div class="actions"><button class="primary" id="cta">Join the waitlist</button><button class="secondary" id="learn">See how it works ↓</button></div></section><section class="grid" id="features"><div class="card visual"><span>Designed for momentum</span><div class="orb"></div><h2>Less friction.<br>More flow.</h2></div><div class="card side"><div class="eyebrow">Why it feels different</div><div class="feature"><b>Clear by default</b><p>Every detail earns its place and guides the next action.</p></div><div class="feature"><b>Fast from day one</b><p>Built on the edge, so your ideas travel at full speed.</p></div><div class="feature"><b>Yours to shape</b><p>Start simple, then grow the experience around your needs.</p></div></div></section></main><footer class="quote" title="${safePrompt}">Generated from your prompt: ${safePrompt}</footer></div><script>document.querySelector('#learn').onclick=()=>document.querySelector('#features').scrollIntoView({behavior:'smooth'});document.querySelector('#cta').onclick=e=>{e.currentTarget.textContent='You’re on the list ✓';e.currentTarget.style.background='#ff6b3d'};</script></body></html>`,
  };
}

export function createFallbackApp(prompt: string): GeneratedApp {
  const title = titleFromPrompt(prompt);
  const todo = /(todo|to-do|タスク|やること|task|勤怠|出勤|退勤)/i.test(prompt);
  const result = todo
    ? todoTemplate(title, prompt)
    : productTemplate(title, prompt);
  return {
    ...result,
    summary: todo ? "Created an interactive task-oriented application." : "Created a polished responsive product experience.",
    files: [{ path: "index.html", content: result.html }],
    dataModel: todo ? [{
      name: "tasks",
      fields: [
        { name: "title", type: "text", required: true },
        { name: "status", type: "text", required: true },
        { name: "completedAt", type: "datetime", required: false },
      ],
    }] : [],
  };
}
