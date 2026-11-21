/**
 * 記事の PR の関門の本文の検査（純粋関数）。生 HTML・「競艇」・内部リンク・判断が要る句・変えた行の取り出し・画像の参照。
 * contentPrGate.js が公開の名前を再 export する。契約: docs/operation/content-pr-contract.md
 */
import { decodeNamedCharacterReference } from "decode-named-character-reference";
import { parseBlogChartLine } from "../../src/utils/blogChartTag.js";
import {
  countInternalLinks,
  isPlainObject,
  parseMarkdown,
  walk,
} from "./contentPrGateCommon.js";

const KYOTEI = "競艇";
const IMAGE_REF_RE = /\/images\/blog\/[^\s)"'\]>]+/g;

// 前後の行が無い（図のタグが1行目、または末尾の改行なしの最後の行）ときも空行と同じに扱う
const isBlankOrEdge = (line) => line === undefined || line.trim() === "";

/**
 * 図のタグだけの1行（前後が空行）なら、そのブロックの html ノードを返す。違えば null。
 * mdast では <ryujin-chart …></ryujin-chart> の1行は、html ノード2つだけの段落になる
 * （CommonMark の HTML ブロック7は開きタグの後に何も続かない行だけなので）。ブロックの html ノードでも同じに扱う。
 */
function chartLineOf(block, lines) {
  const { start, end } = block.position ?? {};
  if (!start || start.line !== end.line) return null;
  const onlyHtml =
    block.type === "html" ||
    (block.type === "paragraph" &&
      block.children.length > 0 &&
      block.children.every((c) => c.type === "html"));
  if (!onlyHtml) return null;
  const line = lines[start.line - 1].replace(/\r$/, "");
  if (start.column !== 1 || end.column !== line.length + 1) return null;
  const chart = parseBlogChartLine(line);
  if (!chart) return null;
  if (
    !isBlankOrEdge(lines[start.line - 2]) ||
    !isBlankOrEdge(lines[start.line])
  )
    return null;
  return {
    chart,
    nodes: block.type === "html" ? [block] : block.children,
    line: start.line,
  };
}

/**
 * 生の HTML: .md の mdast に html ノードが0件。コード（code・inlineCode）は html ノードにならないので数えない。
 * 自動リンク <https://…> は link ノード。例外は図のタグだけの1行（src/utils/blogChartTag.js の形、
 * 前後が空行、src の JSON が実在）。chartExists(リポジトリのパス) で JSON の実在を答える。
 */
export function checkRawHtml(path, text, chartExists = () => false) {
  const tree = parseMarkdown(text);
  const lines = text.split("\n");
  const errors = [];
  const allowed = new Set();
  for (const block of tree.children) {
    const c = chartLineOf(block, lines);
    if (!c) continue;
    const jsonPath = `public${c.chart.src}`;
    if (chartExists(jsonPath)) c.nodes.forEach((n) => allowed.add(n));
    else {
      c.nodes.forEach((n) => allowed.add(n));
      errors.push(
        `[chart] ${path}:${c.line} 図の ${jsonPath} が HEAD にも base にも無い`,
      );
    }
  }
  const lineNos = new Set();
  walk(tree, (n) => {
    if (n.type === "html" && !allowed.has(n))
      lineNos.add(n.position?.start.line ?? 0);
  });
  for (const no of [...lineNos].sort((a, b) => a - b)) {
    const hint = (lines[no - 1] ?? "").includes("<ryujin-chart")
      ? "（図のタグの形・前後の空行が契約と違う）"
      : "";
    errors.push(`[html] ${path}:${no} 本文に HTML がある${hint}`);
  }
  return errors;
}

const isKyoteiExceptionLine = (path, line, config) =>
  (config.kyoteiExceptions ?? []).some(
    (e) => e.path === path && e.line === line,
  );

/** 「競艇」: .md 本文に0件（設定の例外行を除く） */
export function checkKyoteiMd(path, text, config) {
  return text
    .split("\n")
    .map((line, idx) => ({ line, no: idx + 1 }))
    .filter(
      ({ line }) =>
        line.includes(KYOTEI) && !isKyoteiExceptionLine(path, line, config),
    )
    .map(({ no }) => `[kyotei] ${path}:${no} 本文に「${KYOTEI}」がある`);
}

/** JSON の文字列値を、キーの道筋つきで集める */
const collectKeyedStrings = (v, keyPath = []) =>
  typeof v === "string"
    ? [{ keyPath, value: v }]
    : Array.isArray(v)
      ? v.flatMap((x, i) => collectKeyedStrings(x, [...keyPath, String(i)]))
      : isPlainObject(v)
        ? Object.entries(v).flatMap(([k, x]) =>
            collectKeyedStrings(x, [...keyPath, k]),
          )
        : [];

/** 配列の添字を "[]" にそろえたキーの道筋（配列は要素の位置ではなく、要素があるかで比べる） */
const shapeKey = (keyPath) =>
  keyPath.map((k) => (/^\d+$/.test(k) ? "[]" : k)).join(".");

