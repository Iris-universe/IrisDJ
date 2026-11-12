// Pont entre l'interface et le moteur Rust (remplace le preload Electron) :
// window.dj (bibliothèque, sources, assistant) + exécution des outils d'Orbiz dans la page.
(() => {
  const T = window.__TAURI__;
  const invoke = T.core.invoke;

  window.dj = {
    lib: {
      list: () => invoke('lib_list'),
      addFiles: () => invoke('lib_add_files'),
      addFolder: () => invoke('lib_add_folder'),
      addPaths: (paths) => invoke('lib_add_paths', { paths }),
      remove: (id) => invoke('lib_remove', { id }),
      update: (id, patch) => invoke('lib_update', { id, patch }),
    },
    audius: { search: ({ query, genre, trending } = {}) => invoke('audius_search', { query: query ?? null, genre: genre ?? null, trending: !!trending }) },
    web: { search: (site, query) => invoke('web_search', { site, query }), openFolder: () => invoke('dl_open_folder') }, // SoundCloud / YouTube via yt-dlp
    onToast: (cb) => T.event.listen('toast', (e) => cb(e.payload)),
    openExternal: (url) => invoke('open_external', { url }),
    // Envoie une question au chat d'Orbiz (send=false : la pré-remplit seulement).
    ask: (text, send = true) => invoke('assistant_ask', { text, send }),
  };

  // ---------------------------------------------------------------- outils génériques (comme iris-link/app-host.js)
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const label = (el) => (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  let items = [];
  const UI = {
    list() {
      items = [...document.querySelectorAll('a[href],button,input,textarea,select,summary,[role=button],[onclick],[tabindex]:not([tabindex="-1"])')].filter(visible);
      return items.map((el, i) => ({ i, tag: el.tagName.toLowerCase(), type: el.type || undefined, text: label(el), id: el.id || undefined,
        pressed: el.getAttribute('aria-pressed') || undefined, disabled: el.disabled || undefined }));
    },
    find({ index, selector, text }) {
      if (index != null) { if (!items.length) this.list(); return items[index]; }
      if (selector) return document.querySelector(selector);
      if (text) { const t = text.toLowerCase(); this.list();
        return items.find((el) => label(el).toLowerCase() === t) || items.find((el) => label(el).toLowerCase().includes(t)); }
    },
  };
  const TOOLS = {
    get_screen: (a) => ({ title: document.title, text: document.body.innerText.replace(/\n{3,}/g, '\n\n').slice(0, Number(a.max_chars) || 8000) }),
    list_elements: () => UI.list(),
    click: (a) => { const el = UI.find(a); if (!el) return { error: 'Élément introuvable' };
      el.scrollIntoView({ block: 'center' }); el.click(); return { ok: true, clicked: label(el) }; },
    type_text: (a) => { const el = UI.find(a); if (!el) return { error: 'Champ introuvable' };
      el.focus(); el.value = (a.clear !== false ? '' : el.value) + (a.text || ''); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      if (a.submit) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return { ok: true }; },
    press_key: (a) => {
      const key = a.key || 'Enter', target = document.activeElement || document.body;
      for (const type of ['keydown', 'keyup']) target.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }));
      return { ok: true };
    },
    scroll: (a) => { const d = a.direction || 'down';
      const y = d === 'top' ? 0 : d === 'bottom' ? document.body.scrollHeight : scrollY + (d === 'up' ? -1 : 1) * innerHeight * 0.8;
      scrollTo({ top: y }); return { scrollY: Math.round(scrollY) }; },
    execute_javascript: async (a) => (0, eval)(a.code || 'undefined'),
  };

  T.event.listen('agent-call', async (e) => {
    const { id, kind, tool, args } = e.payload;
    let result;
    try {
      if (kind === 'page') {
        // l'interface peut être encore en train de démarrer
        for (let i = 0; i < 100 && !window.irisAgent; i++) await new Promise((r) => setTimeout(r, 100));
        result = await window.irisAgent[tool](args || {});
      } else result = await TOOLS[tool](args || {});
      try { result = JSON.parse(JSON.stringify(result ?? null)); } catch { result = String(result); }
    } catch (err) { result = { error: String(err?.message || err) }; }
    invoke('agent_reply', { id, result });
  });

  // touches de la fenêtre
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F5') { e.preventDefault(); location.reload(); }
    else if (e.key === 'F11') { e.preventDefault(); invoke('win_action', { action: 'fullscreen' }); }
    else if (e.key === 'F12') { e.preventDefault(); invoke('win_action', { action: 'devtools' }); }
  }, true);
  // pas de menu contextuel du navigateur (le clic droit efface les hot cues)
  window.addEventListener('contextmenu', (e) => { if (!e.target.closest('input, textarea')) e.preventDefault(); });
  // liens externes dans le navigateur
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="http"]');
    if (a) { e.preventDefault(); window.dj.openExternal(a.href); }
  });
})();
