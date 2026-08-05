/**
 * One shared password for whoever is running the board.
 *
 * This is a studio LAN, not the open internet: the job is to stop a guest on
 * the same Wi-Fi from nudging the score, not to withstand an attacker. The
 * cookie holds an HMAC of the password rather than the password itself, so a
 * restart doesn't log the operator out and the file never stores it in clear.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './db.mjs';

const SECRET_FILE = join(DATA_DIR, 'secret');
const PASSWORD_FILE = join(DATA_DIR, 'password.txt');
export const COOKIE = 'sb_control';

let secret;
let password;

export async function init() {
  if (existsSync(SECRET_FILE)) secret = await readFile(SECRET_FILE, 'utf8');
  else {
    secret = randomBytes(32).toString('hex');
    await writeFile(SECRET_FILE, secret);
  }

  password = process.env.SCOREBOARD_PASSWORD?.trim();
  if (!password) {
    if (existsSync(PASSWORD_FILE)) password = (await readFile(PASSWORD_FILE, 'utf8')).trim();
    else {
      password = String(Math.floor(100000 + Math.random() * 900000));
      await writeFile(PASSWORD_FILE, `${password}\n`);
    }
  }
  return password;
}

const tokenFor = (pw) => createHmac('sha256', secret).update(pw).digest('hex');

export function check(pw) {
  if (typeof pw !== 'string' || !pw) return null;
  const given = Buffer.from(tokenFor(pw));
  const real = Buffer.from(tokenFor(password));
  return given.length === real.length && timingSafeEqual(given, real) ? real.toString() : null;
}

export function authed(req) {
  const raw = req.headers.cookie || '';
  const found = raw
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`));
  if (!found) return false;
  const token = Buffer.from(decodeURIComponent(found.slice(COOKIE.length + 1)));
  const real = Buffer.from(tokenFor(password));
  return token.length === real.length && timingSafeEqual(token, real);
}
