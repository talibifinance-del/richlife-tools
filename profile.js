/* RichLife · profile.js — the unified "one couple, one link" layer for the lida suite.
   Drop-in: <script src="/profile.js"></script> in <head>, before each tool's own script.
   It never touches a calculator's internal logic. It works purely at the localStorage +
   worker layer, so every tool stays exactly as it is.

   Two URL modes:
   · plain  (no ?u)  → normal tool. On the checklist ("home") it adds ONE button that mints
                       a couple profile link (?u=<id>) covering the whole suite.
   · profile (?u=id) → seeds this tool's saved slice from the shared profile blob BEFORE the
                       tool boots, pushes every later edit back into that same one blob,
                       shows a name banner, hides the per-tool share, and carries ?u across
                       all internal links so the couple stays inside their profile.

   Profile blob (one server-assigned id):  { name, slugs: { <slug>: <that tool's localStorage string> } }
   We store the tool's raw localStorage value verbatim per slug — format-agnostic, because
   seeding it back is exactly what the tool reads on boot.
*/
(function () {
  var API = 'https://richlife-share.tali-bi-finance.workers.dev';

  // slug (last path segment) → that tool's localStorage state key. Verified against live code 30.7.
  var KEYS = {
    'checklist':            'rl_checklist_v3',
    'maternity-allowance':  'richlife-maternity-v1',
    'maternity-leave-plan': 'richlife-leaveplan-v1',
    'monthly-baby-cost':    'richlife-monthlybaby-v1',
    'refund-tracker':       'richlife-refunds-v1',
    'shopping-list':        'richlife-shopping-v3',
    'child-savings':        'richlife-childsaving-v1',
    'ribit':                'richlife-ribit-v1'
  };

  var slug = (location.pathname.replace(/\/+$/, '').split('/').pop() || 'index');
  var SKEY = KEYS[slug] || null;               // null on the hub (index) — no state to seed
  var isChecklist = (slug === 'checklist');
  var isHub = (slug === 'index' || slug === 'lida');

  var u = new URLSearchParams(location.search).get('u');
  var origSet = localStorage.setItem.bind(localStorage);
  var CACHE = u ? ('rlprofblob:' + u) : null;

  function getCache() { try { return JSON.parse(sessionStorage.getItem(CACHE) || 'null'); } catch (e) { return null; } }
  function setCache(b) { try { sessionStorage.setItem(CACHE, JSON.stringify(b)); } catch (e) {} }
  function checklistName(str) { try { var o = JSON.parse(str); if (o && typeof o.name === 'string') return o.name.trim(); } catch (e) {} return ''; }
  function homeLink(id) { return location.origin + '/lida/checklist/?u=' + id; }

  /* ----------------------------------------------------------------------
     PLAIN MODE — no ?u. Only the checklist gets the "mint one link" button.
     ---------------------------------------------------------------------- */
  if (!u) {
    if (!isChecklist) return;                  // every other tool behaves normally
    if (/[#&]p=/.test(location.hash)) return;  // opened via an existing live link → leave the tool's own share untouched
    ready(function () {
      var host = document.getElementById('shareBtn');
      if (!host) return;
      // On the checklist, "share" means "share the couple's whole suite" → replace the
      // per-tool link block with the profile mint button.
      hideEls(['actLink']);
      host.textContent = '🔗 ליצירת קישור אחד לכל הזוג';
      host.onclick = function () {
        host.disabled = true;
        var cs = safeGet('rl_checklist_v3');
        var blob = { name: checklistName(cs || ''), slugs: { checklist: (cs != null ? cs : '') } };
        fetch(API, { method: 'POST', body: JSON.stringify(blob) })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) {
            if (!j || !j.id) { host.disabled = false; host.textContent = '🔗 נסו שוב'; return; }
            try { sessionStorage.setItem('rlprofblob:' + j.id, JSON.stringify(blob)); } catch (e) {}
            location.href = homeLink(j.id);    // enter profile mode on the home page
          })
          .catch(function () { host.disabled = false; host.textContent = '🔗 נסו שוב'; });
      };
    });
    return;
  }

  /* ----------------------------------------------------------------------
     PROFILE MODE — ?u=id present.
     ---------------------------------------------------------------------- */
  var blob = getCache();

  // --- SEED this tool's slice before it boots -------------------------------
  if (SKEY) {
    if (blob) {
      // blob already cached this session → seed synchronously, no reload, no flash.
      if (blob.slugs && blob.slugs[slug] != null) origSet(SKEY, blob.slugs[slug]);
    } else {
      // first page hit of this profile in this tab: fetch, seed, reload once (guarded).
      document.documentElement.style.visibility = 'hidden';
      fetch(API + '/?id=' + encodeURIComponent(u))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (b) {
          b = b && typeof b === 'object' ? b : {};
          if (!b.slugs) b.slugs = {};
          setCache(b);
          if (b.slugs[slug] != null) origSet(SKEY, b.slugs[slug]);
          location.reload();
        })
        .catch(function () { setCache({ slugs: {} }); location.reload(); });
      return;                                  // stop; re-runs after reload with cache present
    }
  } else if (!blob) {
    // hub (no state to seed) — just fetch the blob for the banner name; no reload needed.
    fetch(API + '/?id=' + encodeURIComponent(u))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (b) { blob = (b && typeof b === 'object') ? b : { slugs: {} }; setCache(blob); paintName(); })
      .catch(function () {});
  }

  // --- CAPTURE: mirror every localStorage write for this tool into the one blob ---
  var pushT = null;
  function schedulePush() {
    clearTimeout(pushT);
    pushT = setTimeout(function () {
      if (!blob) return;
      fetch(API + '/?id=' + encodeURIComponent(u), { method: 'POST', body: JSON.stringify(blob) })
        .then(function (r) { paintSaved(r && r.ok ? 'saved' : ''); })
        .catch(function () { paintSaved(''); });
    }, 1200);
  }
  if (SKEY) {
    localStorage.setItem = function (k, v) {
      origSet(k, v);
      if (k === SKEY) {
        if (!blob) blob = getCache() || { slugs: {} };
        if (!blob.slugs) blob.slugs = {};
        blob.slugs[slug] = v;
        if (isChecklist) { var nm = checklistName(v); if (nm && nm !== blob.name) { blob.name = nm; paintName(); } }
        setCache(blob);
        paintSaved('saving');
        schedulePush();
      }
    };
  }

  // --- subtle auto-save cue in the banner: "שומר…" → "נשמר ✓" (fades) ---
  var savedT = null;
  function paintSaved(state) {
    var el = document.getElementById('rlProfSaved');
    if (!el) return;
    clearTimeout(savedT);
    if (state === 'saving') { el.textContent = 'שומר…'; el.style.opacity = '1'; }
    else if (state === 'saved') { el.textContent = 'נשמר ✓'; el.style.opacity = '1'; savedT = setTimeout(function () { el.style.opacity = '0'; }, 1900); }
    else { el.style.opacity = '0'; }
  }

  // --- UI: banner + hide per-tool share + carry ?u across internal links ---
  ready(function () {
    hideEls(['shareBtn', 'actLink', 'liveBadge']);
    injectBanner();
    rewriteLinks();
  });

  function injectBanner() {
    if (document.getElementById('rlProfBar')) return;
    var bar = document.createElement('div');
    bar.id = 'rlProfBar';
    bar.setAttribute('dir', 'rtl');
    bar.style.cssText = 'position:sticky;top:0;z-index:9999;background:#2f5d4f;color:#fff;' +
      'font-family:Heebo,system-ui,sans-serif;font-size:14px;line-height:1.4;' +
      'display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;' +
      'padding:9px 16px;box-shadow:0 2px 10px rgba(31,42,37,.18)';
    var left = document.createElement('span');
    left.innerHTML = '👶 <b id="rlProfName"></b><span style="opacity:.85"> · מוכנים כלכלית ללידה</span>';
    var right = document.createElement('span');
    right.style.cssText = 'display:flex;align-items:center;gap:10px';
    if (SKEY) {                                  // auto-save cue (not on the hub, which has no state)
      var saved = document.createElement('span');
      saved.id = 'rlProfSaved';
      saved.style.cssText = 'color:#cdeadd;font-weight:700;font-size:12.5px;white-space:nowrap;' +
        'opacity:0;transition:opacity .3s;min-width:52px;text-align:center';
      right.appendChild(saved);
    }
    if (!isChecklist) {
      var back = document.createElement('a');
      back.href = homeLink(u);
      back.textContent = '← לצ׳ק-ליסט';
      back.style.cssText = 'color:#dff0e8;text-decoration:none;font-weight:700;white-space:nowrap';
      right.appendChild(back);
    }
    var share = document.createElement('button');
    share.id = 'rlProfShare';
    share.type = 'button';
    share.textContent = '🔗 הקישור לזוג';
    share.style.cssText = 'background:#fff;color:#2f5d4f;border:0;border-radius:999px;font-weight:800;' +
      'font-size:13px;padding:7px 14px;cursor:pointer;white-space:nowrap;font-family:inherit';
    share.onclick = function () {
      var link = homeLink(u);
      var done = function () { var o = share.textContent; share.textContent = '✓ הקישור הועתק'; setTimeout(function () { share.textContent = o; }, 1700); };
      try { navigator.clipboard.writeText(link).then(done, done); } catch (e) { done(); }
    };
    right.appendChild(share);
    bar.appendChild(left);
    bar.appendChild(right);
    if (document.body.firstChild) document.body.insertBefore(bar, document.body.firstChild);
    else document.body.appendChild(bar);
    paintName();
  }

  function paintName() {
    var el = document.getElementById('rlProfName');
    if (!el) return;
    var nm = (blob && blob.name) ? String(blob.name).trim() : '';
    el.textContent = nm || 'הזוג שלכם';
  }

  function rewriteLinks() {
    var as = document.querySelectorAll('a[href]');
    for (var i = 0; i < as.length; i++) {
      var a = as[i], href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#') continue;
      var url;
      try { url = new URL(href, location.href); } catch (e) { continue; }
      if (url.origin !== location.origin) continue;                 // leave external (ליווי CTA etc)
      if (!/^\/(lida|ribit)(\/|$)/.test(url.pathname)) continue;    // only same-suite pages
      if (url.searchParams.get('u') === u) continue;
      url.searchParams.set('u', u);
      a.setAttribute('href', url.pathname + url.search + url.hash);
    }
  }

  // --- tiny helpers ---
  function ready(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function hideEls(ids) {
    for (var i = 0; i < ids.length; i++) { var el = document.getElementById(ids[i]); if (el) el.style.display = 'none'; }
  }
})();
