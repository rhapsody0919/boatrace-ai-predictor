// export_pool.js の --daily が DB を7日ずつ読む範囲。
// 依存パッケージを読み込まない（ml-tests は npm ci をせずに node でこれを読む）。

/** [lo, hi) の月を7日ずつの範囲に分ける（race_id の先頭は YYYY-MM-DD なので文字列で比べられる） */
export function weekRanges(lo, hi) {
  const out = [];
  const day = (d) => d.toISOString().slice(0, 10);
  let d = new Date(`${lo}-01T00:00:00Z`);
  const end = new Date(`${hi}-01T00:00:00Z`);
  while (d < end) {
    const next = new Date(d.getTime() + 7 * 86400000);
    out.push([day(d), day(next < end ? next : end)]);
    d = next;
  }
  return out;
}
