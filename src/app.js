/* ============================================================
   Anti-Crave Lab — client engine
   Vanilla JS · Canvas filters · Web Audio · zero dependencies
   ============================================================ */

(() => {
  'use strict';

  const I = window.__I18N__;
  const CFG = window.__CFG__;
  if (!I || !CFG) return;

  const UI = I.ui;
  const LOCALE = CFG.locale;
  const CURRENCIES = ['USD', 'CNY', 'KRW', 'JPY'];
  let CURRENCY = CFG.currency;
  const META = Object.fromEntries((CFG.dishes || []).map((d) => [d.id, d]));
  const DISH_IDS = (CFG.dishes || []).map((d) => d.id);
  const ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(location.origin)
    ? location.origin
    : CFG.origin;
  const APP_URL = `${ORIGIN}${CFG.path}`;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const esc = (str) =>
    String(str).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const T = (key) => (UI[key] == null ? key : UI[key]);
  const fmt = (str, vars = {}) =>
    String(str).replace(/\{(\w+)\}/g, (m, key) => (vars[key] == null ? m : vars[key]));
  const nf = new Intl.NumberFormat(LOCALE);
  const num = (n) => nf.format(Math.round(n));
  const moneyFormats = new Map();
  const money = (n) => {
    if (!moneyFormats.has(CURRENCY)) {
      moneyFormats.set(
        CURRENCY,
        new Intl.NumberFormat(LOCALE, {
          style: 'currency',
          currency: CURRENCY,
          maximumFractionDigits: 0,
          minimumFractionDigits: 0,
        })
      );
    }
    return moneyFormats.get(CURRENCY).format(Math.round(n));
  };
  const pad = (n) => String(n).padStart(2, '0');
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const monthKey = () => today().slice(0, 7);
  const monthLabel = () =>
    new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' }).format(new Date());

  /* ------------------------------------------------------------
     Storage
     ------------------------------------------------------------ */
  const LS = {
    cart: 'anticrave:v1:cart',
    prefs: 'anticrave:v1:prefs',
    savings: 'anticrave:v1:savings',
    dev: 'anticrave:v1:dev',
    checked: 'anticrave:v1:checked',
    best: 'anticrave:v1:best',
    votes: 'anticrave:v1:myvotes',
  };
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* storage may be unavailable */
      }
    },
  };

  const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = {
    lang: I.lang,
    level: 1,
    palette: 'cyan',
    audio: true,
    danmaku: !prefersReduced,
    peeking: false,
    activeTab: 'all',
    currency: CURRENCY,
    category: 'all',
    search: '',
    cart: store.get(LS.cart, {}),
    sources: {},
    cache: new Map(),
    customDeck: [],
    voteIndex: 0,
    votes: Object.assign({}, CFG.voteSeed || {}),
    voteLocked: false,
    votedThisSession: new Set(),
    myVotes: store.get(LS.votes, { date: today(), votes: {} }),
    pulse: 0,
    checkedIn: store.get(LS.checked, '') === today(),
    challenge: {
      active: false,
      raf: 0,
      start: 0,
      stage: -1,
      best: Number(store.get(LS.best, 0)) || 0,
      preLevel: 1,
    },
    prank: {
      dish: DISH_IDS[0] || 'burger',
      level: 3,
      sender: T('prankSenderDefault'),
      msg: T('prankMsgDefault'),
    },
    savings: null,
    pendingUpload: null,
    lastOrder: null,
    lastAdvice: '',
    modalCleanup: null,
    posterDataUrl: '',
    apiMode: 'local',
    danmakuCount: 0,
    danmakuLane: 0,
    lastPulseFetch: 0,
  };

  const savedCurrency = store.get('anticrave:v1:currency', '');
  if (CURRENCIES.includes(savedCurrency)) {
    CURRENCY = savedCurrency;
    state.currency = savedCurrency;
  }

  if (!state.myVotes || state.myVotes.date !== today()) {
    state.myVotes = { date: today(), votes: {} };
  }

  const prefs = store.get(LS.prefs, {});
  if (prefs && Number.isInteger(prefs.level)) state.level = clamp(prefs.level, 0, 3);
  if (prefs && (prefs.palette === 'cyan' || prefs.palette === 'purple')) state.palette = prefs.palette;
  if (prefs && typeof prefs.audio === 'boolean') state.audio = prefs.audio;
  if (prefs && typeof prefs.danmaku === 'boolean' && !prefersReduced) state.danmaku = prefs.danmaku;

  function savePrefs() {
    store.set(LS.prefs, {
      level: state.level,
      palette: state.palette,
      audio: state.audio,
      danmaku: state.danmaku,
    });
  }

  function loadSavings() {
    const current = monthKey();
    const raw = store.get(LS.savings, null);
    const base = {
      month: current,
      currencies: {},
      count: 0,
      kcal: 0,
      lifetimeCount: 0,
    };
    if (!raw || typeof raw !== 'object') return base;
    const merged = {
      month: raw.month || current,
      currencies: raw.currencies && typeof raw.currencies === 'object' ? raw.currencies : {},
      count: Number(raw.count) || 0,
      kcal: Number(raw.kcal) || 0,
      lifetimeCount: Number(raw.lifetimeCount) || 0,
    };
    if (merged.month !== current) {
      merged.month = current;
      merged.currencies = {};
      merged.count = 0;
      merged.kcal = 0;
    }
    return merged;
  }
  state.savings = loadSavings();

  function deviceId() {
    let id = store.get(LS.dev, '');
    if (!id || typeof id !== 'string') {
      id = `ac_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
      store.set(LS.dev, id);
    }
    return id;
  }
  const DEV_ID = deviceId();

  /* ------------------------------------------------------------
     Tiny helpers
     ------------------------------------------------------------ */
  function toast(message) {
    const el = $('#toast');
    const txt = $('#toastText');
    if (!el || !txt) return;
    txt.textContent = message;
    el.classList.add('is-show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => el.classList.remove('is-show'), 2300);
  }

  function vibrate(ms = 20) {
    try {
      navigator.vibrate?.(ms);
    } catch {
      /* noop */
    }
  }

  function dishName(id) {
    const custom = state.customDeck.find((d) => d.id === id);
    if (custom) return custom.name;
    return I.dishes[id]?.name || id;
  }

  function dishMeta(id) {
    if (!META[id]) return null;
    return Object.assign({}, META[id], I.dishes[id] || {});
  }

  function deckItemAt(index) {
    const base = DISH_IDS.map((id) => ({ id, custom: false }));
    const custom = state.customDeck.map((d) => ({ id: d.id, custom: true }));
    const deck = base.concat(custom);
    if (!deck.length) return null;
    return deck[((index % deck.length) + deck.length) % deck.length];
  }

  function sourceFor(id) {
    if (state.sources[id]) return state.sources[id];
    const custom = state.customDeck.find((d) => d.id === id);
    if (custom && custom.sourceCanvas) return custom.sourceCanvas;
    const meta = META[id];
    if (meta) {
      const fallback = proceduralFood(id);
      state.sources[id] = fallback;
      return fallback;
    }
    return proceduralFood('burger');
  }

  /* ------------------------------------------------------------
     Canvas cooking: source images + targeted hue hijack
     ------------------------------------------------------------ */
  const SW = 640;
  const SH = 480;

  function makeSourceCanvas(img) {
    const c = document.createElement('canvas');
    c.width = SW;
    c.height = SH;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const scale = Math.max(SW / img.width, SH / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, (SW - dw) / 2, (SH - dh) / 2, dw, dh);
    return c;
  }

  function proceduralFood(id) {
    const c = document.createElement('canvas');
    c.width = SW;
    c.height = SH;
    const ctx = c.getContext('2d');
    const W = SW;
    const H = SH;

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#F6DED4');
    bg.addColorStop(1, '#EACBBF');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(W / 2, H * 0.55, W * 0.4, H * 0.33, 0, 0, Math.PI * 2);
    ctx.fill();

    const food = ctx.createRadialGradient(W * 0.46, H * 0.45, 18, W / 2, H * 0.53, W * 0.32);
    if (id === 'milktea') {
      food.addColorStop(0, '#fbbf24');
      food.addColorStop(0.6, '#b45309');
      food.addColorStop(1, '#78350f');
    } else if (id === 'ramen' || id === 'pizza') {
      food.addColorStop(0, '#fb923c');
      food.addColorStop(0.55, '#dc2626');
      food.addColorStop(1, '#991b1b');
    } else {
      food.addColorStop(0, '#fde047');
      food.addColorStop(0.5, '#ea580c');
      food.addColorStop(1, '#9a3412');
    }
    ctx.fillStyle = food;
    ctx.beginPath();
    ctx.ellipse(W / 2, H * 0.53, W * 0.29, H * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(254, 240, 138, 0.55)';
    for (let i = 0; i < 24; i++) {
      const rx = W * 0.28 + ((i * 53) % (W * 0.44));
      const ry = H * 0.38 + ((i * 37) % (H * 0.3));
      ctx.beginPath();
      ctx.arc(rx, ry, 3 + (i % 7), 0, Math.PI * 2);
      ctx.fill();
    }
    return c;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function hslToRgb(h, s, l) {
    h = (((h % 360) + 360) % 360) / 360;
    if (s === 0) {
      const v = l * 255;
      return [v, v, v];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = (t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
  }

  function filterCanvas(src, level, palette) {
    if (level === 0) return src;
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0);
    const frame = ctx.getImageData(0, 0, out.width, out.height);
    const d = frame.data;
    const target = palette === 'purple' ? 282 : 191;

    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255;
      const g = d[i + 1] / 255;
      const b = d[i + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const l = (max + min) / 2;
      let h = 0;
      let s = 0;

      if (max !== min) {
        const delta = max - min;
        s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
        if (max === r) h = (g - b) / delta + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / delta + 2;
        else h = (r - g) / delta + 4;
        h *= 60;
      }

      const warm = (h < 88 || h > 332) && s > 0.12 && l > 0.05;
      let nr = r;
      let ng = g;
      let nb = b;
      let rgb;

      if (level === 1) {
        if (warm) {
          const nh = target + (h - 30) * 0.04;
          const ns = clamp(s * 1.35, 0.58, 0.96);
          const nl = clamp(l * 0.9 + 0.035, 0.08, 0.82);
          rgb = hslToRgb(nh, ns, nl);
          nr = rgb[0] / 255;
          ng = rgb[1] / 255;
          nb = rgb[2] / 255;
        } else {
          nr = r * 0.97;
          ng = g * 0.99;
          nb = Math.min(1, b * 1.02);
        }
      } else if (level === 2) {
        if (warm) {
          rgb = hslToRgb(42, 0.18, clamp(l * 0.55 + 0.42, 0.35, 0.78));
          nr = rgb[0] / 255;
          ng = rgb[1] / 255;
          nb = rgb[2] / 255;
        } else {
          const gray = r * 0.3 + g * 0.59 + b * 0.11;
          const plaster = 0.18;
          nr = gray * (1 - plaster) + 0.86 * plaster;
          ng = gray * (1 - plaster) + 0.83 * plaster;
          nb = gray * (1 - plaster) + 0.77 * plaster;
          nr = nr * 0.94 + 0.02;
          ng = ng * 0.94 + 0.02;
          nb = nb * 0.94 + 0.02;
        }
      } else if (level === 3) {
        if (warm) {
          rgb = hslToRgb(palette === 'purple' ? 292 : 78, clamp(s * 0.9, 0.38, 0.72), clamp(l * 0.46, 0.06, 0.56));
          nr = rgb[0] / 255;
          ng = rgb[1] / 255;
          nb = rgb[2] / 255;
        } else {
          nr = r * 0.46;
          ng = g * 0.55;
          nb = b * 0.4;
        }
        const grain = (((i * 9301 + 49297) % 233280) / 233280 - 0.5) * 0.06;
        nr = clamp(nr + grain, 0, 1);
        ng = clamp(ng + grain, 0, 1);
        nb = clamp(nb + grain * 0.6, 0, 1);
      }

      d[i] = nr * 255;
      d[i + 1] = ng * 255;
      d[i + 2] = nb * 255;
    }

    ctx.putImageData(frame, 0, 0);

    if (level === 3) {
      const vg = ctx.createRadialGradient(out.width / 2, out.height / 2, out.width * 0.25, out.width / 2, out.height / 2, out.width * 0.72);
      vg.addColorStop(0, 'rgba(20, 50, 8, 0)');
      vg.addColorStop(1, 'rgba(12, 30, 5, 0.5)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.fillStyle = 'rgba(120, 160, 30, 0.12)';
      for (let i = 0; i < 9; i++) {
        const cx = (i * 173) % out.width;
        const cy = out.height * 0.75 + ((i * 47) % (out.height * 0.2));
        ctx.beginPath();
        ctx.arc(cx, cy, 8 + (i % 5) * 8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    return out;
  }

  function filteredFor(id) {
    const level = state.level;
    const palette = state.palette;
    const key = `${id}|${level}|${palette}`;
    if (state.cache.has(key)) return state.cache.get(key);
    const src = sourceFor(id);
    const out = filterCanvas(src, level, palette);
    state.cache.set(key, out);
    if (state.cache.size > 20) {
      const first = state.cache.keys().next().value;
      state.cache.delete(first);
    }
    return out;
  }

  function drawInto(canvas, src) {
    if (!canvas || !src) return;
    const ctx = canvas.getContext('2d');
    if (canvas.width !== SW) canvas.width = SW;
    if (canvas.height !== SH) canvas.height = SH;
    ctx.clearRect(0, 0, SW, SH);
    ctx.drawImage(src, 0, 0, SW, SH);
  }

  function drawDishCards() {
    DISH_IDS.forEach((id) => {
      const canvas = $(`[data-dish-canvas="${id}"]`);
      if (!canvas) return;
      drawInto(canvas, state.peeking ? sourceFor(id) : filteredFor(id));
    });
  }

  function drawVoteCard() {
    const canvas = $('#voteCanvas');
    if (!canvas) return;
    const item = deckItemAt(state.voteIndex);
    if (!item) return;
    drawInto(canvas, state.peeking ? sourceFor(item.id) : filteredFor(item.id));
    const stamp = $('#voteLevelStamp');
    if (stamp) stamp.textContent = T(`level${state.level}`);
  }

  function redrawAll() {
    drawDishCards();
    drawVoteCard();
  }

  function clearCacheFor(id) {
    for (const key of Array.from(state.cache.keys())) {
      if (key.startsWith(`${id}|`)) state.cache.delete(key);
    }
  }

  async function preloadSources() {
    await Promise.all(
      (CFG.dishes || []).map(async (dish) => {
        try {
          const img = await loadImage(dish.image);
          state.sources[dish.id] = makeSourceCanvas(img);
          clearCacheFor(dish.id);
        } catch {
          /* keep the procedural fallback */
        }
      })
    );
    redrawAll();
  }

  /* ------------------------------------------------------------
     Web Audio anti-mukbang synth
     ------------------------------------------------------------ */
  const AudioLab = {
    ctx: null,
    master: null,
    ensure() {
      if (!this.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.82;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    },
    sludge(duration = 1.7) {
      if (!state.audio) return;
      const ctx = this.ensure();
      if (!ctx) return;
      const now = ctx.currentTime;
      const pops = 9;
      for (let i = 0; i < pops; i++) {
        const t0 = now + (i / pops) * duration * 0.86 + Math.random() * 0.08;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        const base = 95 + Math.random() * 150;
        osc.frequency.setValueAtTime(base, t0);
        osc.frequency.exponentialRampToValueAtTime(base * 2.7, t0 + 0.11);
        gain.gain.setValueAtTime(0.001, t0);
        gain.gain.linearRampToValueAtTime(0.16, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);
        osc.connect(gain);
        gain.connect(this.master);
        osc.start(t0);
        osc.stop(t0 + 0.16);
      }
    },
    styrofoam(duration = 1.35) {
      if (!state.audio) return;
      const ctx = this.ensure();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1700, now);
      osc.frequency.linearRampToValueAtTime(2380, now + duration * 0.5);
      osc.frequency.linearRampToValueAtTime(1380, now + duration);
      lfo.frequency.setValueAtTime(13, now);
      lfoGain.gain.setValueAtTime(300, now);
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(2100, now);
      filter.Q.setValueAtTime(6, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.09, now + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      osc.start(now);
      lfo.start(now);
      osc.stop(now + duration);
      lfo.stop(now + duration);
    },
    toothbrush(duration = 1.5) {
      if (!state.audio) return;
      const ctx = this.ensure();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const over = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(258, now);
      over.type = 'sine';
      over.frequency.setValueAtTime(516, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.08);
      gain.gain.setValueAtTime(0.12, now + duration - 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      osc.connect(gain);
      over.connect(gain);
      gain.connect(this.master);
      osc.start(now);
      over.start(now);
      osc.stop(now + duration);
      over.stop(now + duration);
    },
    fly(duration = 1.5) {
      if (!state.audio) return;
      const ctx = this.ensure();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(210, now);
      osc.frequency.linearRampToValueAtTime(282, now + duration * 0.45);
      osc.frequency.linearRampToValueAtTime(196, now + duration);
      lfo.frequency.setValueAtTime(27, now);
      lfoGain.gain.setValueAtTime(22, now);
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.075, now + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(now);
      lfo.start(now);
      osc.stop(now + duration);
      lfo.stop(now + duration);
    },
    chime(kind = 'win') {
      if (!state.audio) return;
      const ctx = this.ensure();
      if (!ctx) return;
      const now = ctx.currentTime;
      const notes = kind === 'win' ? [523.25, 659.25, 783.99, 1046.5] : [392, 329.63];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t0 = now + i * 0.1;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t0);
        gain.gain.setValueAtTime(0.001, t0);
        gain.gain.linearRampToValueAtTime(0.1, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.32);
        osc.connect(gain);
        gain.connect(this.master);
        osc.start(t0);
        osc.stop(t0 + 0.34);
      });
    },
  };

  const SOUND_MAP = {
    sludge: 'sludge',
    styrofoam: 'styrofoam',
    toothbrush: 'toothbrush',
    fly: 'fly',
  };

  function playAntiSound(type) {
    if (!state.audio) {
      state.audio = true;
      updateSoundButton();
      savePrefs();
    }
    vibrate(30);
    const fn = SOUND_MAP[type];
    if (fn && AudioLab[fn]) AudioLab[fn]();
  }

  /* ------------------------------------------------------------
     Header / controls
     ------------------------------------------------------------ */
  function splitLevelLabel(label, i) {
    const str = String(label || `Lv.${i}`);
    const idx = str.indexOf(' ');
    if (idx > 0) return [str.slice(0, idx), str.slice(idx + 1)];
    return [`Lv.${i}`, str];
  }

  function renderControls() {
    const levels = $('#levelTabs');
    if (levels) {
      levels.innerHTML = [0, 1, 2, 3]
        .map((i) => {
          const [lv, name] = splitLevelLabel(T(`level${i}`), i);
          return `<button class="level-btn ${state.level === i ? 'is-active' : ''}" type="button" role="tab" aria-selected="${state.level === i}" data-level="${i}">
            <span class="lv">${esc(lv)}</span>
            <span class="lv-name">${esc(name)}</span>
          </button>`;
        })
        .join('');
    }

    const deck = $('#controlDeck');
    if (deck) {
      deck.innerHTML = `
        <div class="control-row">
          <div class="segmented" id="paletteTabs" role="group" aria-label="${esc(T('palCyan'))}">
            <button class="seg ${state.palette === 'cyan' ? 'is-active' : ''}" type="button" data-palette="cyan"><i class="dot"></i>${esc(T('palCyan'))}</button>
            <button class="seg ${state.palette === 'purple' ? 'is-active' : ''}" type="button" data-palette="purple"><i class="dot"></i>${esc(T('palPurple'))}</button>
          </div>
          <div class="sound-strip no-scrollbar" aria-label="${esc(T('soundOn'))}">
            <button class="sound-btn" type="button" data-sound="sludge">${esc(T('sndSludge'))}</button>
            <button class="sound-btn" type="button" data-sound="styrofoam">${esc(T('sndStyrofoam'))}</button>
            <button class="sound-btn" type="button" data-sound="toothbrush">${esc(T('sndToothbrush'))}</button>
            <button class="sound-btn" type="button" data-sound="fly">${esc(T('sndFly'))}</button>
          </div>
        </div>
        <form class="danmaku-form" id="danmakuForm">
          <input id="danmakuInput" type="text" maxlength="28" autocomplete="off" placeholder="${esc(T('danmakuPlaceholder'))}" aria-label="${esc(T('danmakuPlaceholder'))}">
          <button class="btn btn-ghost btn-sm" type="submit" id="danmakuSubmit">${esc(T('danmakuSubmit'))}</button>
        </form>`;
    }
    updateDanmakuButton();
    updateSoundButton();
  }

  function updateLevelButtons() {
    $$('#levelTabs .level-btn').forEach((btn) => {
      const active = Number(btn.dataset.level) === state.level;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    });
  }

  function updateSoundButton() {
    const btn = $('#soundBtn');
    if (!btn) return;
    btn.classList.toggle('is-on', state.audio);
    btn.classList.toggle('is-off', !state.audio);
    btn.setAttribute('aria-pressed', String(state.audio));
    const label = state.audio ? T('soundOn') : T('soundOff');
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
  }

  function updateDanmakuButton() {
    const btn = $('#danmakuBtn');
    if (!btn) return;
    btn.classList.toggle('is-on', state.danmaku);
    btn.setAttribute('aria-pressed', String(state.danmaku));
    const label = state.danmaku ? T('danmakuOn') : T('danmakuOff');
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
    const layer = $('#danmakuLayer');
    if (layer) layer.classList.toggle('is-off', !state.danmaku);
  }

  function setLevel(level, opts = {}) {
    const next = clamp(Number(level), 0, 3);
    if (next === state.level) {
      updateLevelButtons();
      return;
    }
    state.level = next;
    updateLevelButtons();
    if (opts.persist !== false) savePrefs();
    redrawAll();
    if (typeof syncCardStates === 'function') syncCardStates();
    if (!opts.challenge && state.challenge.active) {
      stopChallenge(false);
    }
  }

  function setPalette(palette) {
    if (palette !== 'cyan' && palette !== 'purple') return;
    if (state.palette === palette) return;
    state.palette = palette;
    state.cache.clear();
    savePrefs();
    $$('#paletteTabs .seg').forEach((b) => b.classList.toggle('is-active', b.dataset.palette === palette));
    redrawAll();
  }

  function toggleSound() {
    state.audio = !state.audio;
    updateSoundButton();
    savePrefs();
    toast(state.audio ? T('toastAudioOn') : T('toastAudioOff'));
  }

  function toggleDanmaku() {
    state.danmaku = !state.danmaku;
    updateDanmakuButton();
    savePrefs();
    toast(state.danmaku ? T('toastDanmakuOn') : T('toastDanmakuOff'));
  }

  /* ------------------------------------------------------------
     Danmaku
     ------------------------------------------------------------ */
  const DANMAKU_COLORS = ['#43303a', '#d8443d', '#4f9e7c', '#9b5c74', '#b5821f', '#5b454f'];

  function spawnDanmaku(text, color) {
    if (!state.danmaku || !text) return;
    const layer = $('#danmakuLayer');
    if (!layer) return;
    const max = 3;
    while (layer.children.length >= max) layer.firstElementChild?.remove();
    const el = document.createElement('span');
    el.className = 'danmaku-item';
    el.textContent = text;
    el.style.top = `${2 + (state.danmakuLane % 3) * 13}px`;
    state.danmakuLane += 1;
    el.style.color = color || DANMAKU_COLORS[Math.floor(Math.random() * DANMAKU_COLORS.length)];
    const duration = 9 + Math.random() * 5;
    el.style.animationDuration = `${duration}s`;
    el.addEventListener('animationend', () => el.remove(), { once: true });
    layer.appendChild(el);
    setTimeout(() => el.remove(), (duration + 1) * 1000);
  }

  function startDanmakuLoop() {
    const pool = Array.isArray(UI.danmakuPool) ? UI.danmakuPool.slice() : [];
    if (!pool.length) return;
    const tick = () => {
      if (!document.hidden && state.danmaku) {
        const text = pool[Math.floor(Math.random() * pool.length)];
        spawnDanmaku(text);
      }
    };
    setTimeout(tick, 500);
    setInterval(tick, 4600);
  }

  function submitDanmaku(text) {
    const clean = String(text || '').trim().slice(0, 28);
    if (!clean) return false;
    if (!state.danmaku) {
      state.danmaku = true;
      updateDanmakuButton();
      savePrefs();
    }
    state.lastAdvice = clean;
    if (Array.isArray(UI.danmakuPool)) UI.danmakuPool.unshift(clean);
    spawnDanmaku(clean, '#D8443D');
    return true;
  }

  /* ------------------------------------------------------------
     Savings, cart, order list
     ------------------------------------------------------------ */
  function cartTotals() {
    let kcal = 0;
    let moneyTotal = 0;
    let items = 0;
    Object.entries(state.cart).forEach(([id, count]) => {
      const meta = META[id];
      const n = Number(count) || 0;
      if (!meta || n <= 0) return;
      items += n;
      kcal += meta.kcal * n;
      moneyTotal += (meta.price?.[CURRENCY] || 0) * n;
    });
    return {
      kcal,
      money: moneyTotal,
      items,
      km: (kcal / 60).toFixed(1),
      fat: Math.round(kcal / 7.7),
    };
  }

  const CUISINE_META = {
    korean: { emoji: '🇰🇷', labelKey: 'categoryKorean' },
    japanese: { emoji: '🇯🇵', labelKey: 'categoryJapanese' },
    american: { emoji: '🇺🇸', labelKey: 'categoryAmerican' },
    italian: { emoji: '🇮🇹', labelKey: 'categoryItalian' },
    drinks: { emoji: '🥤', labelKey: 'categoryDrinks' },
  };
  const CATEGORY_ORDER = ['all', 'korean', 'japanese', 'american', 'italian', 'drinks'];

  function shortLevelLabel() {
    const label = String(T(`level${state.level}`));
    const idx = label.indexOf(' ');
    return idx > 0 ? label.slice(0, idx) : label;
  }

  function renderCategories() {
    const root = $('#categoryRow');
    if (!root) return;
    root.innerHTML = CATEGORY_ORDER.map((id) => {
      const meta =
        id === 'all'
          ? { emoji: '✨', label: T('categoryAll') }
          : { emoji: CUISINE_META[id].emoji, label: T(CUISINE_META[id].labelKey) };
      return `<button class="category-btn ${state.category === id ? 'is-active' : ''}" type="button" data-category="${id}" aria-pressed="${state.category === id}">
        <span class="cat-circle"><span class="cat-emoji" aria-hidden="true">${meta.emoji}</span></span>
        <span class="cat-name">${esc(meta.label)}</span>
      </button>`;
    }).join('');
    root.querySelectorAll('[data-category]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.category = btn.dataset.category;
        renderCategories();
        renderDishList();
      });
    });
  }

  function setSearch(value) {
    state.search = String(value || '');
    const hero = $('#heroSearch');
    const menu = $('#dishSearch');
    if (hero && hero.value !== state.search) hero.value = state.search;
    if (menu && menu.value !== state.search) menu.value = state.search;
    renderDishList();
  }

  function renderSavings() {
    const root = $('#savingsCard');
    if (!root) return;
    const saved = state.savings;
    const amount = saved.currencies?.[CURRENCY] || 0;
    const empty = !saved.count;
    root.innerHTML = `
      <div class="savings-card ${empty ? 'is-empty' : ''}">
        <div class="piggy" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M4.2 12.4c0-3 2.9-5.2 6.5-5.2h3.1c3.2 0 5.7 1.8 5.7 4.5 0 1.4-.7 2.6-1.8 3.5v2.2h-2.8v-1.1h-3.1v1.1H8.9v-1.8c-1.4-1-2.1-2.4-2.1-3.9Z"/><path d="M9.2 10.3v2.1M17.6 7.2l1.4-2.1"/></svg>
        </div>
        <div class="savings-copy">
          <div class="savings-kicker">${esc(T('savingsTitle'))}</div>
          <div class="savings-month">${esc(fmt(T('savingsMonth'), { month: monthLabel() }))}</div>
          <div class="savings-amount"><b>${esc(money(amount))}</b><small>${esc(T('savingsAmountLabel'))}</small></div>
        </div>
        <div class="savings-stats">
          <div><b>${num(saved.count)}</b><span>${esc(T('savingsOrders'))}</span></div>
          <div><b>${num(saved.kcal)}</b><span>${esc(T('savingsKcalLabel'))}</span></div>
          <div><b>${num(saved.lifetimeCount)}</b><span>${esc(T('savingsLifetimeLabel'))}</span></div>
        </div>
      </div>`;
  }

  function cardHTML(id) {
    const meta = dishMeta(id);
    if (!meta) return '';
    const count = Number(state.cart[id]) || 0;
    const price = money(meta.price?.[CURRENCY] || 0);
    const cuisine = CUISINE_META[meta.cuisine] || { emoji: '🍽', labelKey: 'categoryAll' };
    const badge = meta.badge
      ? `<span class="card-badge card-badge-${meta.badge.toLowerCase()}">${esc(meta.badge)}</span>`
      : '';
    return `
      <article class="dish-card ${count ? 'is-added' : ''}" data-dish-card="${id}">
        <div class="dish-media">
          <button class="media-hit" type="button" data-fatigue="${id}" aria-label="${esc(meta.name)} · ${esc(T('gridCta'))}">
            <canvas data-dish-canvas="${id}" width="${SW}" height="${SH}"></canvas>
          </button>
          <span class="cuisine-chip" title="${esc(T(cuisine.labelKey))}">${cuisine.emoji}</span>
          ${badge}
          <button class="prank-fab" type="button" data-prank-dish="${id}" aria-label="${esc(T('prankDish'))}" title="${esc(T('prankDish'))}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3.5h6M10 3.5v5.2L5.8 17a3 3 0 0 0 2.7 4.4h7a3 3 0 0 0 2.7-4.4L14 8.7V3.5"/><path d="M7.4 14.2h9.2"/></svg>
          </button>
          <button class="grid-pill" type="button" data-fatigue="${id}">
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 1h3v3H1zM4.5 1h3v3h-3zM8 1h3v3H8zM1 4.5h3v3H1zM4.5 4.5h3v3h-3zM8 4.5h3v3H8zM1 8h3v3H1zM4.5 8h3v3h-3zM8 8h3v3H8z"/></svg>
            ${esc(T('gridCta'))}
          </button>
        </div>
        <div class="dish-body">
          <div class="dish-title"><h3>${esc(meta.name)}</h3></div>
          <div class="dish-meta">
            <span class="meta-pill">★ ${num(meta.kcal)} ${esc(T('kcalUnit'))}</span>
            <span class="meta-level">${esc(shortLevelLabel())}</span>
            <span class="meta-anchor">${meta.butter} ${esc(T('butterUnit'))}</span>
          </div>
          <p class="dish-poison">${esc(meta.poison)}</p>
          <div class="dish-price-row">
            <div class="dish-price-wrap">
              <div class="dish-price">${esc(price)}</div>
              <div class="dish-saved">${esc(fmt(T('cartSaved'), { money: price }))}</div>
            </div>
            <button class="btn-add ${count ? 'is-added' : ''}" type="button" data-add-cart="${id}">${
              count ? `×${count}` : esc(T('blockShort'))
            }</button>
          </div>
        </div>
      </article>`;
  }

  function renderDishList() {
    const root = $('#dishList');
    if (!root) return;
    const q = state.search.trim().toLowerCase();
    const visible = DISH_IDS.filter((id) => {
      const meta = dishMeta(id);
      if (!meta) return false;
      if (state.category !== 'all' && meta.cuisine !== state.category) return false;
      if (!q) return true;
      return `${meta.name} ${meta.poison} ${meta.desc}`.toLowerCase().includes(q);
    });
    root.innerHTML = visible.length
      ? visible.map(cardHTML).join('')
      : `<div class="menu-empty">${esc(T('menuEmpty'))}</div>`;
    drawDishCards();
    updateCartUI();
  }

  function syncCardStates() {
    DISH_IDS.forEach((id) => {
      const card = $(`[data-dish-card="${id}"]`);
      if (!card) return;
      const n = Number(state.cart[id]) || 0;
      card.classList.toggle('is-added', n > 0);
      const btn = $('[data-add-cart]', card);
      if (btn) {
        btn.textContent = n > 0 ? `×${n}` : T('blockShort');
        btn.classList.toggle('is-added', n > 0);
      }
      const level = $('.meta-level', card);
      if (level) level.textContent = shortLevelLabel();
    });
  }

  function updateCartUI() {
    const totals = cartTotals();
    const kcalEl = $('#cartKcal');
    const moneyEl = $('#cartMoney');
    const subEl = $('#cartSub');
    const badge = $('#cartBadge');
    const checkout = $('#checkoutBtn');
    const clear = $('#cartClearBtn');
    const bar = $('#cartBar');

    if (kcalEl) kcalEl.textContent = fmt(T('cartBlocked'), { n: num(totals.kcal) });
    if (moneyEl) moneyEl.textContent = fmt(T('cartSaved'), { money: money(totals.money) });
    if (subEl) {
      subEl.textContent = totals.items
        ? fmt(T('cartSub'), { km: totals.km, g: num(totals.fat) })
        : T('cartSubEmpty');
    }
    if (badge) {
      badge.hidden = totals.items <= 0;
      badge.textContent = String(totals.items);
    }
    if (checkout) checkout.disabled = totals.items <= 0;
    if (clear) clear.hidden = totals.items <= 0;
    if (bar) bar.classList.toggle('is-hidden', totals.items <= 0);
    document.body.classList.toggle('has-cart', totals.items > 0);
    syncCardStates();
  }

  function updateCurrencyButton() {
    const code = $('#currencyCode');
    if (code) code.textContent = CURRENCY;
    $$('#currencyMenu [data-currency]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.currency === CURRENCY);
    });
  }

  function setCurrency(currency) {
    if (!CURRENCIES.includes(currency)) return;
    CURRENCY = currency;
    state.currency = currency;
    store.set('anticrave:v1:currency', currency);
    updateCurrencyButton();
    renderDishList();
    renderSavings();
    const menu = $('#currencyMenu');
    if (menu) menu.hidden = true;
    const btn = $('#currencyBtn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function addToCart(id) {
    if (!META[id]) return;
    state.cart[id] = (Number(state.cart[id]) || 0) + 1;
    store.set(LS.cart, state.cart);
    vibrate(18);
    toast(T('toastAdded'));
    updateCartUI();
  }

  function clearCart() {
    state.cart = {};
    store.set(LS.cart, state.cart);
    updateCartUI();
  }

  /* ------------------------------------------------------------
     Pulse + community API
     ------------------------------------------------------------ */
  function updatePulseText() {
    const el = $('#pulseText');
    if (!el) return;
    const n = Math.max(0, Number(state.pulse) || 0);
    let text;
    if (state.checkedIn) text = fmt(T('pulseJoined'), { n: num(n) });
    else if (n <= 0) text = T('pulseZero');
    else if (n === 1) text = T('pulseOne');
    else text = fmt(T('pulseN'), { n: num(n) });
    el.textContent = text;
    const btn = $('#checkinBtn');
    if (btn) {
      btn.textContent = state.checkedIn ? T('checkinDone') : T('checkin');
      btn.classList.toggle('is-done', state.checkedIn);
    }
  }

  async function apiRequest(payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      const url = payload
        ? CFG.apiBase
        : `${CFG.apiBase}?date=${encodeURIComponent(today())}`;
      const res = await fetch(url, {
        method: payload ? 'POST' : 'GET',
        headers: payload ? { 'Content-Type': 'application/json' } : undefined,
        body: payload ? JSON.stringify({ ...payload, devId: DEV_ID, date: today() }) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || !data.ok) throw new Error('API not ready');
      state.apiMode = data.mode || 'live';
      return data;
    } catch {
      state.apiMode = 'local';
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function refreshStats(force = false) {
    const now = Date.now();
    if (!force && now - state.lastPulseFetch < 30000) return;
    state.lastPulseFetch = now;
    const data = await apiRequest(null);
    if (data && data.stats) {
      state.pulse = Number(data.stats.pulse) || 0;
      if (data.stats.votes) state.votes = data.stats.votes;
      updatePulseText();
      if (!state.challenge.active) {
        const card = $('#voteCard');
        if (card && !card.classList.contains('is-swiping')) renderVote();
      }
    }
  }

  async function handleCheckin() {
    if (state.checkedIn) {
      toast(T('checkinDone'));
      return;
    }
    state.checkedIn = true;
    state.pulse = Math.max(0, state.pulse) + 1;
    store.set(LS.checked, today());
    updatePulseText();
    vibrate(24);
    toast(T('toastCheckin'));
    const data = await apiRequest({ action: 'checkin' });
    if (data && data.stats) {
      state.pulse = Number(data.stats.pulse) || state.pulse;
      updatePulseText();
    }
  }

  /* ------------------------------------------------------------
     Vote deck
     ------------------------------------------------------------ */
  function voteCounts(id) {
    if (id.startsWith('custom-')) {
      const item = state.customDeck.find((d) => d.id === id);
      return item?.votes || { quit: 0, hungry: 0 };
    }
    const c = state.votes[id];
    if (!c) return { quit: 0, hungry: 0 };
    return { quit: Number(c.quit) || 0, hungry: Number(c.hungry) || 0 };
  }

  function votePct(counts) {
    const total = counts.quit + counts.hungry;
    if (!total) return 50;
    return Math.round((counts.quit / total) * 100);
  }

  function renderVote() {
    const root = $('#voteDeck');
    if (!root) return;
    const item = deckItemAt(state.voteIndex);
    if (!item) {
      root.innerHTML = `<div class="menu-empty">${esc(T('voteEmpty'))}</div>`;
      return;
    }
    const custom = state.customDeck.find((d) => d.id === item.id);
    const meta = dishMeta(item.id);
    if (!meta && !custom) return;
    const counts = voteCounts(item.id);
    const pct = votePct(counts);
    const total = counts.quit + counts.hungry;
    const title = custom ? custom.name : meta.name;
    const sub = custom ? T('voteLocalNote') : meta.poison;
    const tag = custom ? T('voteTagUser') : fmt(T('voteTagRank'), { i: state.voteIndex + 1 });

    root.innerHTML = `
      <div class="vote-card" id="voteCard">
        <div class="vote-media">
          <canvas id="voteCanvas" width="${SW}" height="${SH}"></canvas>
          <span class="clinical-vignette"></span>
          <span class="tag vote-tag">${esc(tag)}</span>
          <span class="vote-level" id="voteLevelStamp">${esc(T(`level${state.level}`))}</span>
          <div class="vote-stats">
            <div class="vote-labels">
              <span class="ok">${esc(fmt(T('voteQuitPct'), { pct, n: num(counts.quit) }))}</span>
              <span class="bad">${esc(fmt(T('voteHungryPct'), { pct: 100 - pct, n: num(counts.hungry) }))}</span>
            </div>
            <div class="ratio"><i style="width:${pct}%"></i></div>
          </div>
          <span class="swipe-hint">${esc(T('voteSwipeHint'))}</span>
          <span class="swipe-stamp quit">${esc(T('voteQuit'))}</span>
          <span class="swipe-stamp hungry">${esc(T('voteHungry'))}</span>
        </div>
        <div class="vote-body">
          <h3>${esc(title)}</h3>
          <p>${esc(sub)}</p>
          <div class="vote-actions">
            <button class="btn-vote quit" type="button" data-vote="quit">
              <span class="emoji">🤮</span>
              <span>${esc(T('voteQuit'))}</span>
              <small>${esc(fmt(T('voteQuitPct'), { pct, n: num(counts.quit) }))}</small>
            </button>
            <button class="btn-vote hungry" type="button" data-vote="hungry">
              <span class="emoji">🤤</span>
              <span>${esc(T('voteHungry'))}</span>
              <small>${esc(fmt(T('voteHungryPct'), { pct: 100 - pct, n: num(counts.hungry) }))}</small>
            </button>
          </div>
          <div class="vote-foot">
            <span>${esc(T('voteSwipeHint'))}</span>
            <span>${total ? `${num(total)} ♥` : '0 ♥'}</span>
          </div>
        </div>
      </div>`;

    drawVoteCard();
    bindSwipe();
    root.querySelectorAll('[data-vote]').forEach((btn) => {
      btn.addEventListener('click', () => commitVote(btn.dataset.vote));
    });
  }

  function bindSwipe() {
    const card = $('#voteCard');
    if (!card) return;
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let dy = 0;
    let dragging = false;
    let pointerId = null;

    const reset = () => {
      card.style.transform = '';
      card.classList.remove('is-swiping');
      const q = $('.swipe-stamp.quit', card);
      const h = $('.swipe-stamp.hungry', card);
      if (q) q.style.opacity = '';
      if (h) h.style.opacity = '';
    };

    card.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      dx = 0;
      dy = 0;
      card.classList.add('is-swiping');
      try {
        card.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    });

    card.addEventListener('pointermove', (e) => {
      if (!dragging || e.pointerId !== pointerId) return;
      dx = e.clientX - startX;
      dy = e.clientY - startY;
      if (Math.abs(dx) < Math.abs(dy) * 0.8) return;
      const tilt = clamp(dx * 0.035, -12, 12);
      card.style.transform = `translateX(${dx}px) rotate(${tilt}deg)`;
      const q = $('.swipe-stamp.quit', card);
      const h = $('.swipe-stamp.hungry', card);
      if (q) q.style.opacity = String(clamp(-dx / 90, 0, 1));
      if (h) h.style.opacity = String(clamp(dx / 90, 0, 1));
    });

    const finish = () => {
      if (!dragging) return;
      dragging = false;
      card.classList.remove('is-swiping');
      if (dx < -72) {
        card.classList.add('swipe-out-left');
        setTimeout(() => commitVote('quit'), 120);
      } else if (dx > 72) {
        card.classList.add('swipe-out-right');
        setTimeout(() => commitVote('hungry'), 120);
      } else {
        reset();
      }
    };

    card.addEventListener('pointerup', finish);
    card.addEventListener('pointercancel', finish);
    card.addEventListener('pointerleave', (e) => {
      if (dragging && e.pointerType === 'mouse') finish();
    });
  }

  async function commitVote(side) {
    if (side !== 'quit' && side !== 'hungry') return;
    if (state.voteLocked) return;
    const item = deckItemAt(state.voteIndex);
    if (!item) return;
    state.voteLocked = true;
    const id = item.id;
    const isCustom = id.startsWith('custom-');
    state.votedThisSession.add(id);

    if (isCustom) {
      const custom = state.customDeck.find((d) => d.id === id);
      if (custom) {
        custom.votes = custom.votes || { quit: 0, hungry: 0 };
        custom.votes[side] = (custom.votes[side] || 0) + 1;
      }
    } else {
      if (!state.votes[id]) state.votes[id] = { quit: 0, hungry: 0 };
      state.votes[id][side] = (Number(state.votes[id][side]) || 0) + 1;
    }

    vibrate(22);
    toast(T('toastVote'));

    if (!isCustom) {
      const data = await apiRequest({ action: 'vote', dish: id, side });
      if (data && data.stats && data.stats.votes) {
        state.votes = data.stats.votes;
      }
    }

    setTimeout(() => {
      state.voteIndex = (state.voteIndex + 1) % Math.max(1, DISH_IDS.length + state.customDeck.length);
      state.voteLocked = false;
      renderVote();
    }, 300);
  }

  /* ------------------------------------------------------------
     15-second tolerance challenge
     ------------------------------------------------------------ */
  function challengeStartBtnHTML() {
    return `<button class="btn btn-coral btn-sm" type="button" id="challengeStartBtn">${esc(
      state.challenge.active ? T('challengeStop') : T('challengeStart')
    )}</button>`;
  }

  function renderVoteHead() {
    const head = $('#voteHead');
    if (!head) return;
    head.innerHTML = `<div class="vote-testbar">
      <div class="testbar-left">
        <span class="testbar-tag">15s</span>
        <span class="testbar-hint">${esc(T('challengeHint'))}</span>
      </div>
      ${challengeStartBtnHTML()}
    </div>`;
    $('#challengeStartBtn')?.addEventListener('click', () => {
      if (state.challenge.active) stopChallenge(true);
      else startChallenge();
    });
  }

  function challengeStageLabel(stage) {
    const prefix = fmt(T('challengeStagePrefix'), { i: stage + 1 });
    const label = Array.isArray(T('challengeStages')) ? T('challengeStages')[stage] : '';
    return `${prefix} · ${label}`;
  }

  function renderChallengePanel() {
    const panel = $('#challengePanel');
    if (!panel) return;
    panel.innerHTML = `
      <div class="challenge-panel" id="challengeBox">
        <div class="challenge-top">
          <span>${esc(T('challengeRunning'))}</span>
          <b class="mono" id="challengeSeconds">15.0s</b>
        </div>
        <div class="progress"><i id="challengeProgress" style="width:100%"></i></div>
        <div class="challenge-bottom">
          <span id="challengeStage">${esc(challengeStageLabel(0))}</span>
          <button type="button" id="challengeSurrenderBtn">${esc(T('challengeSurrender'))}</button>
        </div>
      </div>`;
    $('#challengeSurrenderBtn')?.addEventListener('click', () => stopChallenge(false, true));
  }

  function startChallenge() {
    if (state.challenge.active) return;
    const panel = $('#challengePanel');
    const result = $('#challengeResult');
    if (!panel) return;
    state.challenge.active = true;
    state.challenge.start = performance.now();
    state.challenge.stage = -1;
    state.challenge.preLevel = state.level;
    state.challenge.raf = 0;
    if (result) result.hidden = true;
    panel.hidden = false;
    renderChallengePanel();
    renderVoteHead();
    AudioLab.ensure();

    const duration = 15000;
    const tick = (ts) => {
      if (!state.challenge.active) return;
      const elapsed = ts - state.challenge.start;
      const remaining = Math.max(0, duration - elapsed);
      const secs = document.getElementById('challengeSeconds');
      const bar = document.getElementById('challengeProgress');
      const label = document.getElementById('challengeStage');
      const box = document.getElementById('challengeBox');
      if (secs) secs.textContent = `${(remaining / 1000).toFixed(1)}s`;
      if (bar) bar.style.width = `${(remaining / duration) * 100}%`;
      const stage = Math.min(3, Math.floor(elapsed / (duration / 4)));
      if (stage !== state.challenge.stage) {
        state.challenge.stage = stage;
        setLevel(stage, { persist: false, challenge: true });
        if (label) label.textContent = challengeStageLabel(stage);
        if (elapsed > 0) {
          if (stage === 1) AudioLab.styrofoam(0.8);
          else if (stage === 2) AudioLab.styrofoam(0.9);
          else if (stage === 3) AudioLab.sludge(1.2);
        }
      }
      if (box) box.classList.toggle('is-danger', remaining < 5000);
      if (remaining <= 0) {
        finishChallenge(true, duration);
        return;
      }
      state.challenge.raf = requestAnimationFrame(tick);
    };
    state.challenge.raf = requestAnimationFrame(tick);
  }

  function stopChallenge(goBack, surrender = false) {
    if (!state.challenge.active) return;
    const elapsed = Math.min(15000, performance.now() - state.challenge.start);
    cancelAnimationFrame(state.challenge.raf);
    state.challenge.active = false;
    const panel = $('#challengePanel');
    if (panel) panel.hidden = true;
    renderVoteHead();
    if (surrender) {
      finishChallenge(false, elapsed);
      return;
    }
    setLevel(state.challenge.preLevel, { persist: true, challenge: true });
    if (goBack) {
      /* user stopped the test without a result banner */
      const result = $('#challengeResult');
      if (result) result.hidden = true;
    }
  }

  function finishChallenge(won, elapsed) {
    cancelAnimationFrame(state.challenge.raf);
    state.challenge.active = false;
    const panel = $('#challengePanel');
    if (panel) panel.hidden = true;
    renderVoteHead();
    setLevel(state.challenge.preLevel, { persist: true, challenge: true });

    const seconds = Math.max(0, Math.min(15, elapsed / 1000));
    const rounded = seconds.toFixed(1);
    if (won && seconds > state.challenge.best) {
      state.challenge.best = seconds;
      store.set(LS.best, seconds);
    }
    const result = $('#challengeResult');
    if (result) {
      result.hidden = false;
      const title = won ? T('challengeWinTitle') : fmt(T('challengeLoseTitle'), { s: rounded });
      const desc = won ? T('challengeWinDesc') : fmt(T('challengeLoseDesc'), { s: rounded });
      result.innerHTML = `<div class="challenge-result">
        <h3>${esc(title)}</h3>
        <p>${esc(desc)}</p>
        <p style="color:var(--muted-2);font-size:9px;margin-top:6px">${esc(
          fmt(T('challengeBest'), { s: state.challenge.best.toFixed(1) })
        )}</p>
        <div class="row">
          <button class="btn btn-amber btn-sm" type="button" data-challenge-retry>${esc(T('challengeRetry'))}</button>
          <button class="btn btn-ghost btn-sm" type="button" data-challenge-back>${esc(T('challengeBack'))}</button>
        </div>
      </div>`;
      result.querySelector('[data-challenge-retry]')?.addEventListener('click', () => {
        result.hidden = true;
        startChallenge();
      });
      result.querySelector('[data-challenge-back]')?.addEventListener('click', () => {
        result.hidden = true;
      });
    }
    AudioLab.chime(won ? 'win' : 'lose');
    toast(won ? T('toastChallengeWin') : T('toastChallengeLose'));
  }

  /* ------------------------------------------------------------
     Prank generator
     ------------------------------------------------------------ */
  function prankUrl() {
    const url = new URL(APP_URL);
    url.searchParams.set('p', '1');
    url.searchParams.set('d', state.prank.dish);
    url.searchParams.set('lv', String(state.prank.level));
    url.searchParams.set('f', state.prank.sender.slice(0, 32));
    url.searchParams.set('m', state.prank.msg.slice(0, 64));
    return url.toString();
  }

  function updatePrankUrl() {
    const el = $('#prankUrl');
    if (el) el.textContent = prankUrl();
  }

  function renderPrank() {
    const root = $('#prankPanel');
    if (!root) return;
    root.innerHTML = `
      <div class="prank-panel">
        <div class="field">
          <label for="prankSenderInput">${esc(T('prankStep1'))}</label>
          <input id="prankSenderInput" type="text" maxlength="32" autocomplete="off" value="${esc(state.prank.sender)}">
        </div>

        <div class="field">
          <label>${esc(T('prankStep2'))}</label>
          <div class="dish-select" id="prankDishes">
            ${DISH_IDS.map((id) => {
              const meta = dishMeta(id);
              return `<button type="button" class="${state.prank.dish === id ? 'is-active' : ''}" data-prank-pick="${id}" title="${esc(meta?.name || id)}"><i class="dot"></i><span>${esc(meta?.name || id)}</span></button>`;
            }).join('')}
          </div>
        </div>

        <div class="field">
          <label>${esc(T('prankStep3'))}</label>
          <div class="prank-levels" id="prankLevels">
            ${[1, 2, 3]
              .map((lv) => `<button type="button" class="plv-btn ${state.prank.level === lv ? 'is-active' : ''}" data-prank-level="${lv}">${esc(T(`level${lv}`))}</button>`)
              .join('')}
          </div>
        </div>

        <div class="field">
          <label for="prankMsgInput">${esc(T('prankStep4'))}</label>
          <div class="presets" id="prankPresets">
            ${(UI.prankPresets || [])
              .map((p, idx) => `<button type="button" class="preset-btn" data-preset="${idx}">${esc(p.label)}</button>`)
              .join('')}
          </div>
          <input id="prankMsgInput" type="text" maxlength="64" autocomplete="off" value="${esc(state.prank.msg)}">
        </div>

        <div class="url-box">
          <span class="url-label">${esc(T('prankUrlLabel'))}</span>
          <code id="prankUrl">${esc(prankUrl())}</code>
        </div>

        <div class="prank-actions">
          <button class="btn btn-primary" type="button" id="prankCopyBtn">${esc(T('prankCopy'))}</button>
          <button class="btn btn-ghost" type="button" id="prankPreviewBtn">${esc(T('prankPreview'))}</button>
        </div>
        <p class="fineprint">${esc(T('prankNote'))}</p>
      </div>`;

    const sender = $('#prankSenderInput');
    const msg = $('#prankMsgInput');
    sender?.addEventListener('input', () => {
      state.prank.sender = sender.value.slice(0, 32);
      updatePrankUrl();
    });
    msg?.addEventListener('input', () => {
      state.prank.msg = msg.value.slice(0, 64);
      updatePrankUrl();
    });
    $$('#prankDishes [data-prank-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.prank.dish = btn.dataset.prankPick;
        $$('#prankDishes [data-prank-pick]').forEach((b) => b.classList.toggle('is-active', b === btn));
        updatePrankUrl();
      });
    });
    $$('#prankLevels [data-prank-level]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.prank.level = Number(btn.dataset.prankLevel);
        $$('#prankLevels [data-prank-level]').forEach((b) => b.classList.toggle('is-active', b === btn));
        updatePrankUrl();
      });
    });
    $$('#prankPresets [data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = (UI.prankPresets || [])[Number(btn.dataset.preset)];
        if (!preset) return;
        state.prank.msg = preset.text;
        if (msg) msg.value = preset.text;
        updatePrankUrl();
      });
    });
    $('#prankCopyBtn')?.addEventListener('click', copyPrankLink);
    $('#prankPreviewBtn')?.addEventListener('click', () => {
      openFriendPoison({
        sender: state.prank.sender,
        msg: state.prank.msg,
        dish: state.prank.dish,
        level: state.prank.level,
      });
    });
    updatePrankUrl();
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }

  async function copyPrankLink() {
    const ok = await copyText(prankUrl());
    toast(ok ? T('prankCopied') : prankUrl());
  }

  /* ------------------------------------------------------------
     Modals
     ------------------------------------------------------------ */
  function openModal(inner, opts = {}) {
    closeModal(true);
    const root = $('#modalRoot');
    if (!root) return null;
    root.innerHTML = `<div class="modal ${opts.className || ''}" role="dialog" aria-modal="true" data-dismissible="${opts.dismissible === false ? '0' : '1'}">${inner}</div>`;
    document.body.classList.add('modal-open');
    const modal = root.firstElementChild;
    modal.addEventListener('click', (e) => {
      if (e.target.closest('[data-close-modal]')) {
        e.preventDefault();
        closeModal();
        return;
      }
      if (e.target === modal && modal.dataset.dismissible === '1') closeModal();
    });
    const focusable = modal.querySelector('button, input, [tabindex]');
    if (focusable && !opts.noFocus) setTimeout(() => focusable.focus({ preventScroll: true }), 50);
    return modal;
  }

  function closeModal(keepBodyLock = false) {
    const root = $('#modalRoot');
    if (root) root.innerHTML = '';
    if (state.modalCleanup) {
      try {
        state.modalCleanup();
      } catch {
        /* noop */
      }
      state.modalCleanup = null;
    }
    if (!keepBodyLock) document.body.classList.remove('modal-open');
    if (!keepBodyLock) {
      const modal = document.querySelector('.modal');
      if (!modal) document.body.classList.remove('modal-open');
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#modalRoot')?.firstElementChild) {
      const modal = $('#modalRoot').firstElementChild;
      if (modal.dataset.dismissible === '1') closeModal();
    }
  });

  function stopSludge() {
    if (state.modalCleanup) {
      state.modalCleanup();
      state.modalCleanup = null;
    }
  }

  function startSludgeCanvas(canvas, tone = 'sludge') {
    if (!canvas) return () => {};
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let raf = 0;
    let last = 0;
    const points = Array.from({ length: 24 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 6 + Math.random() * 26,
      speed: 0.015 + Math.random() * 0.05,
      wobble: Math.random() * Math.PI * 2,
    }));
    const resize = () => {
      canvas.width = Math.round((canvas.clientWidth || innerWidth) * dpr);
      canvas.height = Math.round((canvas.clientHeight || innerHeight) * dpr);
    };
    resize();
    const frame = (ts) => {
      if (!canvas.isConnected) return;
      if (!last || ts - last > 33) {
        last = ts;
        const w = canvas.width;
        const h = canvas.height;
        const bg = ctx.createRadialGradient(w * 0.5, h * 0.4, 0, w * 0.5, h * 0.55, Math.max(w, h) * 0.8);
        if (tone === 'ambush') {
          bg.addColorStop(0, 'rgba(255, 211, 107, 0.3)');
          bg.addColorStop(1, 'rgba(255, 241, 236, 0)');
        } else {
          bg.addColorStop(0, 'rgba(111, 191, 154, 0.22)');
          bg.addColorStop(1, 'rgba(255, 241, 236, 0)');
        }
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
        for (const p of points) {
          p.y -= p.speed * 0.01;
          if (p.y < -0.1) {
            p.y = 1.1;
            p.x = Math.random();
          }
          const x = (p.x + Math.sin(p.wobble + ts * 0.0004) * 0.015) * w;
          const y = p.y * h;
          const rr = p.r * dpr;
          ctx.beginPath();
          ctx.arc(x, y, rr, 0, Math.PI * 2);
          ctx.strokeStyle = tone === 'ambush' ? 'rgba(232, 182, 76, 0.42)' : 'rgba(111, 191, 154, 0.4)';
          ctx.lineWidth = Math.max(1, dpr * 1.3);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x - rr * 0.25, y - rr * 0.3, rr * 0.3, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.34)';
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const stop = () => {
      cancelAnimationFrame(raf);
    };
    window.addEventListener('resize', resize, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }

  /* ------------------------------------------------------------
     Upload lab
     ------------------------------------------------------------ */
  function openUpload() {
    openModal(
      `<div class="sheet">
        <div class="sheet-head">
          <div><h3>${esc(T('uploadModalTitle'))}</h3><p>${esc(T('uploadDropSub'))}</p></div>
          <button class="icon-x" type="button" data-close-modal aria-label="${esc(T('close'))}">
            <svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>
          </button>
        </div>
        <div class="sheet-body">
          <label class="dropzone">
            <input id="uploadInput" type="file" accept="image/*">
            <strong>${esc(T('uploadDrop'))}</strong>
            <span>${esc(T('uploadDropSub'))}</span>
          </label>
          <div class="upload-preview">
            <canvas id="uploadPreviewCanvas" hidden></canvas>
            <p id="uploadHint">${esc(T('uploadPlaceholder'))}</p>
            <span class="clinical-vignette"></span>
          </div>
          <input class="upload-name" id="uploadNameInput" type="text" maxlength="24" placeholder="${esc(T('uploadNamePlaceholder'))}" value="${esc(T('uploadDefaultName'))}">
          <p class="fineprint" style="margin-top:7px">${esc(T('uploadPrivacy'))}</p>
          <div class="two-actions">
            <button class="btn btn-ghost" type="button" data-close-modal>${esc(T('uploadDone'))}</button>
            <button class="btn btn-primary" type="button" id="uploadPublishBtn" disabled>${esc(T('uploadPublish'))}</button>
          </div>
        </div>
      </div>`,
      { className: 'is-center', dismissible: true }
    );

    const input = $('#uploadInput');
    const preview = $('#uploadPreviewCanvas');
    const hint = $('#uploadHint');
    const nameInput = $('#uploadNameInput');
    const publish = $('#uploadPublishBtn');

    input?.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 15 * 1024 * 1024) {
        toast(T('uploadError'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const source = makeSourceCanvas(img);
          state.pendingUpload = { source, name: nameInput?.value || T('uploadDefaultName') };
          if (preview) {
            preview.hidden = false;
            hint.hidden = true;
            const filtered = filterCanvas(source, state.level, state.palette);
            preview.width = SW;
            preview.height = SH;
            preview.getContext('2d').drawImage(filtered, 0, 0);
          }
          if (publish) publish.disabled = false;
          toast(T('toastUploadReady'));
        };
        img.onerror = () => toast(T('uploadError'));
        img.src = reader.result;
      };
      reader.onerror = () => toast(T('uploadError'));
      reader.readAsDataURL(file);
    });

    publish?.addEventListener('click', () => {
      if (!state.pendingUpload) return;
      const name = (nameInput?.value || T('uploadDefaultName')).trim().slice(0, 24);
      const id = `custom-${Date.now().toString(36)}`;
      state.customDeck.push({
        id,
        name: name || T('uploadDefaultName'),
        sourceCanvas: state.pendingUpload.source,
        votes: { quit: 0, hungry: 0 },
      });
      state.pendingUpload = null;
      closeModal();
      toast(T('toastUploaded'));
      state.voteIndex = DISH_IDS.length + state.customDeck.length - 1;
      renderVote();
      scrollToId('poll');
    });
  }

  /* ------------------------------------------------------------
     Nine-grid fatigue
     ------------------------------------------------------------ */
  function openFatigue(id) {
    const meta = dishMeta(id);
    const custom = state.customDeck.find((d) => d.id === id);
    const name = custom ? custom.name : meta?.name || id;
    openModal(
      `<div class="sheet fatigue-sheet">
        <div class="sheet-head">
          <div><h3>${esc(fmt(T('fatigueTitle'), { name }))}</h3><p>${esc(T('fatigueSub'))}</p></div>
          <button class="icon-x" type="button" data-close-modal aria-label="${esc(T('close'))}">
            <svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>
          </button>
        </div>
        <div class="sheet-body">
          <div class="fatigue-grid" id="fatigueGrid"></div>
          <div class="fatigue-foot">
            <span id="fatigueCountdown">${esc(fmt(T('fatigueCountdown'), { s: 15 }))}</span>
            <button type="button" id="fatigueAudioBtn">${esc(T('fatigueAudio'))}</button>
          </div>
        </div>
      </div>`,
      { className: 'is-center', dismissible: true }
    );

    const grid = $('#fatigueGrid');
    if (!grid) return;
    const filtered = filteredFor(id);
    const tileW = 240;
    const tileH = 180;
    for (let i = 0; i < 9; i++) {
      const c = document.createElement('canvas');
      c.width = tileW;
      c.height = tileH;
      const ctx = c.getContext('2d');
      const scale = 1 + (i % 3) * 0.035;
      const sw = filtered.width / scale;
      const sh = filtered.height / scale;
      const sx = (filtered.width - sw) * (0.5 + ((i % 3) - 1) * 0.12);
      const sy = (filtered.height - sh) * (0.5 + (Math.floor(i / 3) - 1) * 0.1);
      ctx.drawImage(filtered, sx, sy, sw, sh, 0, 0, tileW, tileH);
      grid.appendChild(c);
    }

    let end = performance.now() + 15000;
    let timer = null;
    const tick = () => {
      const remain = Math.max(0, end - performance.now());
      const s = Math.ceil(remain / 1000);
      const el = $('#fatigueCountdown');
      if (el) el.textContent = fmt(T('fatigueCountdown'), { s });
      if (remain <= 0) {
        clearInterval(timer);
        closeModal();
        toast(T('toastFatigueDone'));
      }
    };
    timer = setInterval(tick, 200);
    state.modalCleanup = () => clearInterval(timer);
    $('#fatigueAudioBtn')?.addEventListener('click', () => playAntiSound('styrofoam'));
  }

  /* ------------------------------------------------------------
     Friend poison + checkout ambush + poster
     ------------------------------------------------------------ */
  function parseIncomingPrank() {
    const params = new URLSearchParams(location.search);
    if (params.get('p') !== '1' && params.get('poison') !== '1') return;
    const dish = DISH_IDS.includes(params.get('d')) ? params.get('d') : DISH_IDS[0];
    const level = clamp(Number(params.get('lv')) || 3, 1, 3);
    const sender = (params.get('f') || T('prankSenderDefault')).slice(0, 32);
    const msg = (params.get('m') || T('prankMsgDefault')).slice(0, 80);
    setTimeout(() => openFriendPoison({ sender, msg, dish, level, incoming: true }), 450);
  }

  function openFriendPoison(cfgIn) {
    const cfg = cfgIn || {};
    const dish = DISH_IDS.includes(cfg.dish) ? cfg.dish : DISH_IDS[0];
    const meta = dishMeta(dish);
    const level = clamp(Number(cfg.level) || 3, 1, 3);
    const sender = String(cfg.sender || T('prankSenderDefault')).slice(0, 32);
    const msg = String(cfg.msg || T('prankMsgDefault')).slice(0, 80);

    openModal(
      `<div class="poison-stage">
        <canvas id="friendSludgeCanvas"></canvas>
        <div class="poison-card">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <span class="poison-badge">${esc(fmt(T('fpBadge'), { from: sender }))}</span>
            <button class="icon-x" type="button" data-close-modal aria-label="${esc(T('close'))}" style="width:26px;height:26px">
              <svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>
            </button>
          </div>
          <div class="poison-media">
            <canvas id="poisonCanvas" width="${SW}" height="${SH}"></canvas>
            <span class="clinical-vignette"></span>
            <span class="poison-message">“${esc(msg)}”</span>
          </div>
          <p class="poison-calories">${esc(
            fmt(T('fpCalories'), {
              name: meta?.name || dish,
              kcal: num(meta?.kcal || 0),
              butter: meta?.butter || 0,
            })
          )}</p>
          <div class="poison-actions">
            <button class="btn btn-coral" type="button" id="poisonCounterBtn">${esc(T('fpCounter'))}</button>
            <button class="btn btn-ghost" type="button" id="poisonAcceptBtn">${esc(T('fpAccept'))}</button>
          </div>
        </div>
      </div>`,
      { className: 'is-full', dismissible: false }
    );

    const canvas = $('#poisonCanvas');
    if (canvas) {
      const filtered = filterCanvas(sourceFor(dish), level, state.palette);
      drawInto(canvas, filtered);
    }
    const stopBubbles = startSludgeCanvas($('#friendSludgeCanvas'), 'sludge');
    const robots = document.querySelector('meta[name="robots"]');
    const previousRobots = robots ? robots.content : '';
    if (robots) robots.content = 'noindex, nofollow';
    state.modalCleanup = () => {
      stopBubbles();
      if (robots) robots.content = previousRobots || 'index, follow, max-image-preview:large';
      const query = new URLSearchParams(location.search);
      if (query.get('p') === '1' || query.get('poison') === '1') {
        history.replaceState({}, '', location.pathname);
      }
    };

    $('#poisonCounterBtn')?.addEventListener('click', () => {
      state.prank.dish = dish;
      state.prank.level = level;
      state.prank.sender = T('prankSenderDefault');
      state.prank.msg = T('prankMsgDefault');
      closeModal();
      renderPrank();
      scrollToId('prank');
      toast(T('toastPrankReady'));
      history.replaceState({}, '', location.pathname);
    });
    $('#poisonAcceptBtn')?.addEventListener('click', () => {
      closeModal();
      toast(T('toastWater'));
      history.replaceState({}, '', location.pathname);
    });
  }

  function openAmbush() {
    const root = $('#modalRoot');
    if (!root) return;
    closeModal(true);
    state.lastOrder = (() => {
      const items = Object.entries(state.cart)
        .map(([id, n]) => ({ id, n: Number(n) || 0 }))
        .filter((x) => x.n > 0);
      const names = items.map((x) => `${dishName(x.id)} ×${x.n}`);
      const totals = cartTotals();
      return { items, names, totals };
    })();

    root.innerHTML = `<div class="modal is-full" role="dialog" aria-modal="true" data-dismissible="0">
      <div class="ambush-stage">
        <canvas id="ambushCanvas"></canvas>
        <div class="ambush-card">
          <div class="ambush-badge"><i></i>${esc(T('ambushBadge'))}</div>
          <h2 id="ambushTitle">${esc(T('ambushTitle'))}</h2>
          <p id="ambushDesc">${esc(T('ambushDesc'))}</p>
          <div class="ambush-progress">
            <div class="progress"><i id="ambushBar" style="width:0%"></i></div>
            <div class="ambush-meta">
              <span id="ambushStage">${esc(T('ambushProgress'))}</span>
              <span id="ambushPct">0%</span>
            </div>
          </div>
        </div>
      </div>
    </div>`;
    document.body.classList.add('modal-open');
    const stop = startSludgeCanvas($('#ambushCanvas'), 'ambush');
    const stages = Array.isArray(T('ambushStages')) ? T('ambushStages') : [];
    const start = performance.now();
    const duration = 2700;
    let raf = 0;
    const tick = (ts) => {
      const pct = clamp((ts - start) / duration, 0, 1);
      const bar = $('#ambushBar');
      const label = $('#ambushPct');
      const stage = $('#ambushStage');
      if (bar) bar.style.width = `${pct * 100}%`;
      if (label) label.textContent = `${Math.round(pct * 100)}%`;
      if (stage && stages.length) {
        stage.textContent = stages[Math.min(stages.length - 1, Math.floor(pct * stages.length))];
      }
      if (pct >= 1) {
        stop();
        closeModal(true);
        commitOrder();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    state.modalCleanup = () => {
      stop();
      cancelAnimationFrame(raf);
    };
  }

  function commitOrder() {
    const order = state.lastOrder;
    if (!order) return;
    const saved = state.savings;
    const current = monthKey();
    if (saved.month !== current) {
      saved.month = current;
      saved.currencies = {};
      saved.count = 0;
      saved.kcal = 0;
    }
    const byCurrency = {};
    order.items.forEach(({ id, n }) => {
      const price = META[id]?.price;
      if (!price) return;
      for (const [cur, value] of Object.entries(price)) {
        byCurrency[cur] = (Number(byCurrency[cur]) || 0) + (Number(value) || 0) * n;
      }
    });
    for (const [cur, value] of Object.entries(byCurrency)) {
      saved.currencies[cur] = (Number(saved.currencies[cur]) || 0) + value;
    }
    saved.count += 1;
    saved.kcal += order.totals.kcal;
    saved.lifetimeCount += 1;
    store.set(LS.savings, saved);
    clearCart();
    renderSavings();
    openPoster(order);
  }

  async function openPoster(order) {
    if (!order) return;
    try {
      await document.fonts.ready;
    } catch {
      /* noop */
    }
    const dataUrl = drawPoster(order);
    if (!dataUrl) return;
    state.posterDataUrl = dataUrl;
    const cleaned = order.names.slice(0, 3).join(' · ') + (order.names.length > 3 ? ' · …' : '');
    const advice = (state.lastAdvice || T('posterDefaultAdvice')).slice(0, 96);

    openModal(
      `<div class="poster-wrap">
        <div class="poster-head">
          <p>${esc(T('posterHint'))}</p>
          <button class="icon-x" type="button" data-close-modal aria-label="${esc(T('close'))}">
            <svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>
          </button>
        </div>
        <div class="poster-image"><img id="posterImg" src="${dataUrl}" alt="${esc(T('posterHeader'))}"></div>
        <div class="poster-actions">
          <button class="btn btn-primary" type="button" id="posterDanmakuBtn">${esc(T('posterDanmaku'))}</button>
          <button class="btn btn-ghost" type="button" id="posterDoneBtn">${esc(T('posterDone'))}</button>
        </div>
        <div class="poster-actions" style="grid-template-columns:1fr;margin-top:6px">
          <button class="btn btn-ghost" type="button" id="posterDownloadBtn" style="height:36px">${esc(T('posterDownload'))}</button>
        </div>
      </div>`,
      { className: 'is-poster', dismissible: true }
    );

    $('#posterDanmakuBtn')?.addEventListener('click', () => {
      const prefix = T('danmakuPrefix');
      state.lastAdvice = advice;
      if (Array.isArray(UI.danmakuPool)) UI.danmakuPool.unshift(advice);
      if (!state.danmaku) {
        state.danmaku = true;
        updateDanmakuButton();
        savePrefs();
      }
      spawnDanmaku(`${prefix}${advice}`, '#34d399');
      closeModal();
      toast(T('toastPosted'));
    });
    $('#posterDoneBtn')?.addEventListener('click', () => {
      closeModal();
      toast(T('toastSaved'));
    });
    $('#posterDownloadBtn')?.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `anti-crave-poster-${today()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast(T('toastSaved'));
    });
  }

  /* ------------------------------------------------------------
     Poster canvas
     ------------------------------------------------------------ */
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function wrapLines(ctx, text, maxWidth) {
    const tokens = String(text).match(/[A-Za-z0-9'’\-]+|\s+|./gu) || [];
    const lines = [];
    let line = '';
    for (const token of tokens) {
      const test = line + token;
      if (ctx.measureText(test).width > maxWidth && line.trim()) {
        lines.push(line.trimEnd());
        line = token.trimStart();
      } else {
        line = test;
      }
    }
    if (line.trim()) lines.push(line.trim());
    return lines;
  }

  const CJK_FONT = '"PingFang SC", "Hiragino Sans", "Apple SD Gothic Neo", "Microsoft YaHei", "Malgun Gothic", sans-serif';
  const POSTER_LATIN = 'Nunito, "Segoe UI", Arial, sans-serif';

  function drawPoster(order) {
    const c = document.createElement('canvas');
    c.width = 1080;
    c.height = 1440;
    const ctx = c.getContext('2d');
    const W = c.width;
    const H = c.height;

    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#FFF9F5');
    bg.addColorStop(0.55, '#FFF1EC');
    bg.addColorStop(1, '#FFE9E2');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(W * 0.18, 0, 0, W * 0.18, 0, W * 0.82);
    glow.addColorStop(0, 'rgba(242, 92, 84, 0.14)');
    glow.addColorStop(1, 'rgba(242, 92, 84, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(67, 48, 58, 0.06)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y < H; y += 60) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = '#D8443D';
    ctx.font = `800 24px ${POSTER_LATIN}`;
    ctx.fillText('ANTI-CRAVE LAB', 72, 80);

    ctx.fillStyle = '#9A7C84';
    ctx.font = `600 20px ${POSTER_LATIN}`;
    ctx.textAlign = 'right';
    ctx.fillText(
      new Intl.DateTimeFormat(LOCALE, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date()),
      W - 72,
      80
    );
    ctx.textAlign = 'left';

    ctx.fillStyle = '#F25C54';
    ctx.font = `900 132px ${POSTER_LATIN}`;
    ctx.fillText('Rx', 70, 226);

    ctx.fillStyle = '#43303A';
    ctx.font = `900 42px ${POSTER_LATIN}, ${CJK_FONT}`;
    ctx.fillText(T('posterHeader'), 72, 286);

    ctx.strokeStyle = 'rgba(242, 92, 84, 0.55)';
    ctx.lineWidth = 5;
    ctx.save();
    ctx.translate(862, 198);
    ctx.rotate(-0.18);
    ctx.beginPath();
    ctx.arc(0, 0, 106, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 91, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(242, 92, 84, 0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#D8443D';
    ctx.font = `900 30px ${POSTER_LATIN}, ${CJK_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(String(T('posterStamp')).slice(0, 10), 0, 10);
    ctx.restore();

    ctx.strokeStyle = 'rgba(67, 48, 58, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(72, 330);
    ctx.lineTo(W - 72, 330);
    ctx.stroke();

    ctx.fillStyle = '#9A7C84';
    ctx.font = `700 20px ${POSTER_LATIN}, ${CJK_FONT}`;
    ctx.fillText(T('posterThisOrder'), 72, 386);

    const saved = state.savings;
    const monthMoney = saved.currencies?.[CURRENCY] || 0;
    const rank = Math.max(35, Math.min(99, 42 + (saved.count || 0) * 7));
    const stats = [
      { label: T('posterStatKcal'), value: `${num(order.totals.kcal)} kcal` },
      { label: T('posterStatMoney'), value: money(order.totals.money) },
      { label: T('posterStatMonth'), value: money(monthMoney) },
      { label: T('posterStatRank'), value: `${rank}%` },
    ];

    stats.forEach((stat, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 72 + col * 480;
      const y = 410 + row * 162;
      roundRect(ctx, x, y, 456, 142, 18);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(244, 218, 208, 0.9)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#43303A';
      ctx.font = `800 46px ${POSTER_LATIN}, ${CJK_FONT}`;
      ctx.fillText(stat.value, x + 24, y + 76);
      ctx.fillStyle = '#9A7C84';
      ctx.font = `600 19px ${POSTER_LATIN}, ${CJK_FONT}`;
      ctx.fillText(stat.label, x + 24, y + 112);
    });

    ctx.fillStyle = '#9A7C84';
    ctx.font = `600 24px ${POSTER_LATIN}, ${CJK_FONT}`;
    const blocked = order.names.slice(0, 3).join(' · ') + (order.names.length > 3 ? ' · …' : '');
    const blockedText = fmt(T('posterDefeated'), { name: blocked });
    const blockedLines = wrapLines(ctx, blockedText, W - 144).slice(0, 2);
    blockedLines.forEach((line, i) => {
      ctx.fillText(line, 72, 790 + i * 34);
    });

    const quoteY = 858;
    roundRect(ctx, 72, quoteY, W - 144, 192, 20);
    ctx.fillStyle = 'rgba(226, 243, 235, 0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(111, 191, 154, 0.5)';
    ctx.stroke();
    ctx.fillStyle = '#4F9E7C';
    ctx.font = `800 19px ${POSTER_LATIN}, ${CJK_FONT}`;
    ctx.fillText(T('posterQuoteLabel').toUpperCase(), 100, quoteY + 42);
    ctx.fillStyle = '#43303A';
    ctx.font = `600 31px ${POSTER_LATIN}, ${CJK_FONT}`;
    const advice = state.lastAdvice || T('posterDefaultAdvice');
    const qLines = wrapLines(ctx, advice, W - 200).slice(0, 3);
    qLines.forEach((line, i) => ctx.fillText(line, 100, quoteY + 96 + i * 42));

    const qrSize = 190;
    const qrX = W - 72 - qrSize;
    const qrY = 1104;
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, qrX - 12, qrY - 12, qrSize + 24, qrSize + 24, 12);
    ctx.fill();
    drawQRCode(ctx, `${APP_URL}?ref=poster`, qrX, qrY, qrSize);

    ctx.fillStyle = '#43303A';
    ctx.font = `900 30px ${POSTER_LATIN}, ${CJK_FONT}`;
    const qrTitleLines = wrapLines(ctx, T('posterQrTitle'), 600).slice(0, 2);
    qrTitleLines.forEach((line, i) => ctx.fillText(line, 72, 1138 + i * 36));
    ctx.fillStyle = '#9A7C84';
    ctx.font = `600 21px ${POSTER_LATIN}, ${CJK_FONT}`;
    const subLines = wrapLines(ctx, T('posterQrSub'), 620).slice(0, 3);
    subLines.forEach((line, i) => ctx.fillText(line, 72, 1222 + i * 30));
    ctx.fillStyle = '#D8443D';
    ctx.font = `700 20px ${POSTER_LATIN}, ${CJK_FONT}`;
    ctx.fillText(T('posterNoPills'), 72, 1318);

    ctx.strokeStyle = 'rgba(67, 48, 58, 0.16)';
    ctx.beginPath();
    ctx.moveTo(72, 1358);
    ctx.lineTo(W - 72, 1358);
    ctx.stroke();
    ctx.fillStyle = '#B7A0A7';
    ctx.font = `600 18px ${POSTER_LATIN}`;
    ctx.fillText(`${ORIGIN.replace(/^https?:\/\//, '')}${CFG.path}`, 72, 1392);
    ctx.textAlign = 'right';
    ctx.fillText('VISUAL APPETITE SUPPRESSANT SIMULATOR', W - 72, 1392);
    ctx.textAlign = 'left';

    try {
      return c.toDataURL('image/png');
    } catch {
      return '';
    }
  }

  /* ------------------------------------------------------------
     QR (ISO/IEC 18004, byte mode, EC level L, mask 0)
     ------------------------------------------------------------ */
  function qrMatrix(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    const versions = [null, [26, 19, 7], [44, 34, 10], [70, 55, 15], [100, 80, 20], [134, 108, 26]];
    let ver = 1;
    while (ver < 5 && bytes.length + 2 > versions[ver][1]) ver++;
    const [, dataCW, ecCW] = versions[ver];
    const payload = bytes.slice(0, dataCW - 2);

    const bits = [];
    const push = (val, len) => {
      for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
    };
    push(4, 4);
    push(payload.length, 8);
    payload.forEach((b) => push(b, 8));
    push(0, Math.min(4, dataCW * 8 - bits.length));
    while (bits.length % 8 !== 0) bits.push(0);

    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      codewords.push(v);
    }
    const pads = [0xec, 0x11];
    let pi = 0;
    while (codewords.length < dataCW) codewords.push(pads[pi++ % 2]);

    const exp = new Uint8Array(512);
    const log = new Uint8Array(256);
    let v = 1;
    for (let i = 0; i < 255; i++) {
      exp[i] = v;
      log[v] = i;
      v <<= 1;
      if (v & 0x100) v ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
    const mul = (a, b) => (a === 0 || b === 0 ? 0 : exp[log[a] + log[b]]);

    let poly = [1];
    for (let i = 0; i < ecCW; i++) {
      const next = new Array(poly.length + 1).fill(0);
      const factor = exp[i];
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= mul(poly[j], factor);
      }
      poly = next;
    }

    const msg = codewords.concat(new Array(ecCW).fill(0));
    for (let i = 0; i < dataCW; i++) {
      const coef = msg[i];
      if (coef !== 0) {
        for (let j = 0; j < poly.length; j++) msg[i + j] ^= mul(poly[j], coef);
      }
    }
    const final = codewords.concat(msg.slice(dataCW));

    const size = 17 + ver * 4;
    const mat = Array.from({ length: size }, () => new Array(size).fill(0));
    const func = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (r, c, val) => {
      if (r >= 0 && r < size && c >= 0 && c < size) {
        mat[r][c] = val ? 1 : 0;
        func[r][c] = true;
      }
    };

    const finder = (r0, c0) => {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
          const border = r === 0 || r === 6 || c === 0 || c === 6;
          const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          set(r0 + r, c0 + c, inOuter && (border || core));
        }
      }
    };
    finder(0, 0);
    finder(0, size - 7);
    finder(size - 7, 0);

    if (ver >= 2) {
      const ac = size - 7;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          set(ac + r, ac + c, Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0));
        }
      }
    }

    for (let i = 8; i < size - 8; i++) {
      set(6, i, i % 2 === 0);
      set(i, 6, i % 2 === 0);
    }
    for (let i = 0; i <= 8; i++) {
      if (i !== 6) {
        func[8][i] = true;
        func[i][8] = true;
      }
    }
    for (let i = 0; i < 8; i++) {
      func[8][size - 1 - i] = true;
      func[size - 1 - i][8] = true;
    }
    set(size - 8, 8, 1);

    const dataBits = [];
    final.forEach((cw) => {
      for (let i = 7; i >= 0; i--) dataBits.push((cw >> i) & 1);
    });
    let bi = 0;
    let up = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (let i = 0; i < size; i++) {
        const r = up ? size - 1 - i : i;
        for (let dc = 0; dc < 2; dc++) {
          const c = col - dc;
          if (!func[r][c]) {
            let bit = bi < dataBits.length ? dataBits[bi++] : 0;
            if ((r + c) % 2 === 0) bit ^= 1;
            mat[r][c] = bit;
          }
        }
      }
      up = !up;
    }

    const format = 0x77c4;
    const fb = [];
    for (let i = 14; i >= 0; i--) fb.push((format >> i) & 1);
    const hc = [0, 1, 2, 3, 4, 5, 7, 8, size - 8, size - 7, size - 6, size - 5, size - 4, size - 3, size - 2];
    const vc = [size - 1, size - 2, size - 3, size - 4, size - 5, size - 6, size - 7, 8, 7, 5, 4, 3, 2, 1, 0];
    for (let i = 0; i < 15; i++) {
      mat[8][hc[i]] = fb[i];
      mat[vc[i]][8] = fb[i];
    }

    return mat;
  }

  function drawQRCode(ctx, text, x, y, size) {
    const mat = qrMatrix(text);
    const n = mat.length;
    const quiet = 2;
    const total = n + quiet * 2;
    const cell = size / total;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = '#43303A';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (mat[r][c]) {
          ctx.fillRect(
            Math.floor(x + (c + quiet) * cell),
            Math.floor(y + (r + quiet) * cell),
            Math.ceil(cell),
            Math.ceil(cell)
          );
        }
      }
    }
  }

  /* ------------------------------------------------------------
     Page navigation + peek
     ------------------------------------------------------------ */
  function scrollToId(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function bindPeek() {
    const btn = $('#peekBtn');
    if (!btn) return;
    const start = (e) => {
      e.preventDefault();
      state.peeking = true;
      btn.classList.add('is-pressed');
      redrawAll();
    };
    const stop = () => {
      if (!state.peeking) return;
      state.peeking = false;
      btn.classList.remove('is-pressed');
      redrawAll();
    };
    btn.addEventListener('pointerdown', start);
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointercancel', stop);
    btn.addEventListener('pointerleave', stop);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function bindLangMenu() {
    const btn = $('#langBtn');
    const menu = $('#langMenu');
    if (!btn || !menu) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      btn.setAttribute('aria-expanded', String(!menu.hidden));
    });
    document.addEventListener('click', (e) => {
      if (menu.hidden) return;
      if (!e.target.closest('.lang-wrap')) {
        menu.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ------------------------------------------------------------
     Wiring
     ------------------------------------------------------------ */
  function bindGlobal() {
    const year = $('#year');
    if (year) year.textContent = String(new Date().getFullYear());

    try {
      if (sessionStorage.getItem('anticrave:ticker') === '0') $('#ticker')?.remove();
    } catch {
      /* noop */
    }
    $('#tickerClose')?.addEventListener('click', () => {
      $('#ticker')?.remove();
      try {
        sessionStorage.setItem('anticrave:ticker', '0');
      } catch {
        /* noop */
      }
    });

    $('#headerStartBtn')?.addEventListener('click', () => scrollToId('menu'));
    $('#heroStartBtn')?.addEventListener('click', () => scrollToId('menu'));
    $('#heroSearchForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      scrollToId('menu');
    });
    $('#heroSearch')?.addEventListener('input', (e) => setSearch(e.target.value));
    $('#dishSearch')?.addEventListener('input', (e) => setSearch(e.target.value));

    $('#checkinBtn')?.addEventListener('click', handleCheckin);
    $('#soundBtn')?.addEventListener('click', toggleSound);
    $('#danmakuBtn')?.addEventListener('click', toggleDanmaku);
    $('#uploadBtn')?.addEventListener('click', openUpload);
    $('#cartClearBtn')?.addEventListener('click', () => {
      clearCart();
      toast(T('cartEmpty'));
    });
    $('#checkoutBtn')?.addEventListener('click', () => {
      if (!cartTotals().items) {
        toast(T('toastCartEmpty'));
        return;
      }
      AudioLab.ensure();
      openAmbush();
    });

    bindPeek();
    bindLangMenu();

    const currencyBtn = $('#currencyBtn');
    const currencyMenu = $('#currencyMenu');
    currencyBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!currencyMenu) return;
      currencyMenu.hidden = !currencyMenu.hidden;
      currencyBtn.setAttribute('aria-expanded', String(!currencyMenu.hidden));
    });
    currencyMenu?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-currency]');
      if (btn) setCurrency(btn.dataset.currency);
    });
    document.addEventListener('click', (e) => {
      if (!currencyMenu || currencyMenu.hidden) return;
      if (!e.target.closest('.currency-wrap')) {
        currencyMenu.hidden = true;
        currencyBtn?.setAttribute('aria-expanded', 'false');
      }
    });

    $('#levelTabs')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-level]');
      if (!btn) return;
      if (state.challenge.active) return;
      setLevel(Number(btn.dataset.level));
    });

    $('#controlDeck')?.addEventListener('click', (e) => {
      const palette = e.target.closest('[data-palette]');
      if (palette) {
        setPalette(palette.dataset.palette);
        return;
      }
      const sound = e.target.closest('[data-sound]');
      if (sound) playAntiSound(sound.dataset.sound);
    });

    $('#controlDeck')?.addEventListener('submit', (e) => {
      if (!e.target.closest('#danmakuForm')) return;
      e.preventDefault();
      const input = $('#danmakuInput');
      if (!input) return;
      if (submitDanmaku(input.value)) {
        input.value = '';
        toast(T('danmakuSubmit'));
      }
    });

    $('#dishList')?.addEventListener('click', (e) => {
      const add = e.target.closest('[data-add-cart]');
      if (add) {
        addToCart(add.dataset.addCart);
        return;
      }
      const prank = e.target.closest('[data-prank-dish]');
      if (prank) {
        state.prank.dish = prank.dataset.prankDish;
        renderPrank();
        scrollToId('prank');
        toast(T('toastPrankReady'));
        return;
      }
      const fatigue = e.target.closest('[data-fatigue]');
      if (fatigue) {
        openFatigue(fatigue.dataset.fatigue);
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshStats();
    });

    setInterval(() => {
      if (!document.hidden) refreshStats();
    }, 120000);
  }

  async function init() {
    renderControls();
    bindGlobal();
    updateCurrencyButton();
    renderCategories();
    renderSavings();
    renderDishList();
    renderVoteHead();
    renderVote();
    renderPrank();
    updatePulseText();
    updateCartUI();
    startDanmakuLoop();
    parseIncomingPrank();
    preloadSources();
    refreshStats(true);
    document.body.classList.add('is-ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
