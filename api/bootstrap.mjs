import { read, json, hasStore } from './_store.mjs';
import { authed } from './_auth.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method ไม่รองรับ' });
  const db = await read();
  return json(res, 200, {
    match: db.match,
    presets: db.presets,
    version: db.version || 0,
    authed: authed(req),
    // Surfaced so the board can warn instead of silently drifting out of sync.
    degraded: !hasStore,
  });
}
