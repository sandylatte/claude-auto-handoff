// The handoff viewer: one self-contained HTML page per brief, written to a pages/ folder beside
// the briefs. Each brief starts with a small header (from, to, chain, tokens, at, cwd); briefs that
// share a chain id or a from/to link are one run of handoffs, and every page in a run lists all of them.
// The page renders the brief's markdown in the browser from a CDN, so the mod ships no packages.

export type Header = { from?: string; to?: string; chain?: string; depth?: string; tokens?: string; at?: string; cwd?: string; viewer?: string }
export type Entry = { id: string; header: Header; body: string }

const HEADER_KEYS = ['from', 'to', 'chain', 'depth', 'tokens', 'at', 'cwd', 'viewer'] as const

/** Splits a brief into its header and body. A brief with no header is a chain of one. */
export function parseBrief(text: string): { header: Header; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text)
  if (!m) return { header: {}, body: text }
  const header: Header = {}
  for (const line of m[1]!.split('\n')) {
    const kv = /^(\w+):\s*(.*)$/.exec(line)
    if (kv && (HEADER_KEYS as readonly string[]).includes(kv[1]!)) header[kv[1] as keyof Header] = kv[2]!.trim()
  }
  return { header, body: text.slice(m[0].length) }
}

export function withHeader(header: Header, body: string): string {
  const lines = HEADER_KEYS.filter(k => header[k] !== undefined).map(k => `${k}: ${header[k]}`)
  return `---\n${lines.join('\n')}\n---\n${body}`
}

/** Every brief linked to id, oldest first. Briefs join through a shared chain id or a from/to
 * link, so a run whose chain id broke partway (a hot reload once dropped it) still reads as one. */
export function chainOf(entries: readonly Entry[], id: string): Entry[] {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!
    parent.set(x, r)
    return r
  }
  const join = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb) }
  for (const e of entries) {
    join(e.id, `chain:${e.header.chain || e.id}`)
    if (e.header.from) join(e.id, e.header.from)
    if (e.header.to) join(e.id, e.header.to)
  }
  const root = find(id)
  return entries.filter(e => find(e.id) === root).sort((a, b) => (a.header.at ?? '').localeCompare(b.header.at ?? ''))
}

/** The page's address: served when the mod runs a server, else the local file. The served link
 * uses the session id's first 8 characters, short enough to stay on one line on a phone. */
export function viewerLink(serve: { host: string; port: string } | undefined, pagesDir: string, sessionId: string): string {
  if (serve) return `http://${serve.host}:${serve.port}/${sessionId.slice(0, 8)}`
  // A Windows path (C:\Users\x) becomes file:///C:/Users/x; a POSIX path passes through.
  const dir = pagesDir.replace(/\\/g, '/').replace(/^(?=[A-Za-z]:)/, '/')
  return `file://${dir}/${sessionId}.html`
}

// Sections meant for the fresh session, not for a person reading the page.
const HIDDEN = new Set(['Instructions', 'How to Use This Brief'])

