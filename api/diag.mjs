import { json, read, write, hasStore, storeVia, inspect } from './_store.mjs';
import { authed } from './_auth.mjs';

/**
 * Answers "is the data store actually wired up?" without anyone having to
 * guess from behaviour. Names of storage-ish variables only — never values —
 * and behind the same gate as every other write.
 *
 * Reading is the default and it writes nothing. The write probe proves a full
 * round trip, but it saves whatever `read()` just returned — and `read()`
 * returns an empty match when it cannot reach the store. Run it while the
 * store is merely unreachable and it would overwrite the real data with that
 * empty match. So it waits for ?write=1, typed on purpose, by someone who has
 * already seen that the data is there.
 */
export default async function handler(req, res) {
  if (!authed(req)) return json(res, 401, { error: 'ต้องปลดล็อกก่อน' });

  const all = Object.keys(process.env).sort();
  const candidates = all.filter((n) => /REDIS|UPSTASH|KV_|_REST_API_|DATABASE|STORE/i.test(n));

  const params = new URL(req.url, 'http://x').searchParams;
  // ?all=1 lists every variable NAME the function can see — never a value —
  // for when a connection used a prefix the filter above doesn't expect.
  const showAll = params.get('all') === '1';

  let roundTrip = 'ไม่ได้ทดสอบ — เป็นการเขียนทับ ต้องใส่ ?write=1 เองถ้าจะทดสอบ';
  if (params.get('write') === '1' && hasStore) {
    try {
      const before = await read();
      const saved = await write({ ...before, probe: Date.now() });
      const after = await read();
      roundTrip = after.probe === saved.probe ? 'เขียนแล้วอ่านกลับได้ตรงกัน' : 'เขียนได้แต่อ่านกลับไม่ตรง';
    } catch (e) {
      roundTrip = `ล้มเหลว: ${e.message}`;
    }
  }

  return json(res, 200, {
    hasStore,
    usingVariable: storeVia,
    storageVariablesPresent: candidates,
    // The read-only answer: is the data there, is the store reachable, or both?
    store: await inspect(),
    roundTrip,
    ...(showAll ? { allVariableNames: all } : { variableCount: all.length }),
  });
}
