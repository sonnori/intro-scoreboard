import { json } from './_store.mjs';
import { COOKIE } from './_auth.mjs';

export default async function handler(req, res) {
  return json(res, 200, { authed: false }, {
    'set-cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`,
  });
}
