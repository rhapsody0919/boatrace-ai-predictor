// verify-migration-numbers.js の欠番の検査（字のまま移した）

export const NUMBERED_DOC_RE = /^(\d{3})_.+\.md$/;

export const numericPart = (id) => Number.parseInt(id, 10);
export const pad3 = (n) => String(n).padStart(3, "0");

/** 連続する欠番を "024" / "002-006" のような範囲表記にまとめる */
function formatRanges(nums) {
  const ranges = [];
  for (const n of nums) {
    const last = ranges[ranges.length - 1];
    if (last && last.end + 1 === n) last.end = n;
    else ranges.push({ start: n, end: n });
  }
  return ranges.map((r) =>
    r.start === r.end ? pad3(r.start) : `${pad3(r.start)}-${pad3(r.end)}`,
  );
}

/** 2. 欠番（番号付きの設計資料 NNN_*.md も「使用済み」として扱う） */
export function checkGaps(byId, localFiles, { warnings }) {
  const usedNumbers = new Set([
    ...[...byId.keys()].map(numericPart),
    ...localFiles
      .map((f) => NUMBERED_DOC_RE.exec(f)?.[1])
      .filter(Boolean)
      .map(numericPart),
  ]);
  if (usedNumbers.size > 0) {
    const maxLocal = Math.max(...usedNumbers);
    const gaps = [];
    for (let n = 1; n <= maxLocal; n += 1) {
      if (!usedNumbers.has(n)) gaps.push(n);
    }
    if (gaps.length > 0) {
      warnings.push(`欠番: ${formatRanges(gaps).join(", ")}（失敗にはしない）`);
    }
  }
}
