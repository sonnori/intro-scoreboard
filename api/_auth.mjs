/**
 * Same shared-password idea as the studio server, minus the filesystem.
 *
 * The signing secret is derived from the password itself, so every instance
 * agrees on what a valid cookie looks like without any shared state — and a
 * redeploy doesn't sign the operator out mid-taping.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE = 'sb_control';

// Falls back to the same code the static build uses, so turning the API on
// without setting the env var leaves the board locked rather than wide open.
const password = () => (process.env.SCOREBOARD_PASSWORD || '123455').trim();

const tokenFor = (pw) => createHmac('sha256', `scoreboard:${pw}`).update('control').digest('hex');

const same = (a, b) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** No password set means the board is open — say so instead of locking everyone out. */
export const isOpen = () => password() === '';

export function check(given) {
  if (isOpen()) return tokenFor('');
  if (typeof given !== 'string' || !given) return null;
  return same(tokenFor(given), tokenFor(password())) ? tokenFor(password()) : null;
}

export function authed(req) {
  if (isOpen()) return true;
  const raw = req.headers.cookie || '';
  const found = raw
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`));
  if (!found) return false;
  return same(decodeURIComponent(found.slice(COOKIE.length + 1)), tokenFor(password()));
}

export const setCookie = (token) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${60 * 60 * 24 * 30}`;
