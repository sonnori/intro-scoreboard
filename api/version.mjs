import { readVersion, json } from './_store.mjs';

/**
 * Tiny endpoint the board polls; the full state is only fetched when this moves.
 *
 * It also reports which commit is serving, because the API has no asset hash to
 * compare and "did my deploy land yet?" otherwise takes guesswork. Vercel sets
 * the variable at build time; locally there is none, hence 'dev'.
 */
export default async function handler(req, res) {
  return json(res, 200, {
    version: await readVersion(),
    build: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'dev',
  });
}
