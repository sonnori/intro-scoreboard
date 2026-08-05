/**
 * Wraps Scoreboard.html into a double-clickable Scoreboard.app.
 *
 * The bundle carries the page inside it and launches a Chromium browser in
 * app mode, so the shoot machine gets a clean window with no tabs, no address
 * bar and nothing else on camera. Falls back to the default browser.
 *
 * The icon is drawn here rather than shipped as a binary: same two territories
 * and the seam between them as the board itself.
 */
import { mkdir, writeFile, copyFile, rm, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = join(root, 'Scoreboard.html');
const app = join(root, 'Scoreboard.app');
const iconset = join(root, 'Scoreboard.iconset'); // iconutil insists on this suffix

const fail = (msg) => {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
};

if (process.platform !== 'darwin') fail('สคริปต์นี้สร้าง .app ของ macOS เท่านั้น');
if (!existsSync(html)) fail('ยังไม่มี Scoreboard.html — สั่ง npm run app ก่อน');

/* ── PNG writer (no dependencies) ───────────────────────── */

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── the icon ───────────────────────────────────────────── */

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const inset = size * 0.055;
  const radius = size * 0.225;
  const half = size / 2 - inset;
  const seam = 0.56; // pushed off centre: one side is winning
  const teamA = [59, 107, 255];
  const teamB = [255, 68, 56];
  const lineW = Math.max(1, size * 0.014);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.abs(x + 0.5 - size / 2) - (half - radius);
      const cy = Math.abs(y + 0.5 - size / 2) - (half - radius);
      const d =
        Math.hypot(Math.max(cx, 0), Math.max(cy, 0)) + Math.min(Math.max(cx, cy), 0) - radius;
      const alpha = Math.max(0, Math.min(1, 0.5 - d));

      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const team = u < seam ? teamA : teamB;
      const glow = 0.14 + 0.55 * Math.exp(-Math.abs(u - seam) * 4.2) * (0.3 + 0.7 * v);
      const offset = ((u - seam) * size) / lineW;
      const line = Math.exp(-(offset * offset));

      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        px[i + c] = clamp255([11, 13, 24][c] + team[c] * glow + 255 * line * 0.9);
      }
      px[i + 3] = clamp255(alpha * 255);
    }
  }
  return png(size, px);
}

/* ── build the bundle ───────────────────────────────────── */

await rm(app, { recursive: true, force: true });
await rm(iconset, { recursive: true, force: true });
await mkdir(join(app, 'Contents', 'MacOS'), { recursive: true });
await mkdir(join(app, 'Contents', 'Resources'), { recursive: true });
await mkdir(iconset, { recursive: true });

for (const [name, size] of [
  ['icon_16x16', 16],
  ['icon_16x16@2x', 32],
  ['icon_32x32', 32],
  ['icon_32x32@2x', 64],
  ['icon_128x128', 128],
  ['icon_128x128@2x', 256],
  ['icon_256x256', 256],
  ['icon_256x256@2x', 512],
  ['icon_512x512', 512],
  ['icon_512x512@2x', 1024],
]) {
  await writeFile(join(iconset, `${name}.png`), drawIcon(size));
}

try {
  execFileSync('iconutil', [
    '-c',
    'icns',
    iconset,
    '-o',
    join(app, 'Contents', 'Resources', 'Scoreboard.icns'),
  ]);
} catch {
  fail('iconutil สร้างไอคอนไม่สำเร็จ');
}
await rm(iconset, { recursive: true, force: true });

await copyFile(html, join(app, 'Contents', 'Resources', 'Scoreboard.html'));

await writeFile(
  join(app, 'Contents', 'Info.plist'),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Scoreboard</string>
  <key>CFBundleDisplayName</key><string>Scoreboard</string>
  <key>CFBundleIdentifier</key><string>local.scoreboard.app</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>Scoreboard</string>
  <key>CFBundleIconFile</key><string>Scoreboard</string>
  <key>LSMinimumSystemVersion</key><string>10.13</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`
);

await writeFile(join(app, 'Contents', 'PkgInfo'), 'APPL????');

const launcher = `#!/bin/sh
# Opens the board in a chrome-less browser window. Nothing but the scoreboard
# goes on camera: no tabs, no address bar, no bookmarks.
HTML="$(cd "$(dirname "$0")/../Resources" && pwd)/Scoreboard.html"

for BROWSER in \\
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \\
  "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \\
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \\
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \\
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
do
  if [ -x "$BROWSER" ]; then
    "$BROWSER" --app="file://$HTML" --window-size=1600,900 >/dev/null 2>&1 &
    exit 0
  fi
done

# No Chromium-family browser: hand it to whatever opens .html by default.
open "$HTML"
`;

const bin = join(app, 'Contents', 'MacOS', 'Scoreboard');
await writeFile(bin, launcher);
await chmod(bin, 0o755);

// Make Finder pick up the icon straight away instead of caching the generic one.
try {
  execFileSync('touch', [app]);
} catch {
  /* cosmetic only */
}

console.log('\n  ✓ Scoreboard.app · ดับเบิลคลิกเปิดได้เลย · ลากไปไว้ใน Dock ได้\n');
