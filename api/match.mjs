import { read, write, json, body } from './_store.mjs';
import { authed } from './_auth.mjs';

export default async function handler(req, res) {
  if (req.method !== 'PUT') return json(res, 405, { error: 'method ไม่รองรับ' });
  if (!authed(req)) return json(res, 401, { error: 'ต้องปลดล็อกก่อน' });

  const match = await body(req);
  if (!match?.teams?.a || !match?.teams?.b) return json(res, 400, { error: 'รูปแบบไม่ถูกต้อง' });

  const db = await read();
  const saved = await write({ ...db, match });
  return json(res, 200, { ok: true, version: saved.version });
}
