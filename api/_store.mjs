/**
 * Storage for the serverless deployment.
 *
 * Vercel gives a function a read-only filesystem and no memory that survives
 * between requests, so the studio server's db.json can't come along. State
 * lives in Redis instead, reached over its REST API so there's no package to
 * install and nothing to keep warm.
 *
 * Without a store configured it falls back to per-instance memory: the board
 * still runs, but two devices may land on different instances and drift. The
 * API says so plainly in `degraded` rather than pretending to be in sync.
 */

/**
 * Find the Redis REST credentials whatever the host decided to call them.
 *
 * Vercel's docs don't fix the variable names, and a connection with a custom
 * prefix renames them again (DB1_REST_API_URL and friends). Rather than guess
 * two spellings and silently fall back to memory, pair up any *_REST_API_URL
 * with its matching token.
 */
function findCredentials(env) {
  const known = [
    ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
    ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
    ['REDIS_REST_API_URL', 'REDIS_REST_API_TOKEN'],
  ];
  for (const [u, t] of known) if (env[u] && env[t]) return { url: env[u], token: env[t], via: u };

  for (const name of Object.keys(env)) {
    if (!name.endsWith('_REST_API_URL')) continue;
    const token = `${name.slice(0, -'_URL'.length)}_TOKEN`;
    if (env[name] && env[token]) return { url: env[name], token: env[token], via: name };
  }
  return null;
}

const creds = findCredentials(process.env);
const URL_ = creds?.url;
const TOKEN = creds?.token;
const KEY = 'scoreboard:db';

export const hasStore = Boolean(URL_ && TOKEN);
export const storeVia = creds?.via || null;

/**
 * The host we're talking to, so a swapped-out database is visible at a glance.
 * The hostname identifies which Upstash database this is; the token, which is
 * the actual secret, is never exposed.
 */
export const storeHost = (() => {
  try {
    return URL_ ? new URL(URL_).host : null;
  } catch {
    return null;
  }
})();

export function blank() {
  return {
    version: 0,
    match: {
      matchNo: 1,
      sound: true,
      mode: 'team',
      rules: { target: 15, deuce: true, cap: 0, track: false },
      teams: {
        a: { name: 'ทีมชาวบ้าน', color: '#3B6BFF', players: [] },
        b: { name: 'ทีมศิลปิน', color: '#FF4438', players: [] },
      },
      solo: { players: [] },
    },
    presets: [],
    // The player database: people added in the app, plus folder photos removed
    // from the list. Outlives any single match.
    cast: [],
    hidden: [],
  };
}

let memory = null;

async function redis(command) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  const { result } = await res.json();
  return result;
}

export async function read() {
  if (!hasStore) return (memory ??= blank());
  try {
    const raw = await redis(['GET', KEY]);
    return raw ? { ...blank(), ...JSON.parse(raw) } : blank();
  } catch {
    return (memory ??= blank());
  }
}

/** Bumps `version` so pollers can tell something changed without refetching all of it. */
export async function write(db) {
  const next = { ...db, version: (db.version || 0) + 1 };
  memory = next;
  if (hasStore) await redis(['SET', KEY, JSON.stringify(next)]);
  return next;
}

/**
 * A read-only look at the store, for when the board comes up empty.
 *
 * `read()` swallows every failure and hands back a blank match, so "somebody
 * deleted the data" and "we can't reach the database at all" look identical
 * from the outside — and they call for opposite responses. This reports the
 * raw answer instead: whether the key is there, how big it is, how many keys
 * the database holds, and any error verbatim. It never writes, because a write
 * on a store that is merely unreachable would destroy the very data in doubt.
 */
export async function inspect() {
  if (!hasStore) return { configured: false };
  const out = { configured: true, host: storeHost, key: KEY };

  try {
    const raw = await redis(['GET', KEY]);
    out.keyExists = raw !== null && raw !== undefined;
    out.bytes = raw ? raw.length : 0;
    if (raw) {
      try {
        const doc = JSON.parse(raw);
        out.version = doc.version ?? null;
        out.holds = {
          cast: doc.cast?.length ?? 0,
          presets: doc.presets?.length ?? 0,
          soloPlayers: doc.match?.solo?.players?.length ?? 0,
          teamPlayers: (doc.match?.teams?.a?.players?.length ?? 0) + (doc.match?.teams?.b?.players?.length ?? 0),
        };
      } catch (e) {
        out.parseError = e.message;
      }
    }
  } catch (e) {
    out.readError = e.message;
  }

  // How many keys the database holds at all: separates "our key was deleted"
  // from "this is a brand new, empty database".
  try {
    out.keysInDatabase = await redis(['DBSIZE']);
  } catch (e) {
    out.dbsizeError = e.message;
  }

  return out;
}

export function newId(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const json = (res, status, body, headers = {}) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
};

export async function body(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