/**
 * HEAD の JSON の文字列値のうち、base から変わったもの（キーの道筋で比べる。配列は base の同じ配列に無い要素）。
 * baseObj が undefined（足したファイル）なら全部
 */
export function changedJsonStrings(obj, baseObj) {
  const all = collectKeyedStrings(obj);
  if (baseObj === undefined) return all;
  const before = new Set(
    collectKeyedStrings(baseObj).map(
      (s) => `${shapeKey(s.keyPath)}\0${s.value}`,
    ),
  );
  return all.filter((s) => !before.has(`${shapeKey(s.keyPath)}\0${s.value}`));
}

/**
 * HEAD の .md の行のうち、base に無い行（行の差分。並べ替えただけの行は見ない）。baseText が undefined なら全行
 */
export function changedMdLines(text, baseText) {
  const lines = text.split("\n").map((line, idx) => ({ line, no: idx + 1 }));
  if (baseText === undefined) return lines;
  // 行ごとの出現回数で比べ、base の回数を超えた分を足した行とみなす（今ある行の複製も見える）
  const left = new Map();
  for (const l of baseText.split("\n")) left.set(l, (left.get(l) ?? 0) + 1);
  return lines.filter(({ line }) => {
    const n = left.get(line) ?? 0;
    if (n === 0) return true;
    left.set(line, n - 1);
    return false;
  });
}

/**
 * 「競艇」: JSON の文字列値のうち、設定の kyoteiMetaAllowedKeys（metaTitle・metaDescription）以外に0件（[kyotei]）。
 * meta の「競艇」は通す（オーナー決定 2026-10-20、.claude/rules/code-style.md の例外1。役所への営業の前に外す暫定の措置）。
 * 後で一括で外せるように、meta に「競艇」があるキーを metaKeys で返す（結果の metaKyotei に出る）
 */
export function checkKyoteiJson(path, obj, config = {}) {
  const metaAllowed = new Set(config.kyoteiMetaAllowedKeys ?? []);
  const label = (keyPath) => keyPath.join(".") || "(値)";
  // 例外は最上位の文字列値だけ（入れ子の metaTitle や、metaTitle の下の値は対象外）
  const isMeta = (keyPath) =>
    keyPath.length === 1 && metaAllowed.has(keyPath[0]);
  const hits = collectKeyedStrings(obj).filter(({ value }) =>
    value.includes(KYOTEI),
  );
  return {
    errors: hits
      .filter(({ keyPath }) => !isMeta(keyPath))
      .map(
        ({ keyPath }) =>
          `[kyotei] ${path} の ${label(keyPath)} に「${KYOTEI}」がある`,
      ),
    metaKeys: [
      ...new Set(
        hits
          .filter(({ keyPath }) => isMeta(keyPath))
          .map(({ keyPath }) => label(keyPath)),
      ),
    ],
  };
}

/** 内部リンクが1本以上。既存の免除一覧は改稿（status M）のときだけ効く */
export function checkInternalLinks(path, text, status, config) {
  if (countInternalLinks(text) > 0) return [];
  const grandfathered =
    status === "M" && (config.internalLinkGrandfathered ?? []).includes(path);
  return grandfathered
    ? []
    : [
        `[link] ${path} に内部リンク（/ で始まるリンク。画像と // は数えない）が無い`,
      ];
}

/** 実体参照（数値・16進・名前付き）を文字に戻す。読めないものはそのまま */
const decodeEntities = (s) =>
  s.replace(
    /&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g,
    (m, body) => {
      if (body[0] === "#") {
        const code =
          body[1] === "x" || body[1] === "X"
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
      }
      const decoded = decodeNamedCharacterReference(body);
      return decoded === false ? m : decoded;
    },
  );

/**
 * 句の照合の前の正規化: 実体参照を戻す → NFKC → 強調の記号（* _ ~ `）・空白（全角を含む）・ゼロ幅文字を消す。
 * 句の一覧・決まり文の一覧にも同じものをかけてから比べる
 */
// 強調などの記号・空白（全角を含む）・ゼロ幅文字（U+200B〜U+200D・U+FEFF・U+2060）
const JUDGEMENT_STRIP_RE = new RegExp(
  "[*_~`\\s\\u{200B}-\\u{200D}\\u{FEFF}\\u{2060}]",
  "gu",
);
// 空白で隣り合う数がつながらないよう（「R1 150%」が 1150% にならないよう）、数と数の間の空白は区切りの | にしてから消す
export const normalizeForJudgement = (s) =>
  decodeEntities(s)
    .normalize("NFKC")
    .replace(/([0-9])\s+(?=[0-9])/gu, "$1|")
    .replace(JUDGEMENT_STRIP_RE, "");

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const escapeClassChar = (c) => c.replace(/[\\\]^-]/g, "\\$&");

