/**
 * The whole database is one JSON file and a folder of images.
 *
 * At this scale that beats a real database on the thing that matters for a
 * shoot: backing up the show is `cp -r data/`, and when something looks wrong
 * at 2am a producer can open the file and read it.
 *
 * Writes go through a temp file and a rename, so a crash mid-write can never
 * leave a half-written show behind.
 */
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), 'data');
const FILE = join(DATA_DIR, 'db.json');

function blank() {
  return {
    version: 0,
    match: {
      matchNo: 1,
      sound: true,
      rules: { target: 15, deuce: true, cap: 0 },
      teams: {
        a: { name: 'ทีมชาวบ้าน', color: '#3B6BFF', players: [] },
        b: { name: 'ทีมศิลปิน', color: '#FF4438', players: [] },
      },
    },
    presets: [],
  };
}

let db = blank();
let writing = null;
let dirty = false;

export async function open() {
  await mkdir(DATA_DIR, { recursive: true });
  if (existsSync(FILE)) {
    try {
      db = { ...blank(), ...JSON.parse(await readFile(FILE, 'utf8')) };
    } catch (e) {
      // Never start on a half-parsed show: keep the bad file for inspection.
      const backup = `${FILE}.broken-${Date.now()}`;
      await rename(FILE, backup);
      console.warn(`  ! db.json อ่านไม่ได้ (${e.message}) — ย้ายไป ${backup} แล้วเริ่มใหม่`);
    }
  }
  return db;
}

export function read() {
  return db;
}

/** Queue a write; concurrent calls collapse into one flush. */
export function commit() {
  db.version = (db.version || 0) + 1;
  dirty = true;
  if (writing) return writing;
  writing = (async () => {
    while (dirty) {
      dirty = false;
      const tmp = `${FILE}.tmp`;
      await writeFile(tmp, JSON.stringify(db, null, 2));
      await rename(tmp, FILE);
    }
    writing = null;
  })();
  return writing;
}

export function newId(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
