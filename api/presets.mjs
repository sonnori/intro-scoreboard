import { read, write, json, body, newId } from './_store.mjs';
import { authed } from './_auth.mjs';

/**
 * Build a stored preset from whatever the client sent.
 *
 * The fields are listed rather than spread so a caller can't overwrite `id` or
 * `createdAt` — but the list is the whole record, so forgetting one loses it
 * silently. `mode` and `solo` were missing, which is why a saved solo line-up
 * came back empty.
 */
const presetFrom = ({ id, name, mode, teams, rules, solo }) => ({
  id,
  name: name.trim(),
  mode: mode === 'solo' ? 'solo' : 'team',
  teams,
  rules,
  solo: Array.isArray(solo) ? solo : [],
  createdAt: Date.now(),
});

export default async function handler(req, res) {
  if (!authed(req)) return json(res, 401, { error: 'ต้องปลดล็อกก่อน' });
  const db = await read();

  if (req.method === 'POST') {
    const { name, mode, teams, rules, solo } = await body(req);
    if (!name?.trim()) return json(res, 400, { error: 'ต้องตั้งชื่อ preset' });
    const preset = presetFrom({ id: newId('P'), name, mode, teams, rules, solo });
    const saved = await write({ ...db, presets: [...db.presets, preset] });
    // The full list, so the caller assigns instead of appending and can't duplicate.
    return json(res, 200, { preset, presets: saved.presets });
  }

  if (req.method === 'DELETE') {
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    const next = db.presets.filter((p) => p.id !== id);
    if (next.length === db.presets.length) return json(res, 404, { error: 'ไม่พบ preset' });
    const saved = await write({ ...db, presets: next });
    return json(res, 200, { ok: true, presets: saved.presets });
  }

  return json(res, 405, { error: 'method ไม่รองรับ' });
}
