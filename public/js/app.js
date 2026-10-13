/* Calendário de conteúdos Franciosi: lógica e interface.
   Estrutura: estado (S) -> funções de regra -> funções que geram HTML -> eventos. */

const S = {
  month: null, selected: null, copied: null,
  flow: {}, pins: {}, attempts: {}, months: [], imported: {}, hidden: [],
  drafts: {}, linkDrafts: {}, pending: {}, slide: {}, hist: {},
  lb: null, adding: false, importOpen: false, importText: '',
  session: null, pick: null, loginErr: '', onlyMine: false, feedAll: false, sending: null, editDue: null, adjOpen: null, adjDrafts: {}, adjErr: '', filter: null, panel: null, open: null, adjEdit: null, adjEditErr: '',
};
const URLS = {};
const LOADING = {};
let POSTS = [];
let CUR_MONTH = null;
let MODAL_A = null;
let FP_DIRTY = false;

/* ---------- utilidades ---------- */
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = n => String(n).padStart(2, '0');
const ddmm = d => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
function stamp() {
  const d = new Date();
  return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function set(patch) { Object.assign(S, patch); render(); }
function persist() {
  if (Storage.cloud) { if (S.session) SYNC.chain = SYNC.chain.then(cloudFlush).catch(e => console.error(e)); return; }
  Storage.save({ flow: S.flow, pins: S.pins, attempts: S.attempts, months: S.months, imported: S.imported, hidden: S.hidden });
}
function save(patch) { Object.assign(S, patch); persist(); render(); }
const isTeam = () => !!(S.session && !S.session.approver);

/* ---------- registros de aprovação ---------- */
function rec(a) {
  const r = S.flow[a] || { content: { status: 'pendente' }, versions: [], history: [], comments: [] };
  const norm = st => st && st.status === 'pre' ? { ...st, status: 'pendente' } : st;
  return { ...r, content: norm(r.content || { status: 'pendente' }), versions: (r.versions || []).map(norm), history: r.history || [], comments: r.comments || [] };
}
function upd(a, fn, what, type) {
  const cur = rec(a);
  const next = fn({ ...cur, content: { ...cur.content }, versions: cur.versions.map(v => ({ ...v })), history: [...cur.history], comments: [...cur.comments] });
  if (what) next.history.unshift({ who: S.session ? S.session.name : '', what, at: stamp(), ts: Date.now(), type: type || '' });
  S.flow = { ...S.flow, [a]: next };
  persist();
}

/* ---------- login ---------- */
async function checkPin(id, pin) {
  const acc = (typeof ACCESS !== 'undefined' && ACCESS[id]) || null;
  if (!acc) return false;
  const txt = 'franciosi|' + id + '|' + pin;
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('') === acc.sha;
  } catch (e) {
    let h = 5381; for (let i = 0; i < txt.length; i++) h = ((h << 5) + h + txt.charCodeAt(i)) | 0; return 'x' + h === acc.alt;
  }
}
async function login() {
  const p = S.pick;
  if (!p) return;
  const err = m => set({ loginErr: m });
  const val = id => (document.getElementById(id) || {}).value || '';
  let session;
  const n = p === 'mkt' ? val('mktName').trim() : '';
  if (p === 'mkt' && !n) return err('Digite seu nome.');
  const pin = val('pin');
  if (!/^\d{4}$/.test(pin)) return err('O PIN precisa ter 4 números.');
  const att = S.attempts[p] || { n: 0, until: 0 };
  if (Date.now() < att.until) return err('Acesso bloqueado por excesso de tentativas. Tente de novo em ' + Math.ceil((att.until - Date.now()) / 60000) + ' min.');
  {
    if (!(await checkPin(p, pin))) {
      const n = att.n + 1;
      const until = n >= 5 ? Date.now() + 5 * 60000 : 0;
      S.attempts = { ...S.attempts, [p]: { n: until ? 0 : n, until } };
      persist();
      return err(until ? 'PIN incorreto. Acesso bloqueado por 5 minutos.' : 'PIN incorreto. Restam ' + (5 - n) + ' tentativas.');
    }
    S.attempts = { ...S.attempts, [p]: { n: 0, until: 0 } };
    persist();
  }
  if (p === 'mkt') session = { id: 'mkt', name: n, role: 'Equipe de marketing', approver: false, main: false };
  else {
    const ap = APPROVERS.find(x => x.id === p);
    session = { id: p, name: ap.name, role: ap.main ? 'Aprovação principal' : ap.role.replace(' · análise', '') + ' · análise (aprovação opcional)', approver: true, main: ap.main };
  }
  Storage.saveSession(session);
  set({ session, loginErr: '', pick: null, adding: false, importOpen: false, onlyMine: false });
}
async function sendLink() {
  const email = ((document.getElementById('email') || {}).value || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return set({ loginErr: 'Digite um e-mail válido.' });
  set({ loginErr: '', sendingLink: true, emailDraft: email });
  const e = await Storage.sendLink(email);
  set({ sendingLink: false, linkSent: e ? null : email, loginErr: e ? 'Não foi possível enviar o link: ' + e : '' });
}
function logout() {
  if (Storage.cloud) { Storage.signOut(); set({ session: null, flow: {}, linkSent: null, onlyMine: false, open: null }); return; }
  Storage.clearSession(); set({ session: null, onlyMine: false, pick: null, adding: false, importOpen: false }); }

/* ---------- sincronização com o servidor (modo online) ---------- */
const SYNC = { flow: {}, rev: {}, set: {}, chain: Promise.resolve() };
const SET_KEYS = ['months', 'imported', 'hidden'];
function takeRow(row) {
  S.flow = { ...S.flow, [row.anchor]: row.data };
  SYNC.flow[row.anchor] = JSON.stringify(row.data);
  SYNC.rev[row.anchor] = row.rev;
}
async function cloudFlush() {
  let changed = false;
  for (const a of Object.keys(S.flow)) {
    const js = JSON.stringify(S.flow[a]);
    if (SYNC.flow[a] === js) continue;
    changed = true;
    const r = await Storage.saveFlow(a, S.flow[a], SYNC.rev[a] || 0);
    if (r.ok) {
      SYNC.rev[a] = r.rev; SYNC.flow[a] = JSON.stringify(r.data);
      if (JSON.stringify(S.flow[a]) === js) S.flow = { ...S.flow, [a]: r.data };
    } else {
      const cur = await Storage.loadFlow(a);
      if (cur) takeRow(cur); else { const f = { ...S.flow }; delete f[a]; S.flow = f; delete SYNC.flow[a]; delete SYNC.rev[a]; }
      alert(r.conflict ? 'Outra pessoa alterou este post ao mesmo tempo. A tela foi atualizada: confira e refaça a ação, se ainda for preciso.' : 'Não foi possível salvar: ' + r.error);
    }
  }
  if (isTeam()) for (const k of SET_KEYS) {
    const js = JSON.stringify(S[k] || (k === 'imported' ? {} : []));
    if (SYNC.set[k] === js) continue;
    const e = await Storage.saveSetting(k, JSON.parse(js));
    if (e) alert('Não foi possível salvar: ' + e); else SYNC.set[k] = js;
    changed = true;
  }
  if (changed) render();
}
function onRemoteFlow(row) {
  const a = row.anchor;
  if ((SYNC.rev[a] || 0) >= row.rev) return;
  if (S.flow[a] && JSON.stringify(S.flow[a]) !== SYNC.flow[a]) return; // há mudança local sendo salva
  takeRow(row);
  render();
}
function onRemoteSetting(row) {
  if (row.key === 'base') { MONTHS = row.value || []; render(); return; }
  if (row.key === 'story_days') { STORY_DAYS = row.value || {}; render(); return; }
  if (!SET_KEYS.includes(row.key)) return;
  const js = JSON.stringify(row.value);
  if (SYNC.set[row.key] === js) return;
  SYNC.set[row.key] = js; S[row.key] = row.value;
  render();
}
async function cloudEnter(email) {
  set({ booting: true, loginErr: '' });
  try {
    const p = await Storage.me(email);
    if (!p) { await Storage.signOut(); return set({ booting: false, session: null, linkSent: null, loginErr: 'O e-mail ' + email + ' não tem acesso a este calendário. Fale com o administrador.' }); }
    const ap = APPROVERS.find(x => x.id === p.pid);
    const session = p.pid === 'mkt'
      ? { id: 'mkt', name: p.name, email, role: 'Equipe de marketing', approver: false, main: false }
      : { id: p.pid, name: p.name, email, role: ap && ap.main ? 'Aprovação principal' : ((ap ? ap.role : 'Diretoria').replace(' · análise', '') + ' · análise'), approver: true, main: !!(ap && ap.main) };
    const d = await Storage.loadAll();
    MONTHS = d.settings.base || [];
    STORY_DAYS = d.settings.story_days || {};
    S.flow = {};
    d.flow.forEach(takeRow);
    SET_KEYS.forEach(k => { S[k] = d.settings[k] || (k === 'imported' ? {} : []); SYNC.set[k] = JSON.stringify(S[k]); });
    if (!SUBSCRIBED) { Storage.subscribe(onRemoteFlow, onRemoteSetting); SUBSCRIBED = true; }
    set({ booting: false, session, linkSent: null });
  } catch (e) {
    set({ booting: false, loginErr: 'Não foi possível carregar o calendário: ' + e.message });
  }
}
let SUBSCRIBED = false;

/* ---------- regras de aprovação ---------- */
function canAct(status) { const s = S.session; return !!(s && s.approver && (status === 'pendente' || status === 'pre')); }
function canAgree(st) {
  const s = S.session;
  if (!s || !s.approver || s.main || !st) return false;
  if (st.status === 'ajustes' || st.status === 'substituida') return false;
  return !(st.dirOk || []).some(x => x.by === s.name);
}
function stageOf(n, k) { return k === 'c' ? n.content : n.versions[n.versions.length - 1]; }
function approve(a, k) {
  const s = S.session;
  const cur = stageOf(rec(a), k);
  if (!cur || (s.main ? !canAct(cur.status) : !canAgree(cur))) return;
  upd(a, n => {
    const st = stageOf(n, k);
    let what;
    if (s.main) { st.status = 'aprovado'; st.final = { by: s.name, at: stamp() }; what = 'aprovou'; if (k === 'c') st.fp = (POSTS.find(x => x.anchor === a) || {}).fp; }
    else { st.dirOk = [...(st.dirOk || []), { by: s.name, at: stamp() }]; what = 'deu de acordo (análise da diretoria) para'; }
    what += k === 'c' ? ' o conteúdo' : ' a arte (versão ' + st.n + ')';
    n.history.unshift({ who: s.name, what, at: stamp(), ts: Date.now(), type: s.main ? 'aprovado' : 'pre' });
    return n;
  });
  render();
}
function adjust(a, k) {
  const s = S.session;
  const cur = stageOf(rec(a), k);
  if (!cur || !canAct(cur.status)) return;
  const key = a + '|' + k;
  const note = (S.adjDrafts[key] || '').trim();
  if (note.length < 20) return set({ adjErr: key });
  upd(a, n => {
    const st = stageOf(n, k);
    const prevStatus = st.status; st.status = 'ajustes'; st.adj = { by: s.name, at: stamp(), note, prevStatus }; st.fixed = null;
    n.history.unshift({ who: s.name, what: 'pediu ajustes ' + (k === 'c' ? 'no conteúdo' : 'na arte (versão ' + st.n + ')') + (note ? ': "' + note + '"' : ''), at: stamp(), ts: Date.now(), type: 'ajustes' });
    if (note) n.comments.push({ a: s.name, t: 'Ajuste: ' + note, at: stamp() });
    return n;
  });
  S.adjDrafts[key] = ''; S.adjOpen = null; S.adjErr = '';
  render();
}
function revise(a) {
  if (!isTeam()) return;
  const s = S.session;
  upd(a, n => {
    const adj = n.content.adj || {};
    n.content = { status: 'pendente', fixed: { reqBy: adj.by || '', reqAt: adj.at || '', note: adj.note || '', by: s.name, at: stamp() } };
    return n;
  }, 'fez o ajuste pedido no conteúdo e reenviou para aprovação', 'revisado');
  render();
}
async function sendVersion(a) {
  const s = S.session;
  const link = (S.linkDrafts[a] || '').trim();
  const pend = S.pending[a] || [];
  if (!isTeam() || (!link && !pend.length) || S.sending) return;
  const nv = rec(a).versions.length + 1;
  set({ sending: a });
  const files = [];
  try {
    for (let i = 0; i < pend.length; i++) {
      const key = a + '-v' + nv + '-' + i + '-' + Date.now();
      await Storage.putFile(key, pend[i].file);
      URLS[key] = pend[i].url;
      files.push({ key, type: pend[i].type, name: pend[i].name });
    }
  } catch (e) {
    set({ sending: null });
    alert(Storage.cloud ? 'Não foi possível enviar os arquivos: ' + e.message : 'Não foi possível salvar os arquivos neste navegador. Tente arquivos menores ou use um link do Drive.');
    return;
  }
  upd(a, n => {
    n.versions.forEach(v => { if (v.status === 'pendente' || v.status === 'pre') v.status = 'substituida'; });
    const prev = n.versions[n.versions.length - 1];
    const fixed = prev && prev.status === 'ajustes' && prev.adj ? { reqBy: prev.adj.by, reqAt: prev.adj.at, note: prev.adj.note || '', by: s.name, at: stamp() } : null;
    n.versions.push({ n: nv, link, files, by: s.name, at: stamp(), status: 'pendente', fixed });
    n.history.unshift({ who: s.name, what: fixed ? 'fez o ajuste pedido na arte e enviou a versão ' + nv : 'enviou a arte (versão ' + nv + ')', at: stamp(), ts: Date.now(), type: fixed ? 'revisado' : 'envio' });
    return n;
  });
  S.linkDrafts[a] = ''; S.pending[a] = []; S.slide[a] = 0;
  set({ sending: null });
}
function addComment(a) {
  const t = (S.drafts[a] || '').trim();
  if (!t || !S.session) return;
  upd(a, n => { n.comments.push({ a: S.session.name, t, at: stamp() }); return n; });
  S.drafts[a] = '';
  render();
}

/* ---------- visual de cada etapa ---------- */
function histItem(h) {
  let t = h.type;
  if (!t) { const w = h.what || ''; t = w.includes('final') || w.startsWith('aprovou') ? 'aprovado' : w.includes('pré') || w.includes('de acordo') ? 'pre' : w.includes('pediu ajuste') ? 'ajustes' : w.includes('ajuste') || w.includes('revis') ? 'revisado' : w.includes('enviou') ? 'envio' : 'outro'; }
  return { ...h, T: HTYPES[t] || HTYPES.outro };
}
function stageView(st, due, today, kind) {
  const status = st ? st.status : null;
  const sty = STATUS[status || 'pendente'] || STATUS.pendente;
  const done = status === 'aprovado';
  const late = !done && today > due;
  const ses = S.session;
  const meta = [];
  if (st && st.final) meta.push('Aprovado por ' + st.final.by + ' em ' + st.final.at);
  if (st && st.reopened && status === 'pendente') meta.push('Aprovação reaberta em ' + st.reopened.at + ': o conteúdo mudou depois de aprovado' + (st.reopened.prevBy ? ' por ' + st.reopened.prevBy : '') + '.');
  ((st && st.dirOk) || []).forEach(x => meta.push('Análise da diretoria: ' + x.by + ' de acordo em ' + x.at));
  const showAdj = !!(st && st.adj && status === 'ajustes');
  const fx = st && st.fixed && status !== 'ajustes' ? st.fixed : null;
  const fixMine = !!(fx && ses && fx.reqBy === ses.name);
  const isMain = !!(ses && ses.main);
  const can = !!st && (isMain ? canAct(status) : canAgree(st));
  const canAdj = !!st && canAct(status);
  let hint = '';
  if (st && status !== 'ajustes' && ses && ses.approver && !isMain) {
    hint = can ? 'Sua análise é opcional e não trava a próxima etapa. A aprovação principal é do Gerente de Marketing.' : 'Você já deu sua análise.';
  }
  return {
    ...sty, status, meta, canAct: can, canAdjust: canAdj, hint, done, late,
    showAdj, adj: showAdj ? st.adj : null,
    adjWait: kind === 'c'
      ? (ses && ses.approver ? 'A equipe de marketing vai corrigir e reenviar. Você será avisado aqui.' : 'Corrija e clique em "Ajuste feito, reenviar".')
      : (ses && ses.approver ? 'A equipe de marketing vai enviar uma nova versão. Você será avisado aqui.' : 'Envie uma nova versão da arte com a correção.'),
    fx, fixMine, fixPending: !!fx && !done,
    fixTitle: !fx ? '' : done ? 'Ajuste feito e aprovado' : fixMine ? 'O ajuste que você pediu foi feito. Confira e aprove.' : 'Ajuste feito, aguardando conferência',
    numBg: done ? 'var(--green-500)' : 'var(--blue-900)',
    due: (done ? 'Prazo era ' : 'Aprovar até ') + ddmm(due) + (late ? ' · Atrasado' : ''),
  };
}

/* ---------- meses e posts ---------- */
function allMonths() {
  const imp = S.imported || {};
  const custom = (S.months || []).filter(c => !MONTHS.some(x => x.m === c.m && x.y === c.y)).map(c => ({ name: MONTH_NAMES[c.m], m: c.m, y: c.y, custom: true,
    headline: 'Calendário em planejamento.', summary: 'Use "Importar conteúdos do mês" para trazer todos os posts de uma vez.', themes: [], posts: [] }));
  const hid = new Set(S.hidden || []);
  return MONTHS.concat(custom).filter(M => !hid.has(M.y + '-' + M.m)).map(M => {
    const list = imp[M.y + '-' + M.m];
    if (!list || !list.length) return M;
    const days = new Set(list.map(p => p.d));
    const themes = Array.from(new Set(M.themes.concat(list.map(p => p.theme).filter(Boolean))));
    return { ...M, themes, posts: M.posts.filter(p => !days.has(p.d)).concat(list) };
  }).sort((a, b) => a.y - b.y || a.m - b.m);
}
function monthIndex(all) {
  if (S.month != null) return Math.min(S.month, all.length - 1);
  const now = new Date(), cur = now.getFullYear() * 12 + now.getMonth();
  let i = all.findIndex(x => x.y * 12 + x.m === cur);
  if (i < 0) i = all.findIndex(x => x.y * 12 + x.m > cur);
  return i < 0 ? all.length - 1 : i;
}
function buildPosts(M) {
  const yk = M.y === 2026 ? '' : M.y + '-';
  const posts = M.posts.map(p => {
    const dt = new Date(M.y, M.m, p.d);
    const pl = PILLARS[p.p] || PILLARS.campo;
    return { ...p, anchor: 'post-' + yk + M.m + '-' + p.d, isPost: true,
      stories: p.st || (STORIES[p.p] || STORIES.campo)(p),
      wd: WD[dt.getDay()], dayLabel: pad(p.d), pillar: pl.name, bg: pl.bg, fg: pl.fg };
  });
  ((!M.custom && M.y === 2026 && STORY_DAYS[M.m]) || []).filter(sd => !M.posts.some(p => p.d === sd.d)).forEach(sd => {
    const dt = new Date(M.y, M.m, sd.d);
    posts.push({ d: sd.d, anchor: 'story-' + yk + M.m + '-' + sd.d, isPost: false, fmt: 'Somente stories', pillar: 'Stories diários',
      theme: sd.theme, short: sd.short, title: sd.short, wd: WD[dt.getDay()], dayLabel: pad(sd.d),
      bg: 'var(--taupe-400)', fg: 'var(--brown-900)', stories: sd.frames });
  });
  posts.sort((a, b) => a.d - b.d);
  const used = {};
  posts.forEach(o => {
    used[o.anchor] = (used[o.anchor] || 0) + 1;
    if (used[o.anchor] > 1) o.anchor += '-' + used[o.anchor];
    o.fp = fingerprint(o);
  });
  FP_DIRTY = false;
  posts.forEach(o => attach(o, M));
  if (FP_DIRTY) persist();
  return posts;
}
function fingerprint(o) {
  const st = v => typeof v === 'string' ? v : v ? (v.t || v.title || v.text || v.label || JSON.stringify(v)) : '';
  const txt = [o.fmt, o.title, o.short, o.how, o.caption, o.tags, (o.stories || []).map(st).join('|')].map(x => x || '').join('§');
  let h = 5381; for (let i = 0; i < txt.length; i++) h = ((h << 5) + h + txt.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
function checkFingerprint(o) {
  const a = o.anchor, cur = S.flow[a];
  if (!cur || !cur.content || cur.content.status !== 'aprovado') return;
  if (!cur.content.fp) { S.flow = { ...S.flow, [a]: { ...cur, content: { ...cur.content, fp: o.fp } } }; FP_DIRTY = true; return; }
  if (cur.content.fp === o.fp) return;
  const prev = cur.content.final || {};
  S.flow = { ...S.flow, [a]: { ...cur,
    content: { status: 'pendente', reopened: { at: stamp(), prevBy: prev.by || '' } },
    history: [{ who: 'Sistema', what: 'reabriu a aprovação: o conteúdo mudou depois de aprovado' + (prev.by ? ' por ' + prev.by : '') + '.', at: stamp(), ts: Date.now(), type: 'outro' }, ...(cur.history || [])] } };
  FP_DIRTY = true;
}
function attach(o, M) {
  const a = o.anchor;
  checkFingerprint(o);
  const r = rec(a);
  const ses = S.session;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const pd = new Date(M.y, M.m, o.d);
  const fromIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const toIso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const cDue = r.due && r.due.c ? fromIso(r.due.c) : new Date(pd.getFullYear(), pd.getMonth(), pd.getDate() - CONTENT_DAYS);
  const aDue = r.due && r.due.a ? fromIso(r.due.a) : new Date(pd.getFullYear(), pd.getMonth(), pd.getDate() - ART_DAYS);
  const c = stageView(r.content, cDue, today, 'c');
  c.canRevise = r.content.status === 'ajustes' && isTeam();
  const vs = r.versions;
  const last = vs[vs.length - 1];
  const artOpen = r.content.status === 'aprovado';
  let av;
  if (!artOpen && last) {
    av = stageView(last, aDue, today, 'a');
    Object.assign(av, { canAct: false, canAdjust: false, late: false, numBg: 'var(--taupe-400)',
      label: 'Enviada · aguardando conteúdo', bg: 'var(--surface-muted)', fg: 'var(--blue-900)',
      due: 'Aprovar até ' + ddmm(aDue),
      hint: 'A aprovação da arte libera depois que o Gerente de Marketing aprovar o conteúdo.' });
  }
  else if (!artOpen) av = { ...STATUS.bloqueada, meta: [], numBg: 'var(--taupe-400)', due: 'Aprovar até ' + ddmm(aDue), late: false,
    label: isTeam() ? 'Pode enviar antes' : STATUS.bloqueada.label,
    hint: isTeam() ? 'Você já pode enviar a arte. A aprovação dela libera depois que o conteúdo for aprovado.' : 'Libera assim que o Gerente de Marketing aprovar o conteúdo.' };
  else if (last) av = stageView(last, aDue, today, 'a');
  else av = { ...STATUS.semArte, meta: [], numBg: 'var(--blue-900)', late: today > aDue,
    hint: ses && ses.approver ? 'A equipe de marketing ainda vai enviar a arte.' : '',
    due: 'Enviar e aprovar até ' + ddmm(aDue) + (today > aDue ? ' · Atrasado' : '') };
  av.open = artOpen; av.last = last; av.old = vs.slice(0, -1).reverse();
  c.k = 'c'; c.dueIso = toIso(cDue); c.dueChanged = !!(r.due && r.due.c);
  av.k = 'a'; av.dueIso = toIso(aDue); av.dueChanged = !!(r.due && r.due.a);
  c.maxIso = av.maxIso = toIso(pd);
  c.a = av.a = a;
  const myAdj = st => !!(ses && st && st.status === 'ajustes' && st.adj && st.adj.by === ses.name);
  av.reel = !o.isPost || /reels/i.test(o.fmt || '');
  let ov;
  const cs = r.content.status || 'pendente';
  if (cs !== 'aprovado' && r.content.fixed && cs !== 'ajustes') ov = { ...STATUS.fixed, short: 'Conteúdo: ajuste feito' };
  else if (cs !== 'aprovado') ov = { ...STATUS[cs], short: 'Conteúdo: ' + STATUS[cs].short };
  else if (last && last.fixed && last.status !== 'aprovado' && last.status !== 'ajustes') ov = { ...STATUS.fixed, short: 'Arte: ajuste feito' };
  else if (!last) ov = { ...STATUS.semArte, short: 'Arte: aguardando envio' };
  else if (last.status === 'aprovado') ov = { ...STATUS.pronto, short: 'Pronto para publicar' };
  else if (last.status === 'pendente' || last.status === 'pre') ov = { ...STATUS.artePendente, short: 'Arte: aguardando' };
  else ov = { ...STATUS[last.status], short: 'Arte: ' + STATUS[last.status].short };
  Object.assign(o, {
    c, av, ov, r,
    mine: (c.canAct && c.status !== 'aprovado') || (artOpen && !!av.canAct),
    fixedForMe: (c.fixMine && c.fixPending) || (artOpen && av.fixMine && av.fixPending),
    myAdj: myAdj(r.content) || myAdj(last),
    late: c.late || (artOpen && av.late),
    contentPending: cs !== 'aprovado',
    artPending: artOpen && (!last || last.status !== 'aprovado'),
    ready: ov.short === 'Pronto para publicar',
  });
}

/* ---------- arte: arquivos e links ---------- */
function ensureUrl(k) {
  if (URLS[k] || LOADING[k]) return;
  LOADING[k] = true;
  Storage.getFile(k).then(b => { URLS[k] = b ? URL.createObjectURL(b) : 'missing'; render(); });
}
function linkItem(raw) {
  const l = /^https?:\/\//.test(raw) ? raw : 'https://' + raw;
  let m;
  if ((m = l.match(/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([^/?#]+)/))) return { kind: 'embed', src: 'https://drive.google.com/embeddedfolderview?id=' + m[1] + '#grid' };
  if ((m = l.match(/drive\.google\.com\/file\/d\/([^/?#]+)/)) || (l.includes('drive.google.com') && (m = l.match(/[?&]id=([^&#]+)/)))) return { kind: 'embed', src: 'https://drive.google.com/file/d/' + m[1] + '/preview' };
  if ((m = l.match(/canva\.com\/design\/([^/]+)\/([^/?#]+)/))) return { kind: 'embed', src: 'https://www.canva.com/design/' + m[1] + '/' + m[2] + '/view?embed' };
  if ((m = l.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/))) return { kind: 'embed', src: 'https://www.youtube.com/embed/' + m[1] };
  const u = l.includes('dropbox.com') ? l.replace('dl=0', 'raw=1') : l;
  if (/\.(png|jpe?g|gif|webp|avif)(\?|#|$)/i.test(u)) return { kind: 'img', src: u };
  if (/\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(u)) return { kind: 'video', src: u };
  return { kind: 'link', src: l };
}
function items(v) {
  if (!v) return [];
  const out = (v.files || []).map(fl => {
    ensureUrl(fl.key);
    const u = URLS[fl.key];
    if (u === 'missing') return { kind: 'missing', src: '' };
    return { kind: (fl.type || '').startsWith('video') ? 'video' : 'img', src: u || '', loading: !u };
  });
  if (v.link) out.push(linkItem(v.link));
  return out;
}

/* ---------- importação ---------- */
function parseTable(t) {
  t = t.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const first = t.split('\n')[0] || '';
  const delim = first.includes('\t') ? '\t' : (first.split(';').length >= first.split(',').length ? ';' : ',');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"' && cell === '') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function pillarKey(txt) {
  const n = (txt || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (n.includes('data') || n.includes('comemor')) return 'data';
  if (n.includes('tecn') || n.includes('autor')) return 'tecnico';
  if (n.includes('pesso')) return 'pessoas';
  if (n.includes('comerc') || n.includes('venda')) return 'comercial';
  if (n.includes('legado') || n.includes('instit')) return 'legado';
  return 'campo';
}
function parseImport(M) {
  const days = new Date(M.y, M.m + 1, 0).getDate();
  const out = [];
  parseTable(S.importText || '').forEach(r => {
    const dRaw = (r[0] || '').trim();
    if (!/^\d{1,2}$/.test(dRaw)) return;
    const d = Number(dRaw);
    const g = i => (r[i] || '').trim();
    const title = g(4) || g(3) || 'Post sem título';
    const p = pillarKey(g(2));
    const item = { d, fmt: g(1) || 'Post estático', p, theme: g(3) || title, title, short: title.length > 30 ? title.slice(0, 28) + '…' : title,
      how: g(5), caption: g(6), tags: g(7), st: g(8) ? g(8).split('|').map(x => x.trim()).filter(Boolean) : null, date: p === 'data', imported: true };
    item.invalid = d < 1 || d > days;
    item.warn = '';
    if (item.invalid) item.warn = 'Dia inválido para ' + M.name + '. Esta linha será ignorada.';
    else {
      const wd = new Date(M.y, M.m, d).getDay();
      if ((wd === 0 || wd === 6) && p !== 'data') item.warn = 'Cai em ' + (wd === 0 ? 'domingo' : 'sábado') + '. Pela regra, fim de semana só recebe datas comemorativas.';
    }
    out.push(item);
  });
  return out;
}
function doImport() {
  const M = CUR_MONTH;
  const list = parseImport(M).filter(p => !p.invalid).map(({ warn, invalid, ...p }) => p);
  if (!list.length || !isTeam()) return;
  save({ imported: { ...S.imported, [M.y + '-' + M.m]: list }, importOpen: false, importText: '' });
}
function readImportFile(file) {
  const rd = enc => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsText(file, enc); });
  rd('utf-8').then(t => t.includes('\uFFFD') ? rd('windows-1252') : t).then(t => set({ importText: t }));
}
function downloadTemplate() {
  const head = ['Dia', 'Formato', 'Pilar', 'Pauta', 'Título', 'Como fazer', 'Legenda', 'Hashtags', 'Stories'];
  const ex = ['5', 'Carrossel', 'Autoridade técnica', 'Qualidade de sementes', 'Antes de plantar, a gente testa', 'Carrossel de 6 telas com um teste por tela.', 'Semente boa não é sorte. É processo.', '#FranciosiSementes #ConstruindoLegado', 'Repost do feed | Foto do dia no campo'];
  const q = v => /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  const csv = '\uFEFF' + [head, ex].map(r => r.map(q).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = 'modelo-calendario-franciosi.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadMonth() {
  if (!isTeam()) return;
  const M = CUR_MONTH;
  const st = v => typeof v === 'string' ? v : v ? (v.t || v.title || v.text || v.label || '') : '';
  const head = ['Data', 'Dia da semana', 'Tipo', 'Formato', 'Pilar', 'Pauta', 'Título', 'Como fazer', 'Legenda', 'Hashtags', 'Stories', 'Conteúdo', 'Prazo do conteúdo', 'Arte', 'Prazo da arte'];
  const rows = POSTS.map(p => [
    pad(p.d) + '/' + pad(M.m + 1) + '/' + M.y, p.wd || '', p.isPost ? 'Post + stories' : 'Somente stories', p.fmt || '', p.pillar || '',
    p.theme || '', p.title || '', p.how || '', p.caption || '', p.tags || '', (p.stories || []).map(st).filter(Boolean).join(' | '),
    p.c ? p.c.label || '' : '', p.c ? p.c.dueIso.split('-').reverse().join('/') : '',
    p.av ? p.av.label || '' : '', p.av ? p.av.dueIso.split('-').reverse().join('/') : '']);
  const q = v => { v = String(v == null ? '' : v); return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const csv = '\uFEFF' + [head].concat(rows).map(r => r.map(q).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = 'calendario-franciosi-' + M.name.toLowerCase() + '-' + M.y + '.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function addMonth() {
  if (!isTeam()) return;
  const m = Number(document.getElementById('newM').value), y = Number(document.getElementById('newY').value);
  if (!(y >= 2000 && y <= 2100)) return alert('Informe um ano válido.');
  S.hidden = (S.hidden || []).filter(k => k !== y + '-' + m);
  if (!allMonths().some(x => x.m === m && x.y === y)) S.months = [...S.months, { m, y }];
  persist();
  const idx = allMonths().findIndex(x => x.m === m && x.y === y);
  set({ adding: false, selected: null, month: idx });
}
function deleteMonth() {
  if (!isTeam()) return;
  const M = CUR_MONTH, all = allMonths();
  if (all.length <= 1) return alert('É preciso manter pelo menos um mês no calendário.');
  if (!confirm('Excluir ' + M.name + ' ' + M.y + ' do calendário? O mês some para todos neste navegador. Para recuperar, adicione o mesmo mês de novo.')) return;
  const k = M.y + '-' + M.m;
  S.months = (S.months || []).filter(c => !(c.m === M.m && c.y === M.y));
  S.hidden = Array.from(new Set([...(S.hidden || []), k]));
  const im = { ...S.imported }; delete im[k]; S.imported = im;
  persist();
  set({ month: Math.max(0, Math.min(S.month == null ? 0 : S.month, allMonths().length - 1)), selected: null });
}

/* =================== HTML =================== */
const btn = (label, action, cls = 'btn-primary', attrs = '', disabled = false) =>
  `<button type="button" class="btn ${cls}" data-action="${action}" ${attrs} ${disabled ? 'disabled' : ''}>${label}</button>`;

function viewHeader() {
  return `<header class="header"><div class="wrap">
    <div class="header-id">
      <img src="assets/franciosi-logo-horizontal.png" alt="Franciosi Sementes">
      <div class="col" style="gap:2px">
        <span class="eyebrow" style="color:var(--green-700)">Calendário editorial · Instagram</span>
        <h1 title="Feed às segundas, quartas e sextas. Stories em todos os dias úteis. Fim de semana só recebe datas comemorativas do agro.">Plantar conteúdo, colher parceria.</h1>
      </div>
    </div>
  </div></header>`;
}

function viewNav(all, mi) {
  const tabs = all.map((m, i) => `<button type="button" class="tab ${i === mi ? 'on' : ''}" data-action="tab" data-i="${i}">${esc(m.name)} ${m.y}<span>${m.posts.length} posts</span></button>`).join('');
  let add = '';
  if (isTeam()) {
    add = S.adding
      ? `<div class="add-form">
          <label class="sr-only" for="newM">Mês</label>
          <select id="newM">${MONTH_NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join('')}</select>
          <label class="sr-only" for="newY">Ano</label>
          <input id="newY" type="number" min="2000" max="2100" value="2027">
          ${btn('Adicionar', 'addMonth', 'btn-secondary btn-s')}
          <button type="button" class="link-btn" data-action="cancelAdd">Cancelar</button>
        </div>`
      : `<button type="button" class="tab add" data-action="openAdd">+ Adicionar mês</button>`;
  }
  return `<nav class="nav" aria-label="Meses"><div class="wrap tabs">${tabs}${add}</div>${viewIdBar()}</nav>`;
}

function viewIdBar() {
  const s = S.session;
  if (s) {
    const mine = POSTS.filter(p => p.mine).length;
    const fixed = POSTS.filter(p => p.fixedForMe).length;
    return `<div class="idbar"><div class="wrap">
      <span class="avatar">${esc(s.name.slice(0, 1).toUpperCase())}</span>
      <div class="col" style="gap:2px"><strong>${esc(s.name)}</strong><span class="small muted">${esc(s.role)}</span></div>
      ${s.approver ? `<button type="button" class="chip-btn ${S.onlyMine === true ? 'on' : ''}" data-action="toggleMine">Aguardando minha aprovação (${mine})</button>` : ''}
      ${fixed || S.onlyMine === 'fixed' ? `<button type="button" class="chip-btn ${S.onlyMine === 'fixed' ? 'on' : 'lime'}" data-action="toggleFixed">Ajustes feitos para você conferir (${fixed})</button>` : ''}
      ${s.approver ? `<button type="button" class="chip-btn ${S.onlyMine === 'myadj' ? 'on' : ''}" data-action="toggleMyAdj">Ajustes solicitados (${POSTS.filter(p => p.myAdj).length})</button>` : ''}
      <button type="button" class="link-btn push-right" data-action="logout">Sair</button>
    </div></div>`;
  }
  return '';
}

function viewLoginCloud() {
  const sent = S.linkSent;
  return `<div class="login">
    <div class="login-art" aria-hidden="true"></div>
    <section class="login-panel">
      <img src="assets/franciosi-logo-horizontal.png" alt="Franciosi Sementes">
      <div class="col" style="gap:8px">
        <span class="eyebrow" style="color:var(--green-700)">Calendário editorial · Instagram</span>
        <h1>Acesso restrito</h1>
        <p class="small pretty">${sent ? 'Enviamos um link de acesso para <strong>' + esc(sent) + '</strong>. Abra o e-mail neste aparelho e clique no link. Pode levar até 1 minuto; confira também o spam.' : 'Digite seu e-mail. Você recebe um link para entrar, sem senha.'}</p>
      </div>
      <form class="row" data-form="sendLink">
        <label class="sr-only" for="email">E-mail</label>
        <input id="email" class="input input-strong" style="width:280px" type="email" autocomplete="email" placeholder="seu@email.com.br" value="${esc(S.emailDraft || '')}">
        <button type="submit" class="btn btn-primary" ${S.sendingLink ? 'disabled' : ''}>${S.sendingLink ? 'Enviando...' : sent ? 'Enviar de novo' : 'Enviar link de acesso'}</button>
      </form>
      ${S.loginErr ? `<span class="err" role="alert">${esc(S.loginErr)}</span>` : ''}
      <p class="small muted">Só e-mails cadastrados pelo administrador têm acesso.</p>
    </section>
  </div>`;
}
function viewLogin() {
  if (Storage.cloud) return viewLoginCloud();
  const p = S.pick;
  const people = APPROVERS.map(x => ({ id: x.id, name: x.name, role: x.role })).concat([{ id: 'mkt', name: 'Equipe', role: 'Marketing' }])
    .map(x => `<button type="button" class="chip-btn ${p === x.id ? 'on' : ''}" data-action="pick" data-id="${x.id}">${esc(x.name)}<small>${esc(x.role)}</small></button>`).join('');
  let form = '';
  if (p) form = `<form class="row" data-form="login">
      ${p === 'mkt' ? `<label class="sr-only" for="mktName">Seu nome</label><input id="mktName" class="input input-strong" style="width:220px" placeholder="Seu nome" autocomplete="name">` : ''}
      <label class="sr-only" for="pin">PIN</label>
      <input id="pin" class="input input-strong input-pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="PIN de 4 números">
      <button type="submit" class="btn btn-primary">Entrar</button>
    </form>`;
  const hint = !p ? 'O Gerente de Marketing faz a aprovação principal. Daniel e Lucas analisam e podem aprovar, sem travar a próxima etapa. Cada pessoa entra com o PIN que recebeu.' : '';
  return `<div class="login">
    <div class="login-art" aria-hidden="true"></div>
    <section class="login-panel">
      <img src="assets/franciosi-logo-horizontal.png" alt="Franciosi Sementes">
      <div class="col" style="gap:8px">
        <span class="eyebrow" style="color:var(--green-700)">Calendário editorial · Instagram</span>
        <h1>Acesso restrito</h1>
        <p class="small pretty">Escolha seu perfil e digite o PIN de 4 números que você recebeu.</p>
      </div>
      <div class="col" style="gap:12px">
        <strong style="font:var(--text-label);color:var(--blue-900)">Quem está acessando?</strong>
        <div class="row">${people}</div>
      </div>
      ${form}
      ${S.loginErr ? `<span class="err" role="alert">${esc(S.loginErr)}</span>` : ''}
      ${hint ? `<p class="small pretty muted">${hint}</p>` : ''}
      <p class="small muted">Não recebeu seu PIN? Fale com o administrador do calendário.</p>
    </section>
  </div>`;
}

function viewSummary(M) {
  const dates = POSTS.filter(p => p.date);
  return `<section class="summary">
    <div class="dark">
      <span class="eyebrow" style="color:var(--green-300)">${esc(M.name)} · Momento da safra</span>
      <h2 class="pretty">${esc(M.headline)}</h2>
      <p class="small pretty" style="opacity:.9">${esc(M.custom && !isTeam() ? (M.posts.length ? 'Conteúdos adicionados pela equipe de marketing.' : 'A equipe de marketing ainda vai adicionar os conteúdos deste mês. Você será avisado quando houver algo para aprovar.') : M.summary)}</p>
    </div>
    <div class="sand">
      <span class="eyebrow" style="color:var(--terracotta-600)">Datas comemorativas do nicho</span>
      <div class="col" style="gap:10px">${dates.map(d => `<div class="date-row"><b>${d.dayLabel}</b><span class="small">${esc(d.title)} <span style="opacity:.7">· ${d.wd}</span></span></div>`).join('') || '<span class="small">Nenhuma data comemorativa do nicho neste período.</span>'}</div>
    </div>
    <div class="card col" style="gap:14px">
      <span class="eyebrow" style="color:var(--green-700)">Pautas do mês</span>
      <div class="col">${M.themes.map(t => `<div class="bullet">${esc(t)}</div>`).join('') || '<span class="small muted">Sem pautas definidas.</span>'}</div>
    </div>
  </section>`;
}

function viewImport(M) {
  if (!isTeam()) return '';
  const key = M.y + '-' + M.m;
  const n = (S.imported[key] || []).length;
  let panel = '';
  if (S.importOpen) {
    const pv = parseImport(M);
    const ok = pv.filter(p => !p.invalid).length;
    panel = `<div class="card col" style="gap:18px">
      <div class="col" style="gap:6px">
        <h2 style="font:var(--text-heading-m);color:var(--blue-900)">Importar ${esc(M.name)} ${M.y} de uma vez</h2>
        <p class="small muted pretty" style="max-width:760px">Preencha o modelo no Excel ou no Google Planilhas, com uma linha por post. Depois selecione as linhas (com ou sem o cabeçalho), copie e cole aqui, ou envie o arquivo .csv. Colunas: Dia, Formato, Pilar, Pauta, Título, Como fazer, Legenda, Hashtags e Stories. Separe os stories com uma barra vertical ( | ).</p>
        <p class="small muted">Pilares aceitos: Campo &amp; safra, Autoridade técnica, Pessoas, Comercial, Legado, Data comemorativa.</p>
      </div>
      <label class="sr-only" for="importText">Linhas da planilha</label>
      <textarea id="importText" class="input" data-model="importText" placeholder="Cole aqui as linhas da planilha">${esc(S.importText)}</textarea>
      <label class="row small" style="color:var(--blue-900);font-weight:700">Ou envie o arquivo:
        <input id="importFile" type="file" accept=".csv,.tsv,.txt" class="small">
      </label>
      ${pv.length ? `<div class="col">
        <span class="eyebrow" style="color:var(--green-700)">Prévia: ${ok} ${ok === 1 ? 'post pronto' : 'posts prontos'}${pv.length - ok ? ', ' + (pv.length - ok) + ' com erro' : ''}</span>
        <div class="preview-list">${pv.map(p => `<div class="preview-row ${p.warn ? 'warn' : ''}">
          <b style="color:var(--blue-900)">${pad(p.d)}</b>
          <span class="small muted" style="font-weight:700">${p.invalid ? '' : WD[new Date(M.y, M.m, p.d).getDay()]}</span>
          <div class="col" style="gap:2px"><span class="small">${esc(p.title)} <span class="muted">· ${esc(p.fmt)} · ${esc((PILLARS[p.p] || PILLARS.campo).name)}</span></span>
          ${p.warn ? `<span class="err" style="font-size:.8125rem">${esc(p.warn)}</span>` : ''}</div>
        </div>`).join('')}</div>
      </div>` : ''}
      <div class="row">
        ${btn(ok ? 'Importar ' + ok + (ok === 1 ? ' post' : ' posts') : 'Importar', 'doImport', 'btn-secondary', '', !ok)}
        ${btn('Cancelar', 'closeImport', 'btn-ghost')}
        <span class="small muted">Posts importados substituem os que já existem no mesmo dia.</span>
      </div>
    </div>`;
  }
  return `<section class="col" style="gap:16px">
    <div class="row">
      ${btn('Importar conteúdos do mês', 'openImport')}
      ${btn('Baixar mês em planilha (Excel)', 'downloadMonth', 'btn-outline')}
      ${btn('Baixar modelo de planilha', 'downloadTemplate', 'btn-ghost')}
      ${n ? `<span class="small muted">${n} ${n === 1 ? 'post importado' : 'posts importados'} neste mês.</span><button type="button" class="link-btn danger" data-action="clearImport">Remover importados</button>` : ''}
      <button type="button" class="link-btn danger push-right" data-action="deleteMonth">Excluir este mês</button>
    </div>
    ${panel}
  </section>`;
}

function viewCalendar(M) {
  const first = (new Date(M.y, M.m, 1).getDay() + 6) % 7;
  const days = new Date(M.y, M.m + 1, 0).getDate();
  const total = Math.ceil((first + days) / 7) * 7;
  let cells = '';
  for (let i = 0; i < total; i++) {
    const d = i - first + 1;
    if (d < 1 || d > days) { cells += '<div class="cal-cell empty"></div>'; continue; }
    const wk = i % 7 >= 5;
    const before = M.start && d < M.start;
    const items = POSTS.filter(p => p.d === d).map(p => `<button type="button" class="cal-item ${p.isPost ? '' : 'is-story'}" style="background:${p.ov.bg};color:${p.ov.fg}" data-action="go" data-a="${p.anchor}" title="${esc(p.ov.short)} · ${esc(p.pillar)}">
      <small class="cal-story">${esc(p.isPost ? p.fmt : 'Stories')}</small><span>${esc(p.short)}</span>
      ${p.late ? `<em style="background:#C62828;color:#fff">Atrasado</em>` : ''}</button>`).join('');
    cells += `<div class="cal-cell ${wk ? 'wk' : ''} ${before ? 'before' : ''}"><b>${d}</b>${items}</div>`;
  }
  return `<section class="card cal" aria-label="Calendário do mês">
    <p class="cal-hint small muted" style="margin-bottom:10px">Arraste para o lado para ver a semana inteira.</p>
    <div class="cal-grid">${['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(w => `<div class="cal-wd">${w}</div>`).join('')}${cells}</div>
    <div class="cal-legend" aria-label="Legenda de status">
      ${STATUS_LEGEND.map(([k, l]) => `<span><i style="background:${STATUS[k].bg}"></i>${l}</span>`).join('')}
    </div>
  </section>`;
}

function timeline(list, withPost) {
  return `<div class="tl">${list.map(h => `<div class="tl-item">
    <span class="tl-dot" style="background:${h.T.color}"></span>
    <div class="col" style="gap:4px">
      <div class="row"><span class="tl-tag" style="background:${h.T.color};color:${h.T.fg}">${h.T.tag}</span><span class="muted" style="font-size:.75rem">${esc(h.at)}</span></div>
      <span class="small pretty"><strong>${esc(h.who)}</strong> ${esc(h.what)}</span>
      ${withPost ? `<button type="button" class="link-btn" data-action="go" data-a="${h.anchor}">Abrir post ${esc(h.post)}</button>` : ''}
    </div></div>`).join('')}</div>`;
}

function viewPanels(M) {
  const nh = POSTS.reduce((n, p) => n + p.r.history.length, 0);
  const tab = (id, label, extra) => {
    const on = S.panel === id;
    return `<button type="button" class="ptab ${on ? 'on' : ''}" aria-expanded="${on}" aria-controls="panel-${id}" data-action="panel" data-p="${id}">${label}${extra}<i aria-hidden="true">${on ? '−' : '+'}</i></button>`;
  };
  const body = S.panel === 'hist' ? viewFeed(M) : '';
  return `<section class="col" style="gap:12px">
    <div class="ptabs" role="group" aria-label="Seções">
      ${tab('hist', 'Histórico', nh ? `<span class="ptab-n">${nh}</span>` : '')}
    </div>
    ${body ? `<div id="panel-${S.panel}">${body}</div>` : ''}
  </section>`;
}
function viewFeed(M) {
  const feed = [];
  POSTS.forEach(p => p.r.history.forEach(h => feed.push({ ...histItem(h), post: p.dayLabel + ' · ' + p.short, anchor: p.anchor, ts: h.ts || 0 })));
  feed.sort((x, y) => y.ts - x.ts);
  return `<section class="card side side-hist" aria-label="Histórico do mês">
    <div class="col" style="gap:2px">
      <span class="eyebrow" style="color:var(--blue-600)">Histórico de ${esc(M.name)}</span>
      <span class="muted" style="font-size:.6875rem">Do mais recente ao mais antigo</span>
    </div>
    ${feed.length ? timeline(feed, true) : '<span class="small muted">Nenhuma movimentação neste mês ainda.</span>'}
  </section>`;
}

function mediaBox(list, idx, ctx, style, extra) {
  const n = list.length;
  const i = n ? Math.min(Math.max(idx || 0, 0), n - 1) : 0;
  const cur = list[i];
  let inner = '';
  if (!cur) inner = '<div class="msg">Sem arquivo.</div>';
  else if (cur.loading) inner = '<div class="msg">Carregando arte...</div>';
  else if (cur.kind === 'img') inner = `<img src="${esc(cur.src)}" alt="Arte, tela ${i + 1}">`;
  else if (cur.kind === 'video') inner = `<video src="${esc(cur.src)}" controls playsinline></video>`;
  else if (cur.kind === 'embed') inner = `<iframe src="${esc(cur.src)}" title="Arte" allow="autoplay; fullscreen" allowfullscreen loading="lazy"></iframe>`;
  else if (cur.kind === 'missing') inner = '<div class="msg">Este arquivo foi enviado em outro computador ou navegador e não está disponível aqui.</div>';
  else inner = `<div class="msg"><span class="pretty">Este link não permite visualização aqui. Envie o arquivo ou use um link do Google Drive ou do Canva.</span><a href="${esc(cur.src)}" target="_blank" rel="noopener">Abrir link</a></div>`;
  const nav = n > 1 ? `<button type="button" class="nav-btn prev" aria-label="Anterior" data-action="${ctx.action}" data-a="${ctx.a}" data-i="${(i - 1 + n) % n}">‹</button>
    <button type="button" class="nav-btn next" aria-label="Próxima" data-action="${ctx.action}" data-a="${ctx.a}" data-i="${(i + 1) % n}">›</button>
    <span class="badge">${i + 1} de ${n}</span>` : '';
  const thumbs = n > 1 ? `<div class="row" style="gap:6px">${list.map((it, k) => `<button type="button" class="thumb ${k === i ? 'on' : ''}" aria-label="Tela ${k + 1}" data-action="${ctx.action}" data-a="${ctx.a}" data-i="${k}">${it.kind === 'img' && it.src ? `<img src="${esc(it.src)}" alt="">` : it.kind === 'video' ? 'Vídeo' : 'Link'}</button>`).join('')}</div>` : '';
  return `<div class="media" style="${style}">${inner}${nav}${extra || ''}</div>${thumbs}`;
}

function stageHead(n, title, v, a) {
  const key = a + '|' + v.k;
  const canEdit = isTeam() && !v.done;
  const due = S.editDue === key
    ? `<div class="row" style="gap:8px">
        <label class="sr-only" for="due-${a}-${v.k}">Novo prazo</label>
        <input id="due-${a}-${v.k}" class="input" type="date" value="${v.dueIso}" max="${v.maxIso}" style="width:auto;padding:6px 10px">
        <button type="button" class="btn btn-primary btn-s" data-action="saveDue" data-a="${a}" data-k="${v.k}">Salvar prazo</button>
        <button type="button" class="link-btn" data-action="cancelDue">Cancelar</button>
      </div>`
    : `<div class="row" style="gap:10px">
        <span style="font:600 .8125rem/1.3 var(--font);color:${v.late ? 'var(--terracotta-600)' : 'var(--text-muted)'}">${esc(v.due)}${v.dueChanged ? ' · prazo alterado' : ''}</span>
        ${canEdit ? `<button type="button" class="link-btn" data-action="editDue" data-a="${a}" data-k="${v.k}">Alterar prazo</button>` : ''}
      </div>`;
  return `<div class="row" style="gap:10px">
    <span class="stage-n" style="background:${v.numBg}">${n}</span>
    <span class="stage-title">${title}</span>
    <span class="pill push-right" style="background:${v.bg};color:${v.fg}">${esc(v.label)}</span>
  </div>
  ${due}`;
}
function saveDue(d) {
  const el = document.getElementById('due-' + d.a + '-' + d.k);
  const v = el && el.value;
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
  const [y, m, dd] = v.split('-');
  const what = 'Prazo de aprovação ' + (d.k === 'c' ? 'do conteúdo' : 'da arte') + ' alterado para ' + dd + '/' + m + '/' + y;
  upd(d.a, r => ({ ...r, due: { ...(r.due || {}), [d.k]: v } }), what, 'prazo');
  set({ editDue: null });
}
function cancelAdj(a, k) {
  const s = S.session;
  const cur = stageOf(rec(a), k);
  if (!s || !cur || cur.status !== 'ajustes' || !cur.adj || cur.adj.by !== s.name) return;
  if (!confirm('Cancelar a solicitação de ajuste e voltar para a etapa anterior?')) return;
  upd(a, n => {
    const st = stageOf(n, k);
    const note = st.adj.note || '';
    st.status = st.adj.prevStatus || 'pendente';
    st.adj = null;
    n.history.unshift({ who: s.name, what: 'cancelou a solicitação de ajuste ' + (k === 'c' ? 'do conteúdo' : 'da arte (versão ' + st.n + ')') + (note ? ' ("' + note + '")' : '') + '. Voltou para aguardando aprovação.', at: stamp(), ts: Date.now(), type: 'outro' });
    return n;
  });
  set({ adjEdit: null, adjEditErr: '' });
}
function saveAdjEdit(a, k) {
  const s = S.session;
  const el = document.getElementById('adje-' + a + '-' + k);
  const note = (el ? el.value : '').trim();
  const cur = stageOf(rec(a), k);
  if (!s || !cur || cur.status !== 'ajustes' || !cur.adj || cur.adj.by !== s.name) return;
  if (note.length < 20) return set({ adjEditErr: a + '|' + k });
  if (note === (cur.adj.note || '')) return set({ adjEdit: null });
  upd(a, n => {
    const st = stageOf(n, k);
    const prev = st.adj.note || '';
    st.adj = { ...st.adj, note, edited: stamp(), prev };
    n.history.unshift({ who: s.name, what: 'alterou a solicitação de ajuste ' + (k === 'c' ? 'do conteúdo' : 'da arte (versão ' + st.n + ')') + ' de "' + prev + '" para "' + note + '"', at: stamp(), ts: Date.now(), type: 'ajustes' });
    n.comments.push({ a: s.name, t: 'Ajuste (alterado): ' + note, at: stamp() });
    return n;
  });
  set({ adjEdit: null, adjEditErr: '' });
}
function banners(v) {
  const key = v.a + '|' + v.k;
  const mineAdj = !!(v.showAdj && S.session && v.adj.by === S.session.name);
  if (mineAdj && S.adjEdit === key) return `<div class="banner-adj">
    <label for="adje-${v.a}-${v.k}" style="font:800 .9375rem/1.3 var(--font)">Editar solicitação de ajuste</label>
    <textarea id="adje-${v.a}-${v.k}" class="input" style="min-height:88px;background:#fff">${esc(v.adj.note || '')}</textarea>
    ${S.adjEditErr === key ? '<span class="err" role="alert">O motivo precisa ter pelo menos 20 caracteres.</span>' : ''}
    <div class="row">${btn('Salvar alteração', 'saveAdjEdit', 'btn-primary btn-s', `data-a="${v.a}" data-k="${v.k}"`)}<button type="button" class="link-btn" data-action="cancelAdjEdit">Cancelar</button></div>
  </div>` + bannersRest(v);
  return bannersBase(v, mineAdj);
}
function bannersRest(v) { return bannersBase({ ...v, showAdj: false }, false); }
function bannersBase(v, mineAdj) {
  let h = '';
  if (v.showAdj) h += `<div class="banner-adj">
    <strong style="font:800 .9375rem/1.3 var(--font)">Ajustes solicitados</strong>
    <span class="small">Pedido por ${esc(v.adj.by)} em ${esc(v.adj.at)}</span>
    ${v.adj.note ? `<span style="font:600 .9375rem/1.4 var(--font);padding:6px 0">"${esc(v.adj.note)}"</span>` : ''}
    ${v.adj.edited ? `<span class="small">Solicitação alterada em ${esc(v.adj.edited)}</span>` : ''}
    <span class="small">${esc(v.adjWait)}</span>
    ${mineAdj ? `<div><button type="button" class="link-btn" style="color:inherit;text-decoration:underline" data-action="editAdj" data-a="${v.a}" data-k="${v.k}">Editar solicitação</button><button type="button" class="link-btn" style="color:inherit;text-decoration:underline;margin-left:16px" data-action="cancelAdj" data-a="${v.a}" data-k="${v.k}">Cancelar solicitação</button></div>` : ''}</div>`;
  if (v.fx) h += `<div class="banner-fix ${v.fixMine && !v.done ? 'mine' : ''}">
    <strong style="font:800 .9375rem/1.3 var(--font);color:var(--green-900)">${esc(v.fixTitle)}</strong>
    <span style="font:600 .875rem/1.4 var(--font);color:var(--blue-900)">Corrigido por ${esc(v.fx.by)} em ${esc(v.fx.at)}</span>
    <span class="small">Pedido de ${esc(v.fx.reqBy || 'aprovador')}${v.fx.reqAt ? ' em ' + esc(v.fx.reqAt) : ''}${v.fx.note ? ': "' + esc(v.fx.note) + '"' : ''}</span></div>`;
  return h;
}
function actions(v, a, k) {
  const label = S.session && S.session.main ? 'Aprovar' : 'De acordo (análise)';
  const key = a + '|' + k;
  let h = v.meta.map(m => `<span class="small muted">${esc(m)}</span>`).join('');
  if (v.canAct) h += `<div class="row">
      ${btn(label, 'approve', 'btn-secondary btn-s', `data-a="${a}" data-k="${k}"`)}
      ${v.canAdjust && S.adjOpen !== key ? btn('Solicitar ajustes', 'openAdj', 'btn-outline btn-s', `data-a="${a}" data-k="${k}"`) : ''}
    </div>
    ${v.canAdjust && S.adjOpen === key ? `<div class="col" style="gap:8px">
      <label for="adj-${a}-${k}" style="font:var(--text-label);color:var(--blue-900)">Motivo do ajuste (obrigatório, mínimo 20 caracteres)</label>
      <textarea id="adj-${a}-${k}" class="input" data-adj="${key}" style="min-height:88px" placeholder="Explique o que precisa mudar">${esc(S.adjDrafts[key] || '')}</textarea>
      <span class="small muted" id="adjc-${a}-${k}">${(S.adjDrafts[key] || '').trim().length}/20 caracteres</span>
      ${S.adjErr === key ? '<span class="err" role="alert">O motivo precisa ter pelo menos 20 caracteres.</span>' : ''}
      <div class="row">${btn('Enviar pedido de ajuste', 'adjust', 'btn-primary btn-s', `data-a="${a}" data-k="${k}"`)}<button type="button" class="link-btn" data-action="closeAdj">Cancelar</button></div>
    </div>` : ''}`;
  if (v.hint) h += `<span style="font:600 .875rem/1.4 var(--font);color:var(--blue-900)">${esc(v.hint)}</span>`;
  return h;
}

function viewArt(p) {
  const v = p.av, a = p.anchor;
  let h = `<div class="stage ${!v.open && !v.last && !isTeam() ? 'dim' : ''}">${stageHead(2, 'Aprovação da arte', v, a)}${banners(v)}`;
  if (v.last) {
    const ratio = v.reel ? '9 / 16' : '4 / 5';
    const maxW = v.reel ? '300px' : '420px';
    h += `<div class="row" style="align-items:baseline"><strong style="font:700 .9375rem/1.2 var(--font);color:var(--blue-900)">Versão ${v.last.n}</strong>
      <span class="small muted">Enviada por ${esc(v.last.by)}${v.last.at ? ' em ' + esc(v.last.at) : ''}</span></div>
      ${mediaBox(items(v.last), S.slide[a], { action: 'slide', a }, `max-width:${maxW};aspect-ratio:${ratio}`, `<button type="button" class="expand" data-action="expand" data-a="${a}" data-n="${v.last.n}">Ampliar</button>`)}
      ${actions(v, a, 'a')}`;
  } else if (v.hint) h += `<span style="font:600 .875rem/1.4 var(--font);color:var(--blue-900)">${esc(v.hint)}</span>`;
  h += v.old.map(o => `<div class="old-v"><strong style="font:700 .8125rem/1.2 var(--font);color:var(--blue-900)">Versão ${o.n}</strong>
    <span>${esc((STATUS[o.status] || STATUS.pendente).label)} · ${esc(o.at || '')}</span>
    <button type="button" class="link-btn push-right" data-action="expand" data-a="${a}" data-n="${o.n}">Ver arte</button></div>`).join('');
  if (isTeam()) {
    const pend = S.pending[a] || [];
    const hasLink = !!(S.linkDrafts[a] || '').trim();
    h += `<div class="col" style="gap:6px">
      <span style="font:var(--text-label);color:var(--blue-900)">${v.last ? 'Enviar nova versão (a anterior fica guardada)' : 'Enviar a arte para aprovação'}</span>
      <div class="send-box">
        <label class="file-label small">
          <span class="btn btn-outline btn-s">Escolher imagens ou vídeo</span>
          <span class="muted">Carrossel: selecione todas as telas de uma vez, na ordem.</span>
          <input type="file" multiple accept="image/*,video/*" data-files="${a}" class="sr-only">
        </label>
        ${pend.length ? `<div class="row" style="gap:6px">${pend.map(pf => `<div class="thumb" style="cursor:default">${(pf.type || '').startsWith('image') ? `<img src="${pf.url}" alt="">` : 'Vídeo'}</div>`).join('')}
          <button type="button" class="link-btn danger" data-action="clearPending" data-a="${a}">Limpar</button></div>` : ''}
        <label class="sr-only" for="link-${a}">Link da arte</label>
        <input id="link-${a}" class="input" data-link="${a}" value="${esc(S.linkDrafts[a] || '')}" placeholder="Ou cole um link do Google Drive ou do Canva">
        <div class="row">
          ${btn(S.sending === a ? 'Enviando...' : pend.length ? 'Enviar ' + pend.length + (pend.length === 1 ? ' arquivo' : ' arquivos') : 'Enviar', 'send', 'btn-primary btn-s', `data-a="${a}"`, S.sending === a || (!pend.length && !hasLink))}
          <span class="small muted">Arquivos enviados ficam salvos neste navegador. Para quem aprova em outro computador, use link do Drive ou do Canva.</span>
        </div>
      </div>
    </div>`;
  }
  return h + '</div>';
}

function thumbOf(p) {
  const v = p.av && p.av.last;
  if (!v) return null;
  const list = items(v);
  const n = list.length;
  const f = list[0];
  let t = null;
  if (f && f.kind === 'img' && f.src) t = { kind: 'img', src: f.src };
  else if (f && f.kind === 'video' && f.src) t = { kind: 'video', src: f.src };
  else if (f && f.loading) t = { kind: 'loading' };
  else if (v.link) {
    const m = v.link.match(/drive\.google\.com\/file\/d\/([^/?#]+)/) || (v.link.includes('drive.google.com') && v.link.match(/[?&]id=([^&#]+)/));
    t = m ? { kind: 'img', src: 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w600' } : { kind: 'link' };
  } else t = { kind: 'link' };
  return { ...t, n, ver: v.n };
}
function viewRow(p) {
  const th = thumbOf(p);
  let media;
  if (!th && !p.isPost) media = `<span class="pcard-empty"><span class="story-ring"><b>${p.dayLabel}</b></span><small>${(p.stories || []).length} ${(p.stories || []).length === 1 ? 'story' : 'stories'} no dia</small></span>`;
  else if (!th) media = `<span class="pcard-empty"><b>${p.dayLabel}</b><small>Sem arte ainda</small></span>`;
  else if (th.kind === 'img') media = `<img src="${esc(th.src)}" alt="" loading="lazy">`;
  else if (th.kind === 'video') media = `<video src="${esc(th.src)}" muted playsinline preload="metadata"></video><span class="pcard-tag pcard-count">Vídeo</span>`;
  else if (th.kind === 'loading') media = '<span class="pcard-empty"><small>Carregando arte...</small></span>';
  else media = `<span class="pcard-empty"><b>${p.dayLabel}</b><small>Arte enviada por link</small></span>`;
  return `<button type="button" class="pcard ${p.isPost ? '' : 'is-story'}" data-action="go" data-a="${p.anchor}">
    <span class="pcard-media" style="background:${p.ov.bg};color:${p.ov.fg}">
      ${media}
      <span class="pcard-tag story-tag">${esc(p.isPost ? p.fmt : 'Stories')}</span>
      ${th && th.n > 1 ? `<span class="pcard-tag pcard-count">${th.n} telas</span>` : ''}
      ${th ? `<span class="pcard-ver">V${th.ver}</span>` : ''}
    </span>
    <span class="pcard-body">
      <span class="pcard-date">${p.dayLabel}/${pad(CUR_MONTH.m + 1)} · ${esc(p.wd)}</span>
      <strong>${esc(p.title)}</strong>
      <span class="prow-meta">${esc(p.isPost ? p.fmt : 'Somente stories')} · ${esc(p.pillar)}</span>
      <span class="pcard-status">
        <span class="pill" style="background:${p.ov.bg};color:${p.ov.fg}">${esc(p.ov.short)}</span>
        ${p.late ? '<span class="pill" style="background:#C62828;color:#fff">Atrasado</span>' : ''}
      </span>
    </span>
  </button>`;
}
function viewModal() {
  const p = S.open && POSTS.find(x => x.anchor === S.open);
  if (!p) return '';
  return `<div class="modal" data-action="closePost" role="dialog" aria-modal="true" aria-label="${esc(p.title)}">
    <div class="modal-inner" data-stop="1">
      <button type="button" class="modal-x" data-action="closePost" aria-label="Fechar">Fechar</button>
      ${viewPost(p)}
    </div>
  </div>`;
}
function viewPost(p) {
  const a = p.anchor;
  const hist = p.r.history.map(histItem);
  const full = !!S.hist[a];
  const content = p.isPost ? `
    <div class="col"><span class="eyebrow" style="color:var(--green-700)">Como fazer</span><p class="small pretty">${esc(p.how)}</p></div>
    <div class="caption">
      <div class="row" style="justify-content:space-between"><span class="eyebrow" style="color:var(--blue-600)">Legenda sugerida</span>
      <button type="button" class="link-btn" data-action="copy" data-a="${a}">${S.copied === a ? 'Copiada ✓' : 'Copiar legenda'}</button></div>
      <p>${esc(p.caption)}</p><p style="color:var(--blue-600)">${esc(p.tags)}</p>
    </div>` : '';
  return `<article id="${a}" class="post ${S.selected === a ? 'sel' : ''}">
    <div class="post-day" style="background:${p.ov.bg};color:${p.ov.fg}"><b>${p.dayLabel}</b><span>${p.wd}</span></div>
    <div class="post-body">
      <div class="row">
        <span class="pill pill-dark">${esc(p.fmt)}</span>
        <span class="pill pill-line">${esc(p.pillar)}</span>
        <span class="small muted">Pauta: ${esc(p.theme)}</span>
      </div>
      <h3>${esc(p.title)}</h3>
      <div class="grid-auto">${content}
        <div class="col" style="gap:10px"><span class="eyebrow" style="color:var(--terracotta-600)">Stories do dia</span>
          ${p.stories.map((t, i) => `<div class="row" style="flex-wrap:nowrap;align-items:flex-start;gap:10px"><span class="story-n">${i + 1}</span><span class="small pretty">${esc(t)}</span></div>`).join('')}
        </div>
      </div>
      <div class="review">
        <div class="grid-stage">
          <div class="stage">${stageHead(1, 'Aprovação do conteúdo', p.c, a)}
            <span class="small muted pretty">Pauta, roteiro, legenda e stories descritos acima.</span>
            ${banners(p.c)}${actions(p.c, a, 'c')}
            ${p.c.canRevise ? `<div>${btn('Ajuste feito, reenviar', 'revise', 'btn-primary btn-s', `data-a="${a}"`)}</div>` : ''}
          </div>
          ${viewArt(p)}
        </div>
        <div class="grid-stage" style="gap:24px">
          <div class="col" style="gap:10px">
            <span class="eyebrow" style="color:var(--blue-900)">Comentários (${p.r.comments.length})</span>
            ${p.r.comments.map(c => `<div class="comment"><span class="avatar">${esc((c.a || '?').slice(0, 1).toUpperCase())}</span>
              <div class="col" style="gap:2px"><span style="font:var(--text-label);color:var(--blue-900)">${esc(c.a)} <span class="muted" style="font-weight:400;font-size:.75rem">· ${esc(c.at)}</span></span>
              <span class="small pretty">${esc(c.t)}</span></div></div>`).join('')}
            ${!S.session ? '<span class="err">Identifique-se na barra do topo para comentar.</span>' : ''}
            <form class="row" style="flex-wrap:nowrap" data-form="comment" data-a="${a}">
              <label class="sr-only" for="c-${a}">Comentário</label>
              <input id="c-${a}" class="input" data-draft="${a}" value="${esc(S.drafts[a] || '')}" placeholder="Escreva um comentário" ${S.session ? '' : 'disabled'}>
              <button type="submit" class="btn btn-ghost btn-s" ${S.session ? '' : 'disabled'}>Comentar</button>
            </form>
          </div>
          <div class="col" style="gap:10px">
            <span class="eyebrow" style="color:var(--blue-900)">Histórico deste post (${hist.length})</span>
            ${hist.length ? timeline(full ? hist : hist.slice(0, 3), false) : '<span class="small muted">Nenhuma movimentação ainda.</span>'}
            ${hist.length > 3 ? `<button type="button" class="link-btn" data-action="toggleHist" data-a="${a}">${full ? 'Mostrar menos' : 'Ver histórico completo (' + hist.length + ')'}</button>` : ''}
          </div>
        </div>
      </div>
    </div>
  </article>`;
}

function viewList(M) {
  const FILT = { content: p => p.contentPending, art: p => p.artPending, late: p => p.late, ready: p => p.ready };
  const base = S.onlyMine === 'myadj' ? POSTS.filter(p => p.myAdj) : S.onlyMine === 'fixed' ? POSTS.filter(p => p.fixedForMe) : S.onlyMine ? POSTS.filter(p => p.mine) : POSTS;
  const list = S.filter && FILT[S.filter] ? base.filter(FILT[S.filter]) : base;
  const title = S.onlyMine === 'myadj' ? 'Ajustes solicitados · ' : S.onlyMine === 'fixed' ? 'Ajustes que você pediu e já foram feitos · ' : S.onlyMine ? 'Aguardando sua aprovação · ' : 'Roteiro de posts · ';
  const empty = S.filter ? 'Nenhum post neste filtro.' : S.onlyMine === 'myadj' ? 'Nenhum ajuste seu em aberto neste mês.' : S.onlyMine === 'fixed' ? 'Nenhum ajuste seu aguardando conferência neste mês.' : S.onlyMine ? 'Nada aguardando sua aprovação neste mês.' : 'Nenhum post planejado para este mês ainda.';
  const counters = [
    ['content', 'conteúdos pendentes', 'var(--blue-900)', 'var(--border-default)'],
    ['art', 'artes pendentes', 'var(--blue-900)', 'var(--border-default)'],
    ['late', 'atrasados', 'var(--terracotta-600)', 'var(--terracotta-600)'],
    ['ready', 'prontos', 'var(--green-700)', 'var(--border-default)'],
  ].map(([f, l, c, r]) => { const on = S.filter === f; return `<button type="button" class="counter ${on ? 'on' : ''}" aria-pressed="${on}" data-action="filter" data-f="${f}" style="box-shadow:inset 0 0 0 ${on ? '2px var(--blue-900)' : '1.5px ' + r}"><b style="color:${c}">${base.filter(FILT[f]).length}</b><span>${l}</span></button>`; }).join('')
    + (S.filter ? '<button type="button" class="link-btn" data-action="filter" data-f="' + S.filter + '">Limpar filtro</button>' : '');
  return `<section class="col" style="gap:20px">
    <div class="list-head"><h2 style="font:var(--text-heading-l);color:var(--blue-900)">${title}${esc(M.name)}</h2><div class="row">${counters}</div></div>
    ${list.length ? `<div class="plist">${list.map(viewRow).join('')}</div>` : `<div class="card muted" style="text-align:center">${empty}</div>`}
  </section>`;
}

function viewLightbox(M) {
  const lb = S.lb;
  if (!lb) return '';
  const v = rec(lb.a).versions.find(x => x.n === lb.n);
  const p = POSTS.find(x => x.anchor === lb.a);
  if (!v) return '';
  const reel = !p || !p.isPost || /reels/i.test(p.fmt || '');
  return `<div class="lightbox" data-action="lbClose" role="dialog" aria-modal="true" aria-label="Arte ampliada">
    <div class="lightbox-inner" data-stop="1">
      <div class="lightbox-head">
        <div class="col" style="gap:2px"><strong style="font:700 1.0625rem/1.3 var(--font)">${p ? p.dayLabel + '/' + pad(M.m + 1) + ' · ' + esc(p.title) : ''}</strong>
        <span class="small" style="opacity:.85">Versão ${v.n} · ${esc((STATUS[v.status] || STATUS.pendente).label)} · enviada por ${esc(v.by)}${v.at ? ' em ' + esc(v.at) : ''}</span></div>
        <button type="button" class="btn btn-s" style="background:#fff;color:var(--blue-900)" data-action="lbClose">Fechar</button>
      </div>
      ${mediaBox(items(v), lb.i, { action: 'lbSlide', a: lb.a }, `aspect-ratio:${reel ? '9 / 16' : '4 / 5'}`)}
    </div>
  </div>`;
}

/* ---------- render ---------- */
/* Atualiza só o que mudou na tela, sem recriar tudo: vídeos e pré-visualizações do Drive/Canva não recarregam. */
function morph(a, b) {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) { a.replaceWith(b); return; }
  if (a.nodeType === 3 || a.nodeType === 8) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
  if (a.nodeType !== 1) return;
  for (const at of Array.from(a.attributes)) if (!b.hasAttribute(at.name)) a.removeAttribute(at.name);
  for (const at of Array.from(b.attributes)) if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value);
  const tag = a.nodeName;
  if (tag === 'IFRAME' || tag === 'VIDEO') return;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    if (tag === 'TEXTAREA') { if (a.defaultValue !== b.defaultValue) a.defaultValue = b.defaultValue; }
    if (a !== document.activeElement) {
      if (a.type === 'checkbox' || a.type === 'radio') a.checked = b.checked;
      else if (a.type !== 'file') a.value = tag === 'TEXTAREA' ? b.defaultValue : (tag === 'SELECT' ? (b.querySelector('option[selected]') || {}).value || a.value : b.getAttribute('value') || '');
    }
    if (tag === 'TEXTAREA') return;
  }
  morphChildren(a, b);
}
function morphChildren(a, b) {
  const bk = Array.from(b.childNodes);
  for (let i = 0; i < bk.length; i++) {
    const nb = bk[i];
    let na = a.childNodes[i];
    const id = nb.nodeType === 1 && nb.id;
    if (id && (!na || na.id !== id)) {
      const found = Array.from(a.children).find(x => x.id === id);
      if (found) { a.insertBefore(found, na || null); na = found; }
    }
    if (!na) a.appendChild(nb);
    else morph(na, nb);
  }
  while (a.childNodes.length > bk.length) a.removeChild(a.lastChild);
}
function paint(html) {
  const root = document.getElementById('app');
  const t = document.createElement('div');
  t.innerHTML = html;
  morphChildren(root, t);
}
function render() {
  if (S.booting) { paint('<p class="boot">Carregando calendário...</p>'); return; }
  const all = allMonths();
  const mi = monthIndex(all);
  const M = all[mi];
  CUR_MONTH = M;
  POSTS = buildPosts(M);
  const act = document.activeElement;
  const focusId = act && act.id;
  const sel = focusId && act.selectionStart != null ? [act.selectionStart, act.selectionEnd] : null;
  if (!S.session) {
    paint(viewLogin());
    const f = document.getElementById(focusId) || document.getElementById(S.pick === 'mkt' ? 'mktName' : 'pin');
    if (f) { f.focus({ preventScroll: true }); if (sel && f.id === focusId && f.setSelectionRange) try { f.setSelectionRange(sel[0], sel[1]); } catch (e) {} }
    return;
  }
  const om = document.querySelector('.modal');
  const modalTop = om ? om.scrollTop : 0;
  paint((Storage.cloud ? '' : '<div class="demo-strip" role="note">Modo de demonstração: os dados ficam só neste navegador. Não use para aprovações reais.</div>') + viewHeader() + viewNav(all, mi) +
    `<main class="wrap"><div class="top">${viewSummary(M)}${viewCalendar(M)}${viewFeed(M)}</div>${viewImport(M)}${viewList(M)}</main>` + viewModal() + viewLightbox(M));
  document.body.classList.toggle('no-scroll', !!(S.lb || S.open));
  const md = document.querySelector('.modal');
  if (md && S.open === MODAL_A) md.scrollTop = modalTop;
  MODAL_A = md ? S.open : null;
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) { el.focus({ preventScroll: true }); if (sel && el.setSelectionRange) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) {} }
  }
}

function go(a) {
  set({ open: a, selected: a });
}
function copyCaption(a) {
  const p = POSTS.find(x => x.anchor === a);
  if (!p) return;
  const txt = p.caption + '\n\n' + p.tags;
  const done = () => { set({ copied: a }); setTimeout(() => { if (S.copied === a) set({ copied: null }); }, 1600); };
  if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done, () => alert('Não foi possível copiar. Selecione o texto manualmente.'));
  else alert('Seu navegador não permite copiar automaticamente. Selecione o texto manualmente.');
}

/* ---------- eventos ---------- */
const ACTIONS = {
  tab: d => set({ month: Number(d.i), selected: null }),
  openAdd: () => isTeam() && set({ adding: true }),
  cancelAdd: () => set({ adding: false }),
  addMonth,
  deleteMonth,
  editDue: d => isTeam() && set({ editDue: d.a + '|' + d.k }),
  cancelDue: () => set({ editDue: null }),
  saveDue,
  pick: d => set({ pick: d.id, loginErr: '' }),
  logout,
  openAdj: d => set({ adjOpen: d.a + '|' + d.k, adjErr: '' }),
  closeAdj: () => set({ adjOpen: null, adjErr: '' }),
  panel: d => set({ panel: S.panel === d.p ? null : d.p }),
  filter: d => set({ filter: S.filter === d.f ? null : d.f }),
  toggleMine: () => set({ onlyMine: S.onlyMine === true ? false : true }),
  toggleMyAdj: () => set({ onlyMine: S.onlyMine === 'myadj' ? false : 'myadj' }),
  editAdj: d => set({ adjEdit: d.a + '|' + d.k, adjEditErr: '' }),
  cancelAdjEdit: () => set({ adjEdit: null, adjEditErr: '' }),
  saveAdjEdit: d => saveAdjEdit(d.a, d.k),
  cancelAdj: d => cancelAdj(d.a, d.k),
  toggleFixed: () => set({ onlyMine: S.onlyMine === 'fixed' ? false : 'fixed' }),
  openImport: () => isTeam() && set({ importOpen: true }),
  closeImport: () => set({ importOpen: false }),
  downloadTemplate,
  downloadMonth,
  doImport,
  clearImport: () => {
    if (!isTeam() || !confirm('Remover os posts importados deste mês?')) return;
    const im = { ...S.imported }; delete im[CUR_MONTH.y + '-' + CUR_MONTH.m]; save({ imported: im });
  },
  go: d => go(d.a),
  closePost: () => set({ open: null }),
  copy: d => copyCaption(d.a),
  approve: d => approve(d.a, d.k),
  adjust: d => adjust(d.a, d.k),
  revise: d => revise(d.a),
  send: d => sendVersion(d.a),
  clearPending: d => { (S.pending[d.a] || []).forEach(pf => URL.revokeObjectURL(pf.url)); S.pending[d.a] = []; render(); },
  toggleHist: d => { S.hist[d.a] = !S.hist[d.a]; render(); },
  toggleFeed: () => set({ feedAll: !S.feedAll }),
  slide: d => { S.slide[d.a] = Number(d.i); render(); },
  expand: d => set({ lb: { a: d.a, n: Number(d.n), i: d.n == (rec(d.a).versions.slice(-1)[0] || {}).n ? (S.slide[d.a] || 0) : 0 } }),
  lbSlide: d => set({ lb: { ...S.lb, i: Number(d.i) } }),
  lbClose: () => set({ lb: null }),
};

function bind() {
  const app = document.getElementById('app');
  app.addEventListener('click', e => {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    if (t.dataset.action === 'lbClose' && t.classList.contains('lightbox') && e.target.closest('[data-stop]')) return;
    if (t.dataset.action === 'closePost' && t.classList.contains('modal') && e.target.closest('[data-stop]')) return;
    const fn = ACTIONS[t.dataset.action];
    if (fn) { e.preventDefault(); fn(t.dataset); }
  });
  app.addEventListener('submit', e => {
    const f = e.target;
    e.preventDefault();
    if (f.dataset.form === 'login') login();
    if (f.dataset.form === 'sendLink') sendLink();
    if (f.dataset.form === 'comment') addComment(f.dataset.a);
  });
  let importTimer = null;
  app.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.draft) S.drafts[t.dataset.draft] = t.value;
    if (t.dataset.adj) { S.adjDrafts[t.dataset.adj] = t.value; const cnt = document.getElementById(t.id.replace('adj-', 'adjc-')); if (cnt) cnt.textContent = t.value.trim().length + '/20 caracteres'; if (S.adjErr && t.value.trim().length >= 20) { S.adjErr = ''; render(); } }
    if (t.dataset.link) {
      const before = !!(S.linkDrafts[t.dataset.link] || '').trim();
      S.linkDrafts[t.dataset.link] = t.value;
      if (before !== !!t.value.trim()) render();
    }
    if (t.dataset.model === 'importText') {
      S.importText = t.value;
      clearTimeout(importTimer);
      importTimer = setTimeout(render, 400);
    }
    if (t.id === 'pin' || t.id === 'pin2') t.value = t.value.replace(/\D/g, '').slice(0, 4);
  });
  app.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.files) {
      const files = Array.from(t.files || []);
      if (!files.length) return;
      const add = files.map(file => ({ file, url: URL.createObjectURL(file), type: file.type, name: file.name }));
      S.pending[t.dataset.files] = [...(S.pending[t.dataset.files] || []), ...add];
      render();
    }
    if (t.id === 'importFile' && t.files && t.files[0]) readImportFile(t.files[0]);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (S.lb) set({ lb: null }); else if (S.open) set({ open: null }); } });
}

/* ---------- início ---------- */
(async function start() {
  S.booting = true;
  bind();
  render();
  try { await Storage.init(); }
  catch (e) { document.getElementById('app').innerHTML = '<p class="boot">Não foi possível carregar o calendário. Verifique a conexão e recarregue a página.</p>'; return; }
  if (Storage.cloud) {
    Storage.onAuth((ev, session) => {
      if (ev === 'SIGNED_IN' && session && (!S.session || S.session.email !== session.user.email)) cloudEnter(session.user.email);
      if (ev === 'SIGNED_OUT') set({ session: null, booting: false });
    });
    const email = await Storage.currentEmail();
    if (email) return cloudEnter(email);
    return set({ booting: false });
  }
  const d = Storage.load();
  let session = Storage.loadSession();
  if (session && session.id !== 'mkt' && !APPROVERS.some(x => x.id === session.id)) session = null;
  Object.assign(S, { flow: d.flow || {}, pins: d.pins || {}, attempts: d.attempts || {}, months: d.months || [], imported: d.imported || {}, hidden: d.hidden || [], session, onlyMine: false, booting: false });
  render();
})();
