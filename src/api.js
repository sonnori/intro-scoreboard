/**
 * Where the board keeps its data.
 *
 * Two backends behind one interface. On a studio server it talks to the API
 * and follows live updates; if that server can't be reached — the standalone
 * file, a dead network on shoot day — it silently falls back to this browser's
 * own storage and keeps working. The board never stops because of the network.
 */

const KEY = {
  match: 'intro-scoreboard/v3',
  presets: 'intro-scoreboard/presets',
};

const CLIENT_ID = Math.random().toString(36).slice(2, 10);

export const api = {
  mode: 'local',
  authed: true,
  live: 'push', // 'push' = SSE, 'poll' = version polling (serverless)
  degraded: false,
};

const local = {
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
      /* out of quota — the match keeps running from memory */
    }
  },
};

async function call(path, { method = 'GET', body, raw, type } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      'x-client-id': CLIENT_ID,
      ...(raw ? { 'content-type': type } : body ? { 'content-type': 'application/json' } : {}),
    },
    body: raw || (body ? JSON.stringify(body) : undefined),
  });
  if (res.status === 401) {
    api.authed = false;
    throw new Error('ต้องปลดล็อกก่อน');
  }
  // A dev server or proxy will happily answer /api/* with the SPA's index.html
  // and a 200. Without this check the board would mistake that for a real
  // backend and lock itself out of a match it could have run offline.
  if (!res.headers.get('content-type')?.includes('application/json')) {
    throw new Error('ไม่ใช่ API ของกระดาน');
  }
  const data = await res.json().catch(() => null);
  if (!data) throw new Error('คำตอบจาก server อ่านไม่ได้');
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ── boot ──────────────────────────────────────────────── */

export async function bootstrap(defaults) {
  try {
    const data = await call('/api/bootstrap');
    if (!data.match?.teams?.a) throw new Error('รูปแบบข้อมูลไม่ถูกต้อง');
    api.mode = 'server';
    api.authed = Boolean(data.authed);
    api.degraded = Boolean(data.degraded);
    return { match: data.match, presets: data.presets || [] };
  } catch {
    api.mode = 'local';
    api.authed = true;
    return {
      match: local.get(KEY.match, null) || defaults(),
      presets: local.get(KEY.presets, []),
    };
  }
}

/* ── live match ────────────────────────────────────────── */

let saveTimer;
let pending = null;

export function saveMatch(match) {
  if (api.mode === 'local') {
    local.set(KEY.match, match);
    return;
  }
  pending = match;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const payload = pending;
    pending = null;
    try {
      await call('/api/match', { method: 'PUT', body: payload });
    } catch (e) {
      // Losing the server mid-show must not lose the score.
      local.set(KEY.match, payload);
      onError?.(e.message);
    }
  }, 250);
}

let onError = null;
export function onSaveError(fn) {
  onError = fn;
}

/**
 * Live updates from other screens.
 *
 * The studio server pushes over SSE — instant, which is what a broadcast wants.
 * Serverless hosts can't hold a connection open, so if that stream fails the
 * board drops to polling a tiny version counter and only refetches the match
 * when the number moves.
 */
export function subscribe(handlers) {
  if (api.mode !== 'server') return;

  let live = false;

  if (typeof EventSource !== 'undefined') {
    const source = new EventSource('/api/events');
    source.onopen = () => {
      live = true;
    };
    source.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === 'match' && msg.from === CLIENT_ID) return; // our own echo
      handlers[msg.type]?.(msg);
    };
    source.onerror = () => {
      source.close();
      if (!live) startPolling(handlers);
    };
  } else {
    startPolling(handlers);
  }
}

let polling = false;

function startPolling(handlers, everyMs = 1200) {
  if (polling) return;
  polling = true;
  api.live = 'poll';
  let seen = -1;
  let busy = false;

  setInterval(async () => {
    // Our own pending write would come back as a change and undo local edits.
    if (busy || pending) return;
    busy = true;
    try {
      const { version } = await call('/api/version');
      if (version !== seen) {
        const first = seen === -1;
        seen = version;
        if (!first) {
          const data = await call('/api/bootstrap');
          handlers.match?.({ match: data.match });
          handlers.presets?.({ presets: data.presets || [] });
        }
      }
    } catch {
      /* a blip: try again on the next tick */
    } finally {
      busy = false;
    }
  }, everyMs);
}

/* ── control access ────────────────────────────────────── */

export async function login(password) {
  if (api.mode === 'local') return true;
  await call('/api/login', { method: 'POST', body: { password } });
  api.authed = true;
  return true;
}

export async function logout() {
  if (api.mode === 'local') return;
  await call('/api/logout', { method: 'POST' });
  api.authed = false;
}

/* ── presets ───────────────────────────────────────────── */

export async function savePreset(preset, presets) {
  if (api.mode === 'local') {
    const created = { id: `P${Date.now().toString(36)}`, createdAt: Date.now(), ...preset };
    const next = [...presets, created];
    local.set(KEY.presets, next);
    return next;
  }
  const { presets: next } = await call('/api/presets', { method: 'POST', body: preset });
  return next;
}

export async function deletePreset(id, presets) {
  if (api.mode === 'local') {
    const next = presets.filter((p) => p.id !== id);
    local.set(KEY.presets, next);
    return next;
  }
  // Query string rather than a path segment: serverless routing maps one file
  // per endpoint, so /api/presets/:id would need a second function for nothing.
  const { presets: next } = await call(`/api/presets?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  return next;
}
