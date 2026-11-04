import { read, write, json, body, newId } from './_store.mjs';
import { authed } from './_auth.mjs';

/**
 * The player database. One endpoint for the whole thing so a caller never has
 * to reconcile two lists that changed in different requests — every action
 * answers with the complete database.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method ไม่รองรับ' });
  if (!authed(req)) return json(res, 401, { error: 'ต้องปลดล็อกก่อน' });

  const db = await read();
  let cast = db.cast || [];
  let hidden = db.hidden || [];
  const { action, name, photo, id } = await body(req);

  if (action === 'add') {
    const clean = (name || '').trim();
    if (!clean) return json(res, 400, { error: 'ต้องมีชื่อ' });
    const at = cast.findIndex((p) => p.name === clean);
    // The same name again is a correction, not a second person.
    cast =
      at === -1
        ? [...cast, { id: newId('C'), name: clean, photo: photo || '', addedAt: Date.now() }]
        : cast.map((p, i) => (i === at ? { ...p, photo: photo || p.photo } : p));
    hidden = hidden.filter((h) => h !== clean);
  } else if (action === 'remove') {
    cast = cast.filter((p) => p.id !== id);
  } else if (action === 'hide') {
    const clean = (name || '').trim();
    if (clean && !hidden.includes(clean)) hidden = [...hidden, clean];
  } else if (action === 'unhideAll') {
    hidden = [];
  } else {
    return json(res, 400, { error: 'action ไม่ถูกต้อง' });
  }

  const saved = await write({ ...db, cast, hidden });
  return json(res, 200, { cast: saved.cast, hidden: saved.hidden });
}
