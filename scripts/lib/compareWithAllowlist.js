/**
 * 違反（{ file, code, ... }）と許可リスト（{ file, code, reason }）を突き合わせる（純関数）。
 *
 * verify-e2e-no-unroute.js（BOA-662）の許可リスト運用を、verify-e2e-recorded-network.js
 * （BOA-663）でも同じ形で使うために切り出した。理由（reason）の無い・短いエントリ、
 * どの違反にも当たらない（解消済みの）エントリは無効/stale として返す。
 * 1エントリは1箇所に対応する前提（同じ内容の行が2箇所あれば2エントリ要る）。
 *
 * 戻り値: { unallowed, stale, invalid }
 */
export function compareWithAllowlist(
  found,
  entries,
  { minReasonLength = 10 } = {},
) {
  const invalid = entries.filter(
    (e) =>
      typeof e.file !== "string" ||
      typeof e.code !== "string" ||
      typeof e.reason !== "string" ||
      e.reason.trim().length < minReasonLength,
  );
  const valid = entries.filter((e) => !invalid.includes(e));
  const used = new Set();
  const unallowed = found.filter((v) => {
    const idx = valid.findIndex(
      (e, k) =>
        !used.has(k) && e.file === v.file && e.code.trim() === v.code.trim(),
    );
    if (idx === -1) return true;
    used.add(idx);
    return false;
  });
  const stale = valid.filter((_, k) => !used.has(k));
  return { unallowed, stale, invalid };
}
