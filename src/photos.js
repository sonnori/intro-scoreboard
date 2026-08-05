/**
 * The photos folder, read at build time.
 *
 * A browser can't list a directory, so Vite walks `photos/` while building and
 * bakes the result in here. Drop files in the folder, build, and they show up
 * in the picker — no upload endpoint, no storage to manage, no separate copy
 * of the images to keep in sync.
 *
 * The filename is the player's name: `ก้อง.jpg` → "ก้อง".
 */
const files = import.meta.glob('/photos/*.{jpg,jpeg,png,webp,JPG,JPEG,PNG,WEBP}', {
  eager: true,
  query: '?url',
  import: 'default',
});

export const PHOTOS = Object.entries(files)
  .map(([path, url]) => ({
    name: decodeURIComponent(path.split('/').pop().replace(/\.[^.]+$/, '')),
    url,
  }))
  .sort((a, b) => a.name.localeCompare(b.name, 'th'));
