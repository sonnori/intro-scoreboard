import { read, json } from './_store.mjs';

/** Tiny endpoint the board polls; the full state is only fetched when this moves. */
export default async function handler(req, res) {
  const db = await read();
  return json(res, 200, { version: db.version || 0 });
}
