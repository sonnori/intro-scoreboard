import { read, write, json, body } from './_store.mjs';
import { authed } from './_auth.mjs';

/**
 * Scores change on every tap; rosters and photos almost never. Taking just the
 * numbers keeps a tap at a few hundred bytes instead of re-posting every avatar
 * in the match.
 */
export default async function handler(req, res) {
  if (req.method !== 'PATCH') return json(res, 405, { error: 'method ไม่รองรับ' });
  if (!authed(req)) return json(res, 401, { error: 'ต้องปลดล็อกก่อน' });

  const { scores } = await body(req);
  if (!scores || typeof scores !== 'object') return json(res, 400, { error: 'รูปแบบไม่ถูกต้อง' });

  const db = await read();
  const match = db.match;
  for (const list of [match.teams.a.players, match.teams.b.players, match.solo?.players || []]) {
    for (const player of list) {
      const next = scores[player.id];
      if (Number.isFinite(next)) player.points = Math.max(0, Math.trunc(next));
    }
  }
  const saved = await write({ ...db, match });
  return json(res, 200, { ok: true, version: saved.version });
}