/**
 * 回収率の主張（100% 以上・1倍以上）を正規化した文から探す。
 * - 「回収率」＋最大 gapMax 字＋数（コンマ可）＋%・パーセント
 * - 「回収率」＋最大 timesGapMax 字＋数＋倍（倍は回収率の後だけ。オッズの「1.2倍」を拾わない）
 * - 数＋%・パーセント＋最大 reverseGapMax 字＋「回収率」（逆の語順は倍を受けない）
 * 間の字に数字と区切り（rate.gapStopChars。文・列・箇条の区切り）は含めない（別の数・別の文をまたがない）。
 * 数の直後が 未満・以下・(を)切・(を)下回 なら主張とみなさない。漢数字・払戻率・ROI は対象外
 */
export function findRateClaims(norm, rate) {
  if (!rate) return [];
  const kw = `(?:${rate.keywords.map(escapeRe).join("|")})`;
  const stop = [...(rate.gapStopChars ?? "")].map(escapeClassChar).join("");
  const gap = (max) => `[^0-9${stop}]{0,${max}}?`;
  const num = "([0-9][0-9,]*(?:\\.[0-9]+)?)";
  const notBelow = "(?!未満|以下|を?切|を?下回)";
  const patterns = [
    [
      `${kw}${gap(rate.gapMax)}${num}(?:%|パーセント)${notBelow}`,
      rate.percentMin,
    ],
    [`${kw}${gap(rate.timesGapMax)}${num}倍${notBelow}`, rate.timesMin],
    [
      `${num}(?:%|パーセント)${notBelow}${gap(rate.reverseGapMax)}${kw}`,
      rate.percentMin,
    ],
  ];
  const hits = [];
  for (const [src, min] of patterns)
    for (const m of norm.matchAll(new RegExp(src, "gu")))
      if (Number(m[1].replace(/,/g, "")) >= min) hits.push(m[0]);
  return hits;
}

/**
 * 判断が要る句を、渡した文のまとまり（.md の段落、JSON の文字列値）から探す。決定 (a)。
 * 正規化してから、config.judgementAllowedLines（免責の決まり文）の部分だけを消し、残りで
 * config.judgementPhrases（部分一致）と config.judgementRate（回収率の主張）を照合する。
 * 返り値: [{ text, hit, kind }]（kind は "phrase" か "rate"）
 */
export function findJudgementPhrases(texts, config) {
  const phrases = (config.judgementPhrases ?? []).map(normalizeForJudgement);
  const allowed = (config.judgementAllowedLines ?? [])
    .map(normalizeForJudgement)
    .filter(Boolean);
  const hits = [];
  for (const text of texts) {
    const norm = allowed.reduce(
      (s, a) => s.split(a).join(""),
      normalizeForJudgement(text),
    );
    for (const p of phrases)
      if (norm.includes(p)) hits.push({ text, hit: p, kind: "phrase" });
    for (const h of findRateClaims(norm, config.judgementRate))
      hits.push({ text, hit: h, kind: "rate" });
  }
  return hits;
}

/** 空行で区切った段落（開始・終了の行番号つき） */
function paragraphsOf(lines) {
  const out = [];
  let cur = null;
  lines.forEach((line, idx) => {
    if (line.trim() === "") {
      cur = null;
      return;
    }
    if (!cur) {
      cur = { start: idx + 1, end: idx + 1, lines: [] };
      out.push(cur);
    }
    cur.end = idx + 1;
    cur.lines.push(line);
  });
  return out;
}

/** .md の段落のうち、変えた行・足した行を1つでも含むもの。改行を消してつないだ文で返す */
export function changedMdParagraphs(text, baseText) {
  const changed = new Set(changedMdLines(text, baseText).map((l) => l.no));
  return paragraphsOf(text.split("\n"))
    .filter((p) => {
      for (let n = p.start; n <= p.end; n += 1) if (changed.has(n)) return true;
      return false;
    })
    .map((p) => ({ start: p.start, end: p.end, text: p.lines.join("") }));
}

/** base の JSON。無い（足したファイル）か読めないときは undefined で、全部を見る（読めないときは featured の関門が別に error を出す） */
function baseJsonOf(base, path) {
  if (base[path] === undefined) return undefined;
  try {
    return JSON.parse(base[path]);
  } catch {
    return undefined;
  }
}

/** 変えた .md・JSON の、変えた行・足した行（JSON は変えた文字列値の各行） */
export function changedTextsOf(f, base) {
  if (f.kind === "md")
    return changedMdParagraphs(f.text, base[f.path]).map((p) => ({
      where: `${f.path}:${p.start}${p.end > p.start ? `-${p.end}` : ""}`,
      text: p.text,
    }));
  return changedJsonStrings(f.json, baseJsonOf(base, f.path)).map((s) => ({
    where: `${f.path} の ${s.keyPath.join(".")}`,
    text: s.value,
  }));
}

/** 変えた .md・JSON が参照する画像のリポジトリ上のパス（public/ つき）。CLI が HEAD から読む対象を決めるのにも使う */
export function referencedImagePaths(texts) {
  const refs = new Set();
  for (const t of texts) {
    for (const m of t.matchAll(IMAGE_REF_RE)) refs.add(`public${m[0]}`);
  }
  return [...refs].sort();
}
