// racerModel・meetModel・venueModel の make* が使う検査の部品（純関数、投げるだけで副作用なし）。
// 項目名の末尾が英数字・_ のときは「が」の前に空白を入れる（racer_id が…／会場コードが…）
const subject = (label) => (/[A-Za-z0-9_]$/.test(label) ? `${label} が` : `${label}が`);

// 文言は「<領域>の<項目>が<条件>でない: <値>（<どの行か>）」にそろえる。

export function assertObject(row, fn) {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    throw new TypeError(`${fn} の引数がオブジェクトでない: ${String(row)}`);
  }
}

export function assertInt(value, min, max, label, ctx) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${subject(label)}${min}〜${max}でない: ${String(value)}（${ctx}）`);
  }
}

// null・undefined（取得していない列）は許し、値があるときだけ範囲を見る
export function assertIntOrNull(value, min, max, label, ctx) {
  if (value == null) return;
  assertInt(value, min, max, label, ctx);
}

export function assertText(value, label, ctx) {
  if (typeof value !== "string") {
    throw new RangeError(`${subject(label)}文字列でない: ${String(value)}（${ctx}）`);
  }
}

// YYYY-MM-DD で、実在する日（2026-02-30 は落とす）。日付の値（ミリ秒）を返す
export function parseIsoDate(value, label, ctx) {
  const m = typeof value === "string" ? value.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  const ms = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  const back = Number.isNaN(ms) ? "" : new Date(ms).toISOString().slice(0, 10);
  if (back !== value) {
    throw new RangeError(`${subject(label)} YYYY-MM-DD の実在する日でない: ${String(value)}（${ctx}）`);
  }
  return ms;
}

export function assertOneOf(value, allowed, label, ctx) {
  if (!allowed.includes(value)) {
    throw new RangeError(`${subject(label)}不明な値: ${String(value)}（${ctx}）`);
  }
}
