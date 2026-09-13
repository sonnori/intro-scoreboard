/**
 * Squares up and shrinks everything in photos/.
 *
 * The board crops to a circle and saves at 512px, so anything past ~1000px on
 * a side is weight the deploy carries for nothing — and anything under 600px
 * is already softer than the board can show. This makes the first problem go
 * away and reports the second, because no amount of resizing invents detail
 * that was never in the file.
 *
 * Originals move to photos/_original/ (git-ignored) so nothing is lost.
 */
import { readdir, mkdir, rename, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'photos');
const keep = join(dir, '_original');

const TARGET = 800; // twice what the board saves, so a re-crop stays sharp
const FLOOR = 600; // below this the face is softer than the board can display
const OK = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const sips = (args) => execFileSync('sips', args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const dims = (file) => {
  const out = sips(['-g', 'pixelWidth', '-g', 'pixelHeight', file]);
  return {
    w: Number(/pixelWidth:\s*(\d+)/.exec(out)?.[1]),
    h: Number(/pixelHeight:\s*(\d+)/.exec(out)?.[1]),
  };
};

if (process.platform !== 'darwin') {
  console.error('\n  ✗ สคริปต์นี้ใช้ sips ของ macOS\n');
  process.exit(1);
}

const files = (await readdir(dir)).filter((f) => OK.has(extname(f).toLowerCase()));
if (!files.length) {
  console.log('\n  ไม่มีรูปใน photos/\n');
  process.exit(0);
}

await mkdir(keep, { recursive: true });
const soft = [];

for (const file of files) {
  const src = join(dir, file);
  const { w, h } = dims(src);
  if (!w || !h) continue;

  const side = Math.min(w, h);
  if (side < FLOOR) soft.push(`${file} (${w}×${h})`);

  // Already a square JPEG at or under target: re-encoding would only lose
  // quality, and this runs again every time a new face is added.
  if (extname(file).toLowerCase() === '.jpg' && w === h && side <= TARGET) {
    console.log(`  ${file}  ${w}×${h}  (ผ่านแล้ว ข้าม)`);
    continue;
  }

  const name = basename(file, extname(file));
  const out = join(dir, `${name}.jpg`);
  const stash = join(keep, file);

  await rename(src, stash);
  // Square from the centre, then down to TARGET; never scale a small file up.
  sips(['-c', String(side), String(side), stash, '--out', out]);
  if (side > TARGET) sips(['-Z', String(TARGET), out]);
  sips(['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', out]);

  const after = dims(out);
  console.log(`  ${file}  ${w}×${h} → ${after.w}×${after.h}`);
}

// A .png that became a .jpg would otherwise linger as a duplicate entry.
for (const file of await readdir(dir)) {
  if (!OK.has(extname(file).toLowerCase())) continue;
  const twin = join(dir, `${basename(file, extname(file))}.jpg`);
  if (extname(file).toLowerCase() !== '.jpg' && existsSync(twin)) await unlink(join(dir, file));
}

console.log(`\n  ✓ เสร็จแล้ว ต้นฉบับเก็บไว้ที่ photos/_original/`);
if (soft.length) {
  console.log(`\n  ! รูปเหล่านี้เล็กกว่า ${FLOOR}px จะดูไม่คมบนจอใหญ่ ขอไฟล์ใหญ่กว่านี้มาแทนดีกว่า:`);
  for (const s of soft) console.log(`      ${s}`);
}
console.log('');
