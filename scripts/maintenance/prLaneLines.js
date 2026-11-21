/**
 * pr-lane.js の部品: 差分の行の中身を見る純関数（語の数え・字のまま移した行の除き・全体に効くセレクタ）。
 * 依存なし。hq の写しの一覧に入る（pr-lane.js の頭の注釈）。
 */

const count = (lines, word) =>
  lines.reduce((n, line) => n + line.split(word).length - 1, 0);

/**
 * 語（H9）の数えから、別のファイルへ字のまま移しただけの行を外す（部品の分割で既存の文言が新しいファイルへ動く形）。
 * 語を含む足した行のうち、同じ PR が paths の別のファイルから消した行と、前後の空白を除いて一字違わず同じ物を、
 * 消した行と1対1で対にし、足した側・消した側の両方の数えから外す。
 * - 同じファイルの中で足して消した同じ行は先にそのファイルの中で対にする（別のファイルの行と二重に使わない。複製は移動に数えない）
 * - 移し元は paths（語を見るファイル）だけ。語を見ないファイル（記事・docs 等）から持ち込んだ行は今どおり新しい語
 * - 1字でも変えた行・新しい行は残るので、今どおり「足した行の語の数 > 消した行の語の数」で当たる
 * @param {Map<string, { added: string[], removed: string[] }>} patches
 * @param {string[]} paths 語を見るファイル（順に対にする。git の差分の順）
 * @param {string[]} words
 * @returns {Map<string, { added: string[], removed: string[] }>} 移動を外した語を含む行（patches に無いパスは入れない）
 */
export function withoutMovedLines(patches, paths, words) {
  const hasWord = (line) => words.some((w) => line.includes(w));
  const bag = (lines) => {
    const m = new Map();
    for (const l of lines) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const files = paths
    .filter((p) => patches.has(p))
    .map((path) => {
      const p = patches.get(path);
      const added = p.added.filter(hasWord).map((l) => l.trim());
      const removed = p.removed.filter(hasWord).map((l) => l.trim());
      // 同じファイルの中の対を除いた残り（別のファイルと対にできる行）
      const freeAdded = bag(added);
      const freeRemoved = bag(removed);
      for (const [line, n] of freeAdded) {
        const k = Math.min(n, freeRemoved.get(line) ?? 0);
        freeAdded.set(line, n - k);
        freeRemoved.set(line, (freeRemoved.get(line) ?? 0) - k);
      }
      return { path, added, removed, freeAdded, freeRemoved };
    });
  const movedIn = new Map(files.map((f) => [f.path, new Map()]));
  const movedOut = new Map(files.map((f) => [f.path, new Map()]));
  const take = (m, line) => m.set(line, (m.get(line) ?? 0) + 1);
  for (const to of files) {
    for (const [line, n] of to.freeAdded) {
      for (let i = 0; i < n; i += 1) {
        const from = files.find(
          (f) => f !== to && (f.freeRemoved.get(line) ?? 0) > 0,
        );
        if (!from) break;
        from.freeRemoved.set(line, from.freeRemoved.get(line) - 1);
        take(movedIn.get(to.path), line);
        take(movedOut.get(from.path), line);
      }
    }
  }
  const drop = (lines, moved) => {
    const left = new Map(moved);
    return lines.filter((l) => {
      const k = left.get(l) ?? 0;
      if (k === 0) return true;
      left.set(l, k - 1);
      return false;
    });
  };
  return new Map(
    files.map((f) => [
      f.path,
      {
        added: drop(f.added, movedIn.get(f.path)),
        removed: drop(f.removed, movedOut.get(f.path)),
      },
    ]),
  );
}

/** 括弧（:not()・:is() の中・[...]）の外のカンマで割る */
const splitTop = (prelude) => {
  const out = [""];
  let depth = 0;
  for (const ch of prelude) {
    if (ch === "(" || ch === "[") depth += 1;
    if (ch === ")" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) out.push("");
    else out[out.length - 1] += ch;
  }
  return out.map((s) => s.trim()).filter(Boolean);
};

/**
 * 対象を絞るクラスが無いか。括弧の中（:not(.x)・:has(.x)）・属性・ID は絞りに数えない
 * （#root a・[data-theme="dark"] h1 も全体に効く）。:root・html・body・* で始まるものも全体
 */
const isGlobalSelector = (sel) =>
  /^(:root|html|body|\*)(?![\w-])/i.test(sel) ||
  !sel
    .replace(/\([^()]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/#[\w-]+/g, "")
    .includes(".");

/**
 * 新しい CSS のファイルの中身（足した行）から、全体に効くセレクタを返す。
 * 規則の中に入れ子にした規則（.card { & a {} }・.card { a {} }）は親で絞られるので数えない。
 * @media・@supports 等の中は見る。@keyframes・@font-face 等の中と、文字列・コメントの中は見ない
 * @param {string[]} lines
 * @returns {string[]}
 */
export function globalSelectors(lines) {
  const text = lines
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');
  const found = [];
  // "rule"（規則の中）・"group"（@media 等、中にセレクタを持つ）・"other"（@keyframes 等）
  const stack = [];
  let prelude = "";
  for (const ch of text) {
    if (ch === "{") {
      const head = prelude.trim();
      prelude = "";
      if (head.startsWith("@")) {
        const group = /^@(media|supports|layer|container|document)\b/i;
        stack.push(group.test(head) ? "group" : "other");
      } else {
        if (stack.every((k) => k === "group"))
          found.push(...splitTop(head).filter(isGlobalSelector));
        stack.push("rule");
      }
    } else if (ch === "}") {
      stack.pop();
      prelude = "";
    } else if (ch === ";") {
      prelude = "";
    } else {
      prelude += ch;
    }
  }
  return found;
}

export { count };
