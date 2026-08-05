/**
 * Folds the Vite build into one self-contained Scoreboard.html.
 *
 * Fonts are already base64 inside app.css (assetsInlineLimit), so this only
 * has to pull two files in and drop the module/crossorigin attributes that
 * would stop the page running from the filesystem.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const out = join(root, 'Scoreboard.html');

const fail = (msg) => {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
};

if (!existsSync(join(dist, 'index.html'))) fail('ยังไม่มี dist/ — สั่ง npm run build ก่อน');

let html = await readFile(join(dist, 'index.html'), 'utf8');
const css = await readFile(join(dist, 'app.css'), 'utf8');
const js = await readFile(join(dist, 'app.js'), 'utf8');

html = html.replace(/<link[^>]+rel="stylesheet"[^>]*>/, () => `<style>\n${css}\n</style>`);

// Vite hoists the entry into <head> because module scripts defer themselves.
// Stripped of type="module" it would run before the DOM exists, so it moves
// back to the end of <body> where a classic script belongs.
const tag = /<script[^>]*src="[^"]*app\.js"[^>]*><\/script>\s*/;
if (!tag.test(html)) fail('หา entry script ในผลบิลด์ไม่เจอ');
html = html.replace(tag, '');
// Replacer functions, never replacement strings: minified code contains `$&`
// and friends, which String.replace would expand into the surrounding HTML.
html = html.replace('</body>', () => `  <script>\n${js}\n  </script>\n  </body>`);

// Anything still pointing outside the file means it would break on a shoot machine.
const external = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)]
  .map((m) => m[1])
  .filter((url) => !url.startsWith('data:'));
if (external.length) fail(`ยังมีไฟล์ที่อ้างออกข้างนอก: ${external.join(', ')}`);
if (/type="module"/.test(html)) fail('ยังเป็น module script — จะไม่รันบน file://');
// A classic script that runs before #board exists would throw on every element lookup.
if (html.indexOf('<script>') < html.indexOf('id="board"')) fail('สคริปต์รันก่อน DOM');

// Parse exactly what the browser will parse, so no corruption ships silently.
const inlined = html.slice(
  html.lastIndexOf('<script>') + '<script>'.length,
  html.lastIndexOf('</script>')
);
if (inlined.length !== js.length + 4) fail('ขนาดสคริปต์ที่ฝังไม่ตรงกับผลบิลด์');
try {
  new Function(inlined);
} catch (e) {
  fail(`สคริปต์ที่ฝังพังตอน parse: ${e.message}`);
}

// dist/ stays: the studio server serves it directly.
await writeFile(out, html);

const mb = (Buffer.byteLength(html) / 1024 / 1024).toFixed(2);
console.log(`\n  ✓ Scoreboard.html · ${mb} MB · ดับเบิลคลิกเปิดได้เลย\n`);
