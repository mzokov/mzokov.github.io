/* Общий аккаунт и кошелёк монет для всех игр на mzokov.github.io.
   Данные хранятся в браузере (localStorage) под ключом hub.v1. Игры подключают этот файл
   и работают через объект window.Hub. */
(function () {
  'use strict';
  if (window.Hub) return;

  var KEY = 'hub.v1';
  var GKEY = 'hub.guest.v1';
  var LEG_SNAKE = 'snake.v2';
  var LEG_TETRIS = 'tetris.accounts.v1';
  var MAX_ACC = 10;
  var NAME_RE = /^[\p{L}\p{N}_\-. ]{2,16}$/u;
  var W_COIN = ['монета', 'монеты', 'монет'];

  var state = { v: 1, accounts: [], session: null, migrated: [] };
  var guest = { coins: 0, earned: 0 };
  var guestGames = {};
  var storageOk = true;
  var handlers = [];
  var bars = [];
  var fails = 0, lockUntil = 0, offered = false;

  /* ---------- мелкие помощники ---------- */
  function plural(n, f) {
    var a = n % 10, b = n % 100;
    if (b >= 11 && b <= 14) return f[2];
    if (a === 1) return f[0];
    if (a >= 2 && a <= 4) return f[1];
    return f[2];
  }
  function normName(n) { return String(n == null ? '' : n).replace(/\s+/g, ' ').trim(); }
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function h(tag, props, kids) {
    var e = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
        else if (v !== false && v !== null && v !== undefined) e.setAttribute(k, v === true ? '' : v);
      });
    }
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }
  function on(type, fn) { handlers.push({ t: type, f: fn }); }
  function emit(type, detail) {
    handlers.slice().forEach(function (x) {
      if (x.t === type) { try { x.f(detail || {}); } catch (e) { /* ошибка в обработчике игры не должна ломать общий модуль */ } }
    });
    renderBars();
  }

  /* ---------- хранение ---------- */
  function normAccount(a) {
    if (!a || typeof a !== 'object' || typeof a.id !== 'string' || typeof a.name !== 'string') return null;
    var auth = Array.isArray(a.auth) ? a.auth.filter(function (x) {
      return x && typeof x.s === 'string' && typeof x.h === 'string';
    }).map(function (x) { return { s: x.s, h: x.h }; }) : [];
    return {
      id: a.id,
      name: normName(a.name).slice(0, 16) || 'Игрок',
      auth: auth,
      coins: Math.max(0, Math.floor(+a.coins || 0)),
      earned: Math.max(0, Math.floor(+a.earned || 0)),
      created: +a.created || Date.now(),
      games: (a.games && typeof a.games === 'object') ? a.games : {}
    };
  }
  function load() {
    var s = { v: 1, accounts: [], session: null, migrated: [] };
    var d = null;
    try { d = JSON.parse(localStorage.getItem(KEY)); } catch (e) { d = null; }
    if (d && Array.isArray(d.accounts)) {
      s.accounts = d.accounts.map(normAccount).filter(Boolean);
      s.session = typeof d.session === 'string' ? d.session : null;
      s.migrated = Array.isArray(d.migrated) ? d.migrated.filter(function (x) { return typeof x === 'string'; }) : [];
    }
    if (s.session && !s.accounts.some(function (a) { return a.id === s.session; })) s.session = null;
    return s;
  }
  function loadGuest() {
    try {
      var g = JSON.parse(localStorage.getItem(GKEY));
      if (g && typeof g === 'object') {
        return { coins: Math.max(0, Math.floor(+g.coins || 0)), earned: Math.max(0, Math.floor(+g.earned || 0)) };
      }
    } catch (e) { /* нет гостевых данных */ }
    return { coins: 0, earned: 0 };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { storageOk = false; }
  }
  function saveGuest() {
    try { localStorage.setItem(GKEY, JSON.stringify(guest)); } catch (e) { /* гостевые монеты не критичны */ }
  }
  /* Записывает, читает обратно и сверяет: true только если данные действительно лежат в хранилище */
  function saveNow() {
    try {
      var json = JSON.stringify(state);
      localStorage.setItem(KEY, json);
      storageOk = localStorage.getItem(KEY) === json;
    } catch (e) { storageOk = false; }
    return storageOk;
  }

  function user() {
    if (!state.session) return null;
    for (var i = 0; i < state.accounts.length; i++) if (state.accounts[i].id === state.session) return state.accounts[i];
    return null;
  }
  function findByName(name, exceptId) {
    var low = normName(name).toLowerCase();
    for (var i = 0; i < state.accounts.length; i++) {
      var a = state.accounts[i];
      if (a.id !== exceptId && a.name.toLowerCase() === low) return a;
    }
    return null;
  }

  /* ---------- пароли ---------- */
  function fallbackHash(s) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  }
  /* Хеш считается как SHA-256 от «соль:пароль», так же, как в старых версиях Змейки и Тетриса,
     поэтому прежние PIN-коды и пароли продолжают работать после переноса. */
  function hashPw(pw, salt) {
    var text = salt + ':' + pw;
    try {
      if (window.crypto && crypto.subtle) {
        return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
          return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
        });
      }
    } catch (e) { /* ниже запасной вариант */ }
    return Promise.resolve(fallbackHash(text));
  }
  function makeSalt() {
    try {
      var a = new Uint8Array(8);
      crypto.getRandomValues(a);
      return Array.prototype.map.call(a, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    } catch (e) { return Math.random().toString(16).slice(2, 12); }
  }

  /* ---------- перенос старых данных и стартовые игроки ---------- */
  function addAuth(acc, s, hh) {
    for (var i = 0; i < acc.auth.length; i++) if (acc.auth[i].s === s && acc.auth[i].h === hh) return;
    acc.auth.push({ s: s, h: hh });
  }
  function migrate() {
    if (state.migrated.indexOf('legacy-1') >= 0) return false;
    state.migrated.push('legacy-1');
    var sn = null, te = null;
    try { sn = JSON.parse(localStorage.getItem(LEG_SNAKE)); } catch (e) { sn = null; }
    try { te = JSON.parse(localStorage.getItem(LEG_TETRIS)); } catch (e) { te = null; }

    if (sn && Array.isArray(sn.accounts)) {
      sn.accounts.forEach(function (a) {
        if (!a || typeof a.name !== 'string' || !normName(a.name)) return;
        var acc = findByName(a.name);
        if (!acc) {
          acc = normAccount({ id: typeof a.id === 'string' ? a.id : newId(), name: a.name });
          state.accounts.push(acc);
        }
        acc.coins += Math.max(0, Math.floor(+a.coins || 0));
        acc.earned += Math.max(0, Math.floor(+a.earned || 0));
        if (a.pin && typeof a.pin.s === 'string' && typeof a.pin.h === 'string') addAuth(acc, a.pin.s, a.pin.h);
        var g = {};
        ['color', 'speed', 'owned', 'results', 'buys', 'games', 'apples', 'st', 'ach', 'bonus', 'daily'].forEach(function (k) {
          if (a[k] !== undefined) g[k] = a[k];
        });
        g.earned = Math.max(0, Math.floor(+a.earned || 0));
        acc.games.snake = g;
      });
    }
    if (te && typeof te === 'object') {
      Object.keys(te).forEach(function (key) {
        var t = te[key];
        if (!t || typeof t.nick !== 'string' || !normName(t.nick)) return;
        var acc = findByName(t.nick);
        if (!acc) {
          acc = normAccount({ id: newId(), name: t.nick, created: t.created });
          state.accounts.push(acc);
        }
        if (typeof t.salt === 'string' && typeof t.hash === 'string') addAuth(acc, t.salt, t.hash);
        acc.games.tetris = {
          best: (t.best && typeof t.best === 'object') ? t.best : {},
          games: Array.isArray(t.games) ? t.games : []
        };
      });
    }
    return true;
  }

  /* Даниэла и Папа создаются сразу. У Даниэлы без старых данных будет 240 монет и тигровая змейка,
     пароль она задаст при первом входе. У Папы пароль 1234. */
  function runInit() {
    var changed = migrate();
    if (state.migrated.indexOf('seed-daniela-1') < 0) {
      state.migrated.push('seed-daniela-1');
      changed = true;
      if (!findByName('Даниэла')) {
        var d = normAccount({ id: newId(), name: 'Даниэла' });
        d.coins = 240;
        d.earned = 240;
        d.games.snake = { color: 'tiger', owned: ['tiger'] };
        state.accounts.push(d);
      }
    }
    var p = Promise.resolve();
    if (state.migrated.indexOf('seed-papa-1') < 0) {
      state.migrated.push('seed-papa-1');
      changed = true;
      if (!findByName('Папа')) {
        var salt = makeSalt();
        p = hashPw('1234', salt).then(function (hh) {
          var a = normAccount({ id: newId(), name: 'Папа' });
          a.auth = [{ s: salt, h: hh }];
          state.accounts.push(a);
        });
      }
    }
    return p.then(function () { if (changed) save(); });
  }

  /* ---------- вход, регистрация, выход ---------- */
  function finishLogin(acc) {
    state.session = acc.id;
    var merged = 0;
    if (guest.coins > 0) {
      merged = guest.coins;
      acc.coins += guest.coins;
      acc.earned += guest.earned;
      guest = { coins: 0, earned: 0 };
      saveGuest();
    }
    guestGames = {};
    save();
    emit('session', { reason: 'login', merged: merged });
    if (merged > 0) toast('К аккаунту добавлено ' + merged + ' ' + plural(merged, W_COIN));
    return { ok: true, merged: merged };
  }
  function checkName(name, exceptId) {
    if (!NAME_RE.test(name)) return 'Имя: от 2 до 16 символов, буквы, цифры, пробел, дефис, точка или подчёркивание.';
    if (findByName(name, exceptId)) return 'Игрок с таким именем уже есть.';
    return '';
  }
  function createAccount(name, pw) {
    name = normName(name);
    var bad = checkName(name);
    if (bad) return Promise.resolve({ ok: false, error: bad });
    if (pw.length < 4) return Promise.resolve({ ok: false, error: 'Пароль должен быть не короче 4 символов.' });
    if (state.accounts.length >= MAX_ACC) return Promise.resolve({ ok: false, error: 'Больше десяти игроков создать нельзя.' });
    var salt = makeSalt();
    return hashPw(pw, salt).then(function (hh) {
      if (findByName(name)) return { ok: false, error: 'Игрок с таким именем уже есть.' };
      var acc = normAccount({ id: newId(), name: name });
      acc.auth = [{ s: salt, h: hh }];
      state.accounts.push(acc);
      return finishLogin(acc);
    });
  }
  function login(id, pw) {
    var acc = null;
    state.accounts.forEach(function (a) { if (a.id === id) acc = a; });
    if (!acc) return Promise.resolve({ ok: false, error: 'Игрок не найден.' });
    var wait = Math.ceil((lockUntil - Date.now()) / 1000);
    if (wait > 0) return Promise.resolve({ ok: false, error: 'Слишком много попыток. Подожди ' + wait + ' с.' });
    return Promise.all(acc.auth.map(function (a) {
      return hashPw(pw, a.s).then(function (hh) { return hh === a.h; });
    })).then(function (res) {
      if (res.some(Boolean)) { fails = 0; return finishLogin(acc); }
      fails++;
      if (fails >= 5) { fails = 0; lockUntil = Date.now() + 30000; return { ok: false, error: 'Слишком много попыток. Подожди 30 секунд.' }; }
      return { ok: false, error: 'Неверный пароль.' };
    });
  }
  function setPassword(id, pw) {
    var acc = null;
    state.accounts.forEach(function (a) { if (a.id === id) acc = a; });
    if (!acc || acc.auth.length) return Promise.resolve({ ok: false, error: 'Пароль уже задан.' });
    if (pw.length < 4) return Promise.resolve({ ok: false, error: 'Пароль должен быть не короче 4 символов.' });
    var salt = makeSalt();
    return hashPw(pw, salt).then(function (hh) {
      acc.auth = [{ s: salt, h: hh }];
      return finishLogin(acc);
    });
  }
  function logout() {
    state.session = null;
    guestGames = {};
    save();
    emit('session', { reason: 'logout' });
  }
  function rename(name) {
    var u = user();
    if (!u) return { ok: false, error: 'Сначала войди в аккаунт.' };
    name = normName(name);
    var bad = checkName(name, u.id);
    if (bad) return { ok: false, error: bad };
    u.name = name;
    save();
    emit('session', { reason: 'rename' });
    return { ok: true };
  }

  /* ---------- монеты и данные игр ---------- */
  function coins() { var u = user(); return u ? u.coins : guest.coins; }
  function earned() { var u = user(); return u ? u.earned : guest.earned; }
  function addCoins(n) {
    n = Math.floor(+n || 0);
    if (n <= 0) return;
    var u = user();
    if (u) { u.coins += n; u.earned += n; save(); }
    else { guest.coins += n; guest.earned += n; saveGuest(); }
    emit('coins', { amount: n });
  }
  function spend(n) {
    n = Math.floor(+n || 0);
    var u = user();
    if (!u) { openLogin('Чтобы покупать, войди в аккаунт. Монеты, заработанные гостем, перейдут в него.'); return false; }
    if (n <= 0 || u.coins < n) return false;
    u.coins -= n;
    save();
    emit('coins', { amount: -n });
    return true;
  }
  function gameData(game, defaults) {
    var u = user();
    var holder = u ? u.games : guestGames;
    if (!holder[game] || typeof holder[game] !== 'object') holder[game] = {};
    var g = holder[game];
    Object.keys(defaults || {}).forEach(function (k) { if (g[k] === undefined) g[k] = clone(defaults[k]); });
    return g;
  }

  /* ---------- оформление ---------- */
  var CSS = [
    '.hub-bar,.hub-ov,.hub-toast{--h-bg:#fff;--h-fg:#161b22;--h-mut:#5a6572;--h-line:#d5dae1;--h-soft:#eceff3;--h-acc:#c8281f;--h-on:#fff;--h-coin:#f2b705;--h-coine:#a87800;--h-ok:#1b7f45;font-family:Manrope,system-ui,-apple-system,"Segoe UI",sans-serif;font-size:15px;line-height:1.4;color:var(--h-fg);box-sizing:border-box}',
    '@media (prefers-color-scheme:dark){.hub-bar,.hub-ov,.hub-toast{--h-bg:#1b1f26;--h-fg:#e9edf2;--h-mut:#9aa4b1;--h-line:#2b313b;--h-soft:#252b34;--h-acc:#f0675c;--h-on:#1c0a08;--h-coin:#ffc933;--h-coine:#c8901a;--h-ok:#5cc56a}}',
    '.hub-bar *,.hub-ov *{box-sizing:border-box}',
    '.hub-bar{display:inline-flex;align-items:center;gap:10px;flex-wrap:wrap}',
    '.hub-wallet{display:inline-flex;align-items:center;gap:7px;min-height:40px;padding:6px 14px;border:1px solid var(--h-line);border-radius:999px;background:var(--h-bg);font-variant-numeric:tabular-nums}',
    '.hub-coin{width:14px;height:14px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffe98f,var(--h-coin));border:1.5px solid var(--h-coine)}',
    '.hub-guest{color:var(--h-mut);font-size:14px}',
    '.hub-btn{font:inherit;font-weight:700;min-height:40px;padding:8px 16px;border-radius:10px;border:1px solid var(--h-line);background:var(--h-bg);color:var(--h-fg);cursor:pointer}',
    '.hub-btn:hover{background:var(--h-soft)}',
    '.hub-primary{background:var(--h-acc);border-color:transparent;color:var(--h-on)}',
    '.hub-primary:hover{background:var(--h-acc);filter:brightness(1.08)}',
    '.hub-ghost{background:transparent}',
    '.hub-who{display:inline-flex;align-items:center;gap:8px;padding:4px 14px 4px 5px;border-radius:999px}',
    '.hub-ava{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--h-acc);color:var(--h-on);font-weight:700;font-size:14px;flex:none}',
    '.hub-name{max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.hub-btn:focus-visible,.hub-acc:focus-visible,.hub-icon:focus-visible,.hub-field input:focus-visible{outline:2px solid var(--h-fg);outline-offset:2px}',
    '.hub-ov{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(10,14,20,.55)}',
    '.hub-card{width:100%;max-width:380px;max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);overflow-y:auto;background:var(--h-bg);border:1px solid var(--h-line);border-radius:18px;padding:20px;display:flex;flex-direction:column;gap:12px}',
    '.hub-card h2{font-family:Unbounded,"Arial Black",system-ui,sans-serif;font-weight:500;font-size:18px;line-height:1.25;margin:0;overflow-wrap:anywhere}',
    '.hub-note{margin:0;color:var(--h-mut);font-size:14px}',
    '.hub-reason{color:var(--h-fg)}',
    '.hub-err{margin:0;color:var(--h-acc);font-size:13px;font-weight:700;min-height:1.2em}',
    '.hub-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}',
    '.hub-acc{width:100%;font:inherit;text-align:left;display:flex;align-items:center;gap:12px;padding:8px 12px;border:1px solid var(--h-line);border-radius:12px;background:var(--h-bg);color:var(--h-fg);cursor:pointer}',
    '.hub-acc:hover{background:var(--h-soft)}',
    '.hub-accname{display:flex;flex-direction:column;min-width:0}',
    '.hub-accname b{overflow-wrap:anywhere}',
    '.hub-accname small{color:var(--h-mut);font-size:12.5px}',
    '.hub-form{display:flex;flex-direction:column;gap:12px}',
    '.hub-field{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--h-mut);font-weight:700}',
    '.hub-field input{font:inherit;font-weight:400;min-height:44px;padding:8px 12px;border:1px solid var(--h-line);border-radius:10px;background:var(--h-soft);color:var(--h-fg);width:100%}',
    '.hub-row{display:flex;gap:10px;flex-wrap:wrap}',
    '.hub-row .hub-btn{flex:1 1 0;min-width:110px}',
    '.hub-money{display:flex;align-items:center;gap:8px;font-weight:700}',
    '.hub-rename{display:flex;gap:8px;align-items:center}',
    '.hub-rename input{flex:1 1 auto;min-width:0;font:inherit;min-height:40px;padding:6px 10px;border:1px solid var(--h-line);border-radius:10px;background:var(--h-soft);color:var(--h-fg)}',
    '.hub-icon{display:inline-grid;place-items:center;width:40px;height:40px;flex:none;border:1px solid var(--h-line);border-radius:10px;background:var(--h-bg);color:var(--h-fg);cursor:pointer;padding:0}',
    '.hub-icon.ok{background:var(--h-acc);color:var(--h-on);border-color:transparent}',
    '.hub-icon svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}',
    '.hub-toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:1100;max-width:calc(100vw - 32px);padding:10px 18px;border-radius:999px;background:var(--h-fg);color:var(--h-bg);font-weight:700;font-size:14px;text-align:center}',
    '[hidden].hub-toast{display:none}'
  ].join('\n');
  function injectCss() {
    if (document.getElementById('hub-style')) return;
    var st = document.createElement('style');
    st.id = 'hub-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* ---------- панель аккаунта в шапке игры ---------- */
  function renderBar(el) {
    var opts = el._hubOpts || {};
    el.textContent = '';
    el.classList.add('hub-bar');
    var u = user();
    var n = coins();
    if (opts.wallet !== false) el.appendChild(h('span', { class: 'hub-wallet', title: 'Монеты общие для всех игр' }, [
      h('span', { class: 'hub-coin', 'aria-hidden': 'true' }),
      h('b', { text: String(n) }),
      h('span', { class: 'hub-sr', style: 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)', text: plural(n, W_COIN) })
    ]));
    if (u) {
      el.appendChild(h('button', { class: 'hub-btn hub-who', type: 'button', title: 'Профиль', onclick: openProfile }, [
        h('span', { class: 'hub-ava', 'aria-hidden': 'true', text: u.name.charAt(0).toUpperCase() }),
        h('span', { class: 'hub-name', text: u.name })
      ]));
    } else {
      el.appendChild(h('span', { class: 'hub-guest', text: 'Гость' }));
      el.appendChild(h('button', { class: 'hub-btn hub-primary', type: 'button', onclick: function () { openLogin(); } }, ['Войти']));
    }
  }
  function renderBars() { bars.forEach(renderBar); }
  function mountBar(el, opts) {
    if (!el || bars.indexOf(el) >= 0) return;
    el._hubOpts = opts || {};
    injectCss();
    bars.push(el);
    renderBar(el);
  }

  var toastTimer = null;
  function toast(msg) {
    injectCss();
    var t = document.getElementById('hub-toast');
    if (!t) {
      t = h('div', { class: 'hub-toast', id: 'hub-toast', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3500);
  }

  /* ---------- окно входа ---------- */
  var modal = null;
  function focusables(root) {
    return Array.prototype.slice.call(root.querySelectorAll('button,input,[href]')).filter(function (x) { return !x.disabled && x.offsetParent !== null; });
  }
  function closeModal() {
    if (!modal) return;
    document.removeEventListener('keydown', modal.key, true);
    modal.root.parentNode.removeChild(modal.root);
    var prev = modal.prev;
    modal = null;
    if (prev && prev.focus) { try { prev.focus(); } catch (e) { /* элемент мог исчезнуть */ } }
    emit('modal', { open: false });
  }
  function openModal(title, build) {
    injectCss();
    if (!modal) {
      var prev = document.activeElement;
      var titleEl = h('h2', { id: 'hub-title' });
      var body = h('form', { class: 'hub-form', novalidate: true });
      var card = h('div', { class: 'hub-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'hub-title' }, [titleEl, body]);
      var root = h('div', { class: 'hub-ov' }, [card]);
      root.addEventListener('mousedown', function (e) { if (e.target === root) closeModal(); });
      var key = function (e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeModal(); return; }
        if (e.key === 'Tab') {
          var f = focusables(card);
          if (!f.length) return;
          var first = f[0], last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      };
      document.addEventListener('keydown', key, true);
      document.body.appendChild(root);
      modal = { root: root, titleEl: titleEl, body: body, card: card, key: key, prev: prev };
      emit('modal', { open: true });
    }
    modal.titleEl.textContent = title;
    modal.body.textContent = '';
    modal.body.onsubmit = function (e) { e.preventDefault(); };
    build(modal.body);
    var f = focusables(modal.card);
    var inp = modal.card.querySelector('input');
    (inp || f[0] || modal.card).focus();
  }
  function field(label, input) { return h('label', { class: 'hub-field' }, [h('span', { text: label }), input]); }
  function avatar(name) { return h('span', { class: 'hub-ava', 'aria-hidden': 'true', text: name.charAt(0).toUpperCase() }); }

  function viewPick(reason) {
    openModal('Кто играет?', function (body) {
      if (reason) body.appendChild(h('p', { class: 'hub-note hub-reason', text: reason }));
      var ul = h('ul', { class: 'hub-list' });
      state.accounts.forEach(function (a) {
        var sub = a.auth.length ? a.coins + ' ' + plural(a.coins, W_COIN) : 'пароль ещё не задан';
        ul.appendChild(h('li', null, [h('button', { class: 'hub-acc', type: 'button', onclick: function () {
          if (a.auth.length) viewPassword(a, reason); else viewSetPassword(a);
        } }, [avatar(a.name), h('span', { class: 'hub-accname' }, [h('b', { text: a.name }), h('small', { text: sub })])])]));
      });
      body.appendChild(ul);
      var row = h('div', { class: 'hub-row' });
      if (state.accounts.length < MAX_ACC) row.appendChild(h('button', { class: 'hub-btn', type: 'button', onclick: function () { viewCreate(reason); } }, ['Создать аккаунт']));
      row.appendChild(h('button', { class: 'hub-btn hub-ghost', type: 'button', onclick: closeModal }, ['Играть без входа']));
      body.appendChild(row);
    });
  }
  function viewPassword(acc, reason) {
    openModal('Пароль', function (body) {
      var inp = h('input', { type: 'password', autocomplete: 'current-password', maxlength: '64' });
      var err = h('p', { class: 'hub-err', role: 'alert' });
      body.appendChild(h('p', { class: 'hub-note', text: 'Игрок: ' + acc.name }));
      body.appendChild(field('Пароль или PIN-код', inp));
      body.appendChild(err);
      body.appendChild(h('div', { class: 'hub-row' }, [
        h('button', { class: 'hub-btn hub-ghost', type: 'button', onclick: function () { viewPick(reason); } }, ['Назад']),
        h('button', { class: 'hub-btn hub-primary', type: 'submit' }, ['Войти'])
      ]));
      body.onsubmit = function (e) {
        e.preventDefault();
        err.textContent = '';
        login(acc.id, inp.value).then(function (r) {
          if (r.ok) { closeModal(); return; }
          err.textContent = r.error;
          inp.value = '';
          inp.focus();
        });
      };
    });
  }
  function viewSetPassword(acc) {
    openModal('Задай пароль', function (body) {
      var p1 = h('input', { type: 'password', autocomplete: 'new-password', maxlength: '64' });
      var p2 = h('input', { type: 'password', autocomplete: 'new-password', maxlength: '64' });
      var err = h('p', { class: 'hub-err', role: 'alert' });
      body.appendChild(h('p', { class: 'hub-note', text: 'Игрок: ' + acc.name + '. Пароль или PIN-код нужен при каждом входе, от 4 символов.' }));
      body.appendChild(field('Пароль', p1));
      body.appendChild(field('Повтори пароль', p2));
      body.appendChild(err);
      body.appendChild(h('div', { class: 'hub-row' }, [
        h('button', { class: 'hub-btn hub-ghost', type: 'button', onclick: function () { viewPick(); } }, ['Назад']),
        h('button', { class: 'hub-btn hub-primary', type: 'submit' }, ['Сохранить'])
      ]));
      body.onsubmit = function (e) {
        e.preventDefault();
        if (p1.value !== p2.value) { err.textContent = 'Пароли не совпадают.'; return; }
        setPassword(acc.id, p1.value).then(function (r) {
          if (r.ok) closeModal(); else err.textContent = r.error;
        });
      };
    });
  }
  function viewCreate(reason) {
    openModal('Новый аккаунт', function (body) {
      var nm = h('input', { type: 'text', maxlength: '16', autocomplete: 'off', spellcheck: 'false' });
      var p1 = h('input', { type: 'password', autocomplete: 'new-password', maxlength: '64' });
      var p2 = h('input', { type: 'password', autocomplete: 'new-password', maxlength: '64' });
      var err = h('p', { class: 'hub-err', role: 'alert' });
      if (reason) body.appendChild(h('p', { class: 'hub-note hub-reason', text: reason }));
      body.appendChild(field('Имя игрока', nm));
      body.appendChild(field('Пароль или PIN-код, от 4 символов', p1));
      body.appendChild(field('Повтори пароль', p2));
      body.appendChild(err);
      var row = h('div', { class: 'hub-row' }, [
        h('button', { class: 'hub-btn hub-primary', type: 'submit' }, ['Создать'])
      ]);
      if (state.accounts.length) row.insertBefore(h('button', { class: 'hub-btn hub-ghost', type: 'button', onclick: function () { viewPick(reason); } }, ['Назад']), row.firstChild);
      else row.insertBefore(h('button', { class: 'hub-btn hub-ghost', type: 'button', onclick: closeModal }, ['Играть без входа']), row.firstChild);
      body.appendChild(row);
      body.onsubmit = function (e) {
        e.preventDefault();
        if (p1.value !== p2.value) { err.textContent = 'Пароли не совпадают.'; return; }
        createAccount(nm.value, p1.value).then(function (r) {
          if (r.ok) closeModal(); else err.textContent = r.error;
        });
      };
    });
  }
  function viewProfile() {
    var u = user();
    if (!u) { openLogin(); return; }
    openModal(u.name, function (body) {
      body.appendChild(h('div', { class: 'hub-money' }, [h('span', { class: 'hub-coin', 'aria-hidden': 'true' }), h('span', { text: u.coins + ' ' + plural(u.coins, W_COIN) + ', общие для всех игр' })]));
      var slot = h('div');
      var renameBtn = h('button', { class: 'hub-btn', type: 'button', onclick: showRename }, ['Изменить имя']);
      slot.appendChild(renameBtn);
      body.appendChild(slot);
      function showRename() {
        slot.textContent = '';
        var inp = h('input', { type: 'text', maxlength: '16', value: u.name, 'aria-label': 'Новое имя', autocomplete: 'off' });
        var err = h('p', { class: 'hub-err', role: 'alert' });
        var doRename = function () {
          var r = rename(inp.value);
          if (r.ok) viewProfile(); else err.textContent = r.error;
        };
        var ok = h('button', { class: 'hub-icon ok', type: 'button', 'aria-label': 'Сохранить имя', title: 'Сохранить', onclick: doRename });
        ok.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
        var no = h('button', { class: 'hub-icon', type: 'button', 'aria-label': 'Отменить изменение', title: 'Отменить', onclick: function () { viewProfile(); } });
        no.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doRename(); } });
        var form = h('div', { class: 'hub-rename' }, [inp, ok, no]);
        slot.appendChild(form);
        slot.appendChild(err);
        inp.focus();
        inp.select();
      }
      body.appendChild(h('div', { class: 'hub-row' }, [
        h('button', { class: 'hub-btn', type: 'button', onclick: function () { closeModal(); logout(); } }, ['Выйти']),
        h('button', { class: 'hub-btn hub-primary', type: 'button', onclick: closeModal }, ['Закрыть'])
      ]));
    });
  }
  function openLogin(reason) {
    ready.then(function () {
      if (!state.accounts.length) viewCreate(reason); else viewPick(reason);
    });
  }
  function openProfile() { ready.then(viewProfile); }

  /* Предложение сохранить прогресс: показывается гостю один раз за посещение, например после проигрыша */
  function offerSave() {
    if (user() || offered || modal) return;
    offered = true;
    openModal('Сохранить прогресс?', function (body) {
      body.appendChild(h('p', { class: 'hub-note hub-reason', text: 'Войди в аккаунт или создай новый, чтобы монеты и результаты не пропали и копились во всех играх.' }));
      if (guest.coins > 0) {
        body.appendChild(h('p', { class: 'hub-note' }, ['Сейчас у тебя ', h('b', { text: guest.coins + ' ' + plural(guest.coins, W_COIN) }), '. Они перейдут в аккаунт.']));
      }
      body.appendChild(h('div', { class: 'hub-row' }, [
        h('button', { class: 'hub-btn hub-ghost', type: 'button', onclick: closeModal }, ['Не сейчас']),
        h('button', { class: 'hub-btn hub-primary', type: 'button', onclick: function () { viewPick('Выбери себя или создай новый аккаунт.'); if (!state.accounts.length) viewCreate(); } }, ['Войти или создать'])
      ]));
    });
  }

  /* ---------- запуск ---------- */
  try { localStorage.setItem(KEY + '.probe', '1'); localStorage.removeItem(KEY + '.probe'); } catch (e) { storageOk = false; }
  state = load();
  guest = loadGuest();
  var ready = runInit();

  /* Изменения из другой вкладки: перечитываем данные и сообщаем играм */
  window.addEventListener('storage', function (e) {
    if (e.key === KEY) { state = load(); guestGames = {}; emit('session', { reason: 'external' }); }
    else if (e.key === GKEY) { guest = loadGuest(); renderBars(); }
  });

  window.Hub = {
    ready: ready,
    user: user,
    accounts: function () { return state.accounts; },
    coins: coins,
    earned: earned,
    addCoins: addCoins,
    spend: spend,
    gameData: gameData,
    save: save,
    saveNow: saveNow,
    storageOk: function () { return storageOk; },
    on: on,
    mountBar: mountBar,
    openLogin: openLogin,
    openProfile: openProfile,
    offerSave: offerSave,
    toast: toast,
    plural: plural
  };
})();