/** The brief's "## " sections, minus the ones written for the model. */
export function sections(body: string): string[] {
  return body.split(/^(?=## )/m).map(s => s.trim()).filter(s => s && !HIDDEN.has(/^## (.+)$/m.exec(s)?.[1]?.trim() ?? ''))
}

function oneLiner(body: string): string {
  const m = /## Work in Progress\s*\n+([\s\S]+?)(?:\n\n|\n##|$)/.exec(body)
  if (!m) return ''
  const s = m[1]!.replace(/\s+/g, ' ').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/^\d+\.\s*|^-\s*/, '').trim()
  return s.length > 120 ? `${s.slice(0, 117)}…` : s
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const short = (id: string) => id.slice(0, 8)
const when = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
}
const tokens = (t?: string) => (t && Number(t) ? ` · ${Math.round(Number(t) / 1000)}k` : '')
const chip = (id: string, current: boolean) => `<span class="chip${current ? ' on' : ''}" title="${esc(id)}">${esc(short(id))}</span>`

// Fonts, the markdown renderer and the styles of the brief page.
const HEAD = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;700&family=Fraunces:opsz,wght@9..144,400;9..144,700;9..144,900&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.1.6/purify.min.js"></script>
<style>
  :root { color-scheme: light; --paper: #F7F3ED; --ink: #1C1C1C; --red: #E63946; --blue: #457B9D; --green: #2A9D8F;
    --font-display: 'Fraunces', serif; --font-body: 'DM Sans', sans-serif; --font-mono: 'DM Mono', monospace; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: var(--font-body); background: var(--ink); color: var(--ink); font-size: 16px; line-height: 1.7; -webkit-font-smoothing: antialiased; min-height: 100vh; }
  .card { max-width: 760px; margin: 0 auto; padding-bottom: 48px; }
  .header { background: var(--ink); padding: 28px 16px 24px; }
  .header h1 { font-family: var(--font-display); font-size: 1.5rem; font-weight: 900; color: var(--paper); margin: 0 0 8px; }
  .meta { font-family: var(--font-mono); font-size: 12px; color: rgba(247,243,237,0.5); display: flex; flex-wrap: wrap; gap: 10px 20px; align-items: center; }
  .meta a { color: rgba(247,243,237,0.75); text-decoration: none; }
  .meta a:hover { color: var(--paper); }
  .meta .chip { background: rgba(247,243,237,0.1); color: rgba(247,243,237,0.7); }
  .chip { font-family: var(--font-mono); font-size: 11px; background: rgba(28,28,28,0.08); color: var(--ink); padding: 2px 7px; border-radius: 6px; white-space: nowrap; }
  .chip.on { background: var(--ink); color: var(--paper); }
  .section { background: var(--paper); padding: 24px 16px; border-bottom: 1px solid rgba(28,28,28,0.1); overflow-wrap: break-word; }
  @media (min-width: 600px) { .header, .section { padding-left: 32px; padding-right: 32px; } }
  .row { display: flex; gap: 10px; padding: 8px 0; border-bottom: 1px solid rgba(28,28,28,0.08); }
  .row a { text-decoration: none; }
  .rowtext { min-width: 0; flex: 1; }
  .when { font-size: 12px; color: #777; font-family: var(--font-mono); margin-right: 6px; }
  .latest { font-size: 10px; font-family: var(--font-mono); background: var(--green); color: #fff; padding: 1px 6px; border-radius: 4px; }
  .wip { font-size: 13px; color: #555; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  h2 { font-family: var(--font-display); font-weight: 700; font-size: 1.35rem; margin: 0 0 14px; padding-bottom: 8px; border-bottom: 2px solid var(--ink); line-height: 1.2; }
  h3 { font-family: var(--font-display); font-weight: 700; font-size: 1.05rem; color: var(--blue); margin: 16px 0 6px; }
  p { margin: 0 0 12px; } p:last-child { margin-bottom: 0; }
  code { font-family: var(--font-mono); background: rgba(28,28,28,0.07); padding: 1px 5px; border-radius: 3px; font-size: 0.85em; word-break: break-all; }
  pre { background: var(--ink); color: var(--paper); padding: 14px 18px; margin: 12px 0; font-size: 0.85em; white-space: pre-wrap; word-break: break-all; box-shadow: 4px 4px 0 var(--blue); }
  pre code { background: none; padding: 0; color: inherit; }
  ul, ol { padding-left: 20px; margin: 0 0 12px; } li { margin-bottom: 5px; line-height: 1.55; }
  li::marker { color: var(--red); } ol li::marker { color: var(--ink); }
  a { color: var(--blue); text-underline-offset: 2px; } a:hover { color: var(--red); }
  strong { font-weight: 600; }
</style>
`

/** The page for one brief. chain is every brief in its chain, oldest first (the brief itself included). */
export function renderPage(entry: Entry, chain: readonly Entry[]): string {
  const { header } = entry
  // Previous and next are the neighbours in the chain, not the header's from/to: a header can
  // miss a link the chain recovered. The last brief's session has no page until it hands off.
  const at = chain.findIndex(e => e.id === entry.id)
  const prev = chain[at - 1]
  const next = at >= 0 ? chain[at + 1] : undefined
  const meta = [
    chip(entry.id, false),
    `<span>${esc(when(header.at))}${esc(tokens(header.tokens))}</span>`,
    header.cwd ? `<span>${esc(header.cwd)}</span>` : '',
    `<a href="${esc(chatPage(entry.id))}">read the old chat</a>`,
    prev ? `<a href="${esc(prev.id)}.html">← previous</a>` : '',
    next ? `<a href="${esc(next.id)}.html">next →</a>`
      : header.to ? `<span title="${esc(header.to)}">next: ${esc(short(header.to))}, still running</span>` : '',
  ].filter(Boolean).join('')
  const rows = chain.length > 1 ? chain.map((e, i) => {
    const current = e.id === entry.id
    const c = current ? chip(e.id, true) : `<a href="${esc(e.id)}.html">${chip(e.id, false)}</a>`
    const latest = i === chain.length - 1 ? '<span class="latest">latest</span>' : ''
    const wip = oneLiner(e.body)
    return `<div class="row"><div>${c}</div><div class="rowtext"><div><span class="when">${i + 1}. ${esc(when(e.header.at))}${esc(tokens(e.header.tokens))}</span>${latest}</div>${wip ? `<div class="wip">${esc(wip)}</div>` : ''}</div></div>`
  }).join('') : ''
  const history = rows ? `<div class="section"><h2>Handoff Chain</h2>${rows}</div>` : ''
  // JSON in a script tag: escape "<" so a brief can never close the tag.
  const data = JSON.stringify(sections(entry.body)).replace(/</g, '\\u003c')
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Session Context ${esc(short(entry.id))}</title>
${HEAD}</head>
<body>
<div class="card">
  <div class="header"><h1>↕ Session Context</h1><div class="meta">${meta}</div></div>
  ${history}
  <div id="brief"></div>
</div>
<script id="data" type="application/json">${data}</script>
<script>
  var parts = JSON.parse(document.getElementById('data').textContent), out = document.getElementById('brief');
  parts.forEach(function (md) {
    var div = document.createElement('div');
    div.className = 'section';
    if (window.marked && window.DOMPurify) div.innerHTML = DOMPurify.sanitize(marked.parse(md));
    else { var pre = document.createElement('pre'); pre.textContent = md; div.appendChild(pre); }
    out.appendChild(div);
  });
</script>
</body>
</html>
`
}

// Modelled on the Claude chat itself: cream page, your messages in a bubble on the right,
// Claude's replies as plain serif text on the left, light and dark.
const CHAT_STYLE = `<style>
  :root { color-scheme: light dark; --bg: #FAF9F5; --ink: #141413; --muted: #73726C; --bubble: #F0EEE6; --line: rgba(31,30,29,0.12); --code: rgba(31,30,29,0.06); --accent: #C96442;
    --serif: ui-serif, Georgia, Cambria, 'Times New Roman', serif; --sans: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; --mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; }
  @media (prefers-color-scheme: dark) { :root { --bg: #262624; --ink: #F5F4EE; --muted: #A6A39A; --bubble: #141413; --line: rgba(245,244,238,0.12); --code: rgba(245,244,238,0.08); --accent: #D97757; } }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: var(--bg); color: var(--ink); font-family: var(--sans); -webkit-font-smoothing: antialiased; }
  .card { max-width: 768px; margin: 0 auto; padding: 0 16px 64px; }
  .top { position: sticky; top: 0; background: var(--bg); display: flex; justify-content: space-between; gap: 12px; padding: 14px 0; font-size: 13px; color: var(--muted); border-bottom: 1px solid var(--line); z-index: 1; }
  .top a { color: var(--muted); text-decoration: none; } .top a:hover { color: var(--ink); }
  #chat { display: flex; flex-direction: column; gap: 24px; padding-top: 28px; }
  .msg { overflow-wrap: break-word; line-height: 1.65; }
  .msg.you { align-self: flex-end; max-width: 85%; background: var(--bubble); border-radius: 18px; padding: 10px 16px; font-size: 15.5px; }
  .plain { white-space: pre-wrap; }
  .msg.claude { font-family: var(--serif); font-size: 16.5px; }
  .msg p, .msg ul, .msg ol, .msg pre, .msg table, .msg blockquote { margin: 0 0 12px; } .msg > div > :last-child { margin-bottom: 0; }
  .msg ul, .msg ol { padding-left: 22px; } .msg li { margin-bottom: 4px; }
  .msg h1, .msg h2, .msg h3 { font-size: 1.05em; font-weight: 600; margin: 18px 0 8px; }
  .msg a { color: inherit; text-underline-offset: 3px; }
  .msg code { font-family: var(--mono); font-size: 0.85em; background: var(--code); padding: 1px 5px; border-radius: 4px; word-break: break-word; }
  .msg pre { font-family: var(--mono); font-size: 13px; background: var(--code); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; white-space: pre-wrap; }
  .msg pre code { background: none; padding: 0; }
  .msg table { border-collapse: collapse; font-family: var(--sans); font-size: 14px; } .msg th, .msg td { border-bottom: 1px solid var(--line); padding: 6px 10px; text-align: left; }
  .msg blockquote { border-left: 3px solid var(--line); padding-left: 12px; color: var(--muted); }
  details { font-family: var(--sans); margin-bottom: 10px; }
  summary.tool { display: inline-block; cursor: pointer; list-style: none; font-size: 13px; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 2px 10px; }
  summary.tool::before { content: '▸ '; } details[open] summary.tool::before { content: '▾ '; }
  div.tool { font-family: var(--mono); font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 2px 0 2px 12px; }
  #jump { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); font: 500 13px var(--sans); color: var(--ink); background: var(--bg); border: 1px solid var(--line); border-radius: 999px; padding: 8px 16px; cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,0.12); }
  #jump:hover { background: var(--bubble); }
  #jump[hidden] { display: none; }
  details > div.tool:first-of-type { margin-top: 6px; }
</style>
`

// "chat-" first: the server's short link picks the first page starting with the session id.
export const chatPage = (sessionId: string) => `chat-${sessionId}.html`

export type Turn = { who: 'you' | 'claude'; text: string; tools: string[] }

/** The whole chat a session had before it handed off, in order, so nothing is lost to the brief. */
export function renderChat(sessionId: string, turns: readonly Turn[], briefPage: string): string {
  // One block per speaker in a row: each tool step arrives as its own message.
  const merged: Turn[] = []
  for (const t of turns) {
    const last = merged[merged.length - 1]
    if (last && last.who === t.who) merged[merged.length - 1] = { who: t.who, text: [last.text, t.text].filter(Boolean).join('\n\n'), tools: [...last.tools, ...t.tools] }
    else merged.push({ ...t, tools: [...t.tools] })
  }
  const data = JSON.stringify(merged).replace(/</g, '\\u003c')
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Old Chat ${esc(short(sessionId))}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.1.6/purify.min.js"></script>
${CHAT_STYLE}</head>
<body>
<div class="card">
  <div class="top"><span>Old chat · ${esc(short(sessionId))} · ${merged.length} messages</span><a href="${esc(briefPage)}">handoff notes →</a></div>
  <div id="chat"></div>
</div>
<button id="jump" hidden aria-label="Jump to the latest message">↓ Latest</button>
<script id="data" type="application/json">${data}</script>
<script>
  var turns = JSON.parse(document.getElementById('data').textContent), out = document.getElementById('chat');
  turns.forEach(function (t) {
    var div = document.createElement('div');
    div.className = t.who === 'you' ? 'msg you' : 'msg claude';
    if (t.text) {
      var body = document.createElement('div');
      // Your messages stay as typed, like the chat shows them; Claude's replies are markdown.
      if (t.who === 'you') { body.className = 'plain'; body.textContent = t.text; }
      else if (window.marked && window.DOMPurify) body.innerHTML = DOMPurify.sanitize(marked.parse(t.text));
      else { var pre = document.createElement('pre'); pre.textContent = t.text; body.appendChild(pre); }
      div.appendChild(body);
    }
    if (t.tools.length) {
      var steps = document.createElement('details'), sum = document.createElement('summary');
      sum.className = 'tool'; sum.textContent = t.tools.length + (t.tools.length === 1 ? ' step' : ' steps');
      steps.appendChild(sum);
      t.tools.forEach(function (x) { var d = document.createElement('div'); d.className = 'tool'; d.textContent = x; steps.appendChild(d); });
      div.insertBefore(steps, div.firstChild);
    }
    out.appendChild(div);
  });
  // Open at the latest message; the button comes back whenever you scroll up.
  var jump = document.getElementById('jump');
  function nearEnd() { return window.innerHeight + window.scrollY >= document.body.scrollHeight - 200; }
  function sync() { jump.hidden = nearEnd(); }
  jump.onclick = function () { window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); };
  window.addEventListener('scroll', sync, { passive: true });
  window.scrollTo(0, document.body.scrollHeight);
  sync();
</script>
</body>
</html>
`
}
