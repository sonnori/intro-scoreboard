import { json, body } from './_store.mjs';
import { check, setCookie } from './_auth.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method ไม่รองรับ' });
  const { password } = await body(req);
  const token = check(password);
  if (!token) return json(res, 403, { error: 'รหัสไม่ถูกต้อง' });
  return json(res, 200, { authed: true }, { 'set-cookie': setCookie(token) });
}
