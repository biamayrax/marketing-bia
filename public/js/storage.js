/* Camada de armazenamento, com dois modos (definidos em js/config.js):
   - ONLINE (Supabase): login por link no e-mail, dados e artes no servidor, atualização em tempo real.
   - DEMONSTRAÇÃO: tudo no navegador (localStorage + IndexedDB), login por PIN. Só para testar a interface. */

const Storage = (() => {
  const cloud = !!(typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL && SUPABASE_ANON_KEY);
  let sb = null;

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('Falha ao carregar ' + src));
      document.head.appendChild(s);
    });
  }
  async function init() {
    if (cloud) {
      await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, detectSessionInUrl: true } });
    } else {
      try { await loadScript('js/acessos.js'); await loadScript('js/conteudo.js'); }
      catch (e) { throw new Error('Site sem conexão com o Supabase. Configure SUPABASE_URL e SUPABASE_ANON_KEY.'); }
    }
  }
  const msg = e => (e && (e.message || e.error_description)) || 'erro desconhecido';

  /* ---------- online ---------- */
  async function currentEmail() {
    const { data } = await sb.auth.getSession();
    return data.session ? data.session.user.email : null;
  }
  function onAuth(fn) { sb.auth.onAuthStateChange((ev, session) => fn(ev, session)); }
  async function sendLink(email) {
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href.split('#')[0].split('?')[0] } });
    return error ? msg(error) : null;
  }
  async function signOut() { await sb.auth.signOut(); }
  async function me(email) {
    const { data, error } = await sb.from('people').select('pid,name,email').eq('email', email.toLowerCase()).eq('active', true).maybeSingle();
    if (error) throw new Error(msg(error));
    return data;
  }
  async function loadAll() {
    const [f, s] = await Promise.all([sb.from('flow').select('anchor,data,rev'), sb.from('settings').select('key,value')]);
    if (f.error) throw new Error(msg(f.error));
    if (s.error) throw new Error(msg(s.error));
    const settings = {};
    s.data.forEach(r => { settings[r.key] = r.value; });
    return { flow: f.data, settings };
  }
  async function loadFlow(anchor) {
    const { data } = await sb.from('flow').select('anchor,data,rev').eq('anchor', anchor).maybeSingle();
    return data;
  }
  async function saveFlow(anchor, data, rev) {
    if (!rev) {
      const r = await sb.from('flow').insert({ anchor, data, rev: 1 }).select('data,rev').single();
      if (r.error) return { ok: false, conflict: r.error.code === '23505', error: msg(r.error) };
      return { ok: true, rev: r.data.rev, data: r.data.data };
    }
    const r = await sb.from('flow').update({ data, rev: rev + 1 }).eq('anchor', anchor).eq('rev', rev).select('data,rev');
    if (r.error) return { ok: false, error: msg(r.error) };
    if (!r.data.length) return { ok: false, conflict: true };
    return { ok: true, rev: r.data[0].rev, data: r.data[0].data };
  }
  async function saveSetting(key, value) {
    const { error } = await sb.from('settings').upsert({ key, value });
    return error ? msg(error) : null;
  }
  function subscribe(onFlow, onSetting) {
    sb.channel('calendario')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flow' }, p => p.new && p.new.anchor && onFlow(p.new))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, p => p.new && p.new.key && onSetting(p.new))
      .subscribe();
  }

  /* ---------- demonstração ---------- */
  const OLD_KEY = 'franciosi-cal-review-v1';
  let dbPromise = null;
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(FLOW_KEY) || 'null');
      if (d) return d;
    } catch (e) {}
    const d = { flow: {}, pins: {}, attempts: {}, months: [], imported: {} };
    try {
      const old = JSON.parse(localStorage.getItem(OLD_KEY) || '{}');
      d.months = old.months || [];
      Object.entries(old.review || {}).forEach(([a, r]) => {
        d.flow[a] = { content: { status: 'pendente' }, versions: r.link ? [{ n: 1, link: r.link, by: 'Importado', at: '', status: 'pendente' }] : [], history: [], comments: r.comments || [] };
      });
    } catch (e) {}
    return d;
  }
  function save(data) {
    try { localStorage.setItem(FLOW_KEY, JSON.stringify(data)); return true; }
    catch (e) { alert('Não foi possível salvar: o armazenamento do navegador está cheio.'); return false; }
  }
  function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; } }
  function saveSession(s) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {} }
  function clearSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {} }
  function db() {
    if (!dbPromise) dbPromise = new Promise((res, rej) => {
      const r = indexedDB.open('franciosi-artes', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbPromise;
  }

  /* ---------- arquivos de arte (os dois modos) ---------- */
  async function putFile(key, blob) {
    if (cloud) {
      const { error } = await sb.storage.from('artes').upload(key, blob, { contentType: blob.type || undefined, upsert: false });
      if (error) throw new Error(msg(error));
      return;
    }
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction('files', 'readwrite');
      t.objectStore('files').put(blob, key);
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  }
  async function getFile(key) {
    if (cloud) {
      const { data, error } = await sb.storage.from('artes').download(key);
      return error ? null : data;
    }
    const d = await db();
    return new Promise(res => {
      const q = d.transaction('files').objectStore('files').get(key);
      q.onsuccess = () => res(q.result || null);
      q.onerror = () => res(null);
    });
  }

  return { cloud, init, currentEmail, onAuth, sendLink, signOut, me, loadAll, loadFlow, saveFlow, saveSetting, subscribe,
    load, save, loadSession, saveSession, clearSession, putFile, getFile };
})();
