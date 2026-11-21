/**
 * コメント・文字列・テンプレート・正規表現リテラルの中身を空白に置き換える簡易な字句解析（純関数）。
 *
 * verify-e2e-no-unroute.js（BOA-662）で、E2E の spec に対する機械検査が
 * 「文字列中の `//`（URLなど）をコメントの開始と誤認する」「コメント中の該当コードも
 * 検出してしまう」を避けるために作った。verify-e2e-recorded-network.js（BOA-663）も
 * 同じ問題を抱えていたため、ここに切り出して両方から使う。
 *
 * 改行は残すので、呼び出し側は元のソースと行番号・文字位置が一致したまま扱える。
 */

// この文字の直後の `/` は割り算ではなく正規表現リテラルの始まり
const REGEX_PRECEDERS = new Set("(,=:[!&|?{};+-*%<>~^".split(""));

// i の位置の `/` が正規表現リテラルの始まりか（割り算ではないか）。out は空白に置き換え途中の写し
function startsRegex(source, out, i) {
  let k = i - 1;
  while (k >= 0 && /\s/.test(out[k])) k -= 1;
  if (k < 0) return true;
  // return / typeof 等のキーワードの後も正規表現
  const word = source.slice(0, k + 1).match(/[A-Za-z_$]+$/);
  if (word) {
    return ["return", "typeof", "case", "in", "of"].includes(word[0]);
  }
  // a++ / 2・a-- / 2 は割り算
  if ((out[k] === "+" || out[k] === "-") && out[k - 1] === out[k]) {
    return false;
  }
  return REGEX_PRECEDERS.has(out[k]);
}

// 引用符 c で始まる文字列・テンプレートの閉じの位置（閉じが無ければ打ち切った位置）
function quoteEnd(source, i, c) {
  let k = i + 1;
  while (k < source.length && source[k] !== c) {
    if (source[k] === "\\") k += 1;
    // 通常の文字列は行をまたがない（閉じ忘れで以降を全部消さないため）
    else if (source[k] === "\n" && c !== "`") break;
    k += 1;
  }
  return k;
}

// i の `/` で始まる正規表現リテラルの閉じの `/` の位置（行末で打ち切る）
function regexEnd(source, i) {
  let k = i + 1;
  let inClass = false;
  while (k < source.length && source[k] !== "\n") {
    if (source[k] === "\\") k += 1;
    else if (source[k] === "[") inClass = true;
    else if (source[k] === "]") inClass = false;
    else if (source[k] === "/" && !inClass) break;
    k += 1;
  }
  return k;
}

// i から始まる非コードの範囲（空白にする [from, to) と次に読む位置）。コードなら null
function nonCodeSpan(source, out, i) {
  const c = source[i];
  const next = source[i + 1];
  if (c === "/" && next === "/") {
    const end = source.indexOf("\n", i);
    const stop = end === -1 ? source.length : end;
    return { from: i, to: stop, next: stop };
  }
  if (c === "/" && next === "*") {
    const end = source.indexOf("*/", i + 2);
    const stop = end === -1 ? source.length : end + 2;
    return { from: i, to: stop, next: stop };
  }
  if (c === '"' || c === "'" || c === "`") {
    const k = quoteEnd(source, i, c);
    return { from: i + 1, to: k, next: k + 1 };
  }
  if (c === "/" && startsRegex(source, out, i)) {
    const k = regexEnd(source, i);
    return { from: i + 1, to: k, next: k + 1 };
  }
  return null;
}

export function stripNonCode(source) {
  const out = source.split("");
  let i = 0;
  while (i < source.length) {
    const span = nonCodeSpan(source, out, i);
    if (span === null) {
      i += 1;
      continue;
    }
    for (let k = span.from; k < span.to; k += 1) {
      if (out[k] !== "\n") out[k] = " ";
    }
    i = span.next;
  }
  return out.join("");
}
