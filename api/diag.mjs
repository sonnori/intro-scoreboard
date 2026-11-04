import { json, read, write, hasStore, storeVia } from './_store.mjs';
import { authed } from './_auth.mjs';

/**
 * Answers "is the data store actually wired up?" without anyone having to
 * guess from behaviour. Names of storage-ish variables only — never values —
 * and behind the same gate as every other write, since it writes a probe.
 */
export default async function handler(req, res) {
  if (!authed(req)) return json(res, 401, { error: 'ต้องปลดล็อกก่อน' });

  const candidates = Object.keys(process.env)
    .filter((n) => /REDIS|UPSTASH|KV_|_REST_API_/.test(n))
    .sort();

  let roundTrip = 'ไม่ได้ทดสอบ';
  if (hasStore) {
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
    roundTrip,
  });
}
