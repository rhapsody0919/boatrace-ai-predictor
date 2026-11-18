/**
 * 記事の中身だけの PR を機械で判定する関門（純粋関数）。
 * fs・git・時計に触れない。入力は全部引数で受ける（集めるのは scripts/content/check-content-pr.js）。
 * 契約: docs/operation/content-pr-contract.md、設定: scripts/content/content-pr-gate.json
 */
import { decodeNamedCharacterReference } from "decode-named-character-reference";
import { parseBlogChartLine } from "../../src/utils/blogChartTag.js";
import { GATE_CONFIG_PATH } from "../maintenance/e2e-scope.js";
import {
  CHART_JSON_RE,
  JA_JSON_RE,
  MANIFEST_RE,
  MD_RE,
  TR_JSON_RE,
  TRANSLATION_SUFFIX_RE,
  articleIdOf,
  countInternalLinks,
  isPlainObject,
  parseMarkdown,
  readJpegSize,
  toText,
  walk,
} from "./contentPrGateCommon.js";
import {
  checkGateConfigChange,
  checkManifest,
} from "./contentPrGateManifest.js";

// 下の部品（contentPrGateCommon.js）の公開の名前は、ここから今までどおり import できる
export {
  MANIFEST_SCHEMA,
  REVIEW_ROLES,
  computeContentSha256,
  countInternalLinks,
  readJpegSize,
  sha256Hex,
} from "./contentPrGateCommon.js";

const KYOTEI = "競艇";
const REGULAR_FILE_MODE = "100644";
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const IMAGE_RE = /^public\/images\/blog\/[^/]+$/;
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
function changedTextsOf(f, base) {
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

// 許可のパス・状態・ファイルの型
function entryErrors(entries, config) {
  const errors = [];
  const patterns = (config.allowedPathPatterns ?? []).map((s) => new RegExp(s));
  for (const e of entries) {
    if (e.status === "D") {
      errors.push(
        `[delete] ${e.path} 記事の PR では削除を許さない（削除は通常の PR で）`,
      );
    } else if (!["A", "M"].includes(e.status)) {
      errors.push(
        `[path] ${e.path} の状態 ${e.status} は扱わない（T は種類の変更）`,
      );
    }
    if (
      e.path.split("/").some((seg) => seg === "." || seg === ".." || seg === "")
    )
      errors.push(`[path] ${e.path} は . や .. や空の区切りを含む`);
    else if (e.path === GATE_CONFIG_PATH) {
      // 許可の型の外。免除の一覧から外すだけの変更かを checkGateConfigChange で見る（型を足しても素通りさせない）
    } else if (!patterns.some((re) => re.test(e.path)))
      errors.push(`[path] ${e.path} は記事の PR で変えてよいパスでない`);
    if (e.status !== "D" && e.mode !== REGULAR_FILE_MODE)
      errors.push(
        `[mode] ${e.path} の mode が ${e.mode ?? "不明"}（${REGULAR_FILE_MODE} の通常のファイルだけ許す）`,
      );
  }
  return errors;
}

// manifest はちょうど1つ（追加か変更）。{ manifestPath, errors }
function pickManifest(entries) {
  const manifestEntries = entries.filter((e) => MANIFEST_RE.test(e.path));
  const liveManifests = manifestEntries.filter((e) => e.status !== "D");
  if (manifestEntries.length !== 1 || liveManifests.length !== 1) {
    return {
      manifestPath: null,
      errors: [
        `[manifest] docs/content-manifests/ の差分がちょうど1つ（追加か変更）でない（${manifestEntries.length} 件）`,
      ],
    };
  }
  return { manifestPath: liveManifests[0].path, errors: [] };
}

// .md と JSON を読む。{ textFiles, errors }
function readTextFiles(live, head) {
  const errors = [];
  const textFiles = [];
  for (const e of live) {
    const isMd = MD_RE.test(e.path);
    const isJson =
      JA_JSON_RE.test(e.path) ||
      TR_JSON_RE.test(e.path) ||
      CHART_JSON_RE.test(e.path);
    if (!isMd && !isJson) continue;
    if (head[e.path] === undefined) {
      errors.push(`[path] ${e.path} が HEAD に無い`);
      continue;
    }
    const text = toText(head[e.path]);
    if (isMd) {
      textFiles.push({ ...e, kind: "md", text });
      continue;
    }
    try {
      textFiles.push({ ...e, kind: "json", text, json: JSON.parse(text) });
    } catch (err) {
      errors.push(`[json] ${e.path} を JSON として読めない: ${err.message}`);
    }
  }
  return { textFiles, errors };
}

// 本文の関門（生 HTML・「競艇」・内部リンク）。{ errors, metaKyotei }
function bodyErrors(textFiles, existsAnywhere, config) {
  const errors = [];
  const metaKyotei = [];
  const chartExists = (p) => existsAnywhere.has(p);
  for (const f of textFiles) {
    if (f.kind === "md") {
      errors.push(
        ...checkRawHtml(f.path, f.text, chartExists),
        ...checkKyoteiMd(f.path, f.text, config),
        ...checkInternalLinks(f.path, f.text, f.status, config),
      );
    } else {
      // 図の JSON は画面に出る文字だけなので、meta の例外を効かせない
      const kyotei = checkKyoteiJson(
        f.path,
        f.json,
        CHART_JSON_RE.test(f.path)
          ? { ...config, kyoteiMetaAllowedKeys: [] }
          : config,
      );
      errors.push(...kyotei.errors);
      if (kyotei.metaKeys.length > 0)
        metaKyotei.push({
          id: typeof f.json?.id === "string" ? f.json.id : null,
          path: f.path,
          keys: kyotei.metaKeys,
        });
    }
  }
  return { errors, metaKyotei };
}

// .md と JSON の対応（図の JSON は記事の .md と対にならない）
function pairErrors(textFiles, existsAnywhere) {
  const errors = [];
  for (const f of textFiles.filter((t) => !CHART_JSON_RE.test(t.path))) {
    const id = articleIdOf(f.path);
    const jaJson = `src/data/blog-posts/${id}.json`;
    const jaMd = `public/blog/${id}.md`;
    if (f.kind === "md") {
      const isTranslation = TRANSLATION_SUFFIX_RE.test(f.path.match(MD_RE)[1]);
      if (isTranslation && !existsAnywhere.has(jaJson))
        errors.push(`[pair] ${f.path} の日本語版 ${jaJson} が無い`);
      if (!isTranslation && f.status === "A" && !existsAnywhere.has(jaJson))
        errors.push(`[pair] ${f.path} に対応する ${jaJson} が無い`);
    } else if (JA_JSON_RE.test(f.path)) {
      if (f.status === "A" && !existsAnywhere.has(jaMd))
        errors.push(`[pair] ${f.path} に対応する ${jaMd} が無い`);
    } else {
      if (f.json?.id !== id)
        errors.push(
          `[slug] ${f.path} の id "${f.json?.id}" がファイル名と違う`,
        );
      if (!existsAnywhere.has(jaJson))
        errors.push(`[pair] ${f.path} の日本語版 ${jaJson} が無い`);
    }
  }
  return errors;
}

// 足した日本語版 JSON の slug と featured
function newPostErrors(f, basePathSet) {
  const errors = [];
  const fileId = f.path.match(JA_JSON_RE)[1];
  const id = f.json?.id;
  if (id !== fileId)
    errors.push(`[slug] ${f.path} の id "${id}" がファイル名と違う`);
  if (typeof id !== "string" || !SLUG_RE.test(id))
    errors.push(
      `[slug] ${f.path} の id "${id}" が小文字英数字とハイフンの形でない`,
    );
  else if (TRANSLATION_SUFFIX_RE.test(id))
    errors.push(`[slug] ${f.path} の id "${id}" が翻訳の接尾辞で終わる`);
  for (const p of [
    `src/data/blog-posts/${fileId}.json`,
    `public/blog/${fileId}.md`,
  ]) {
    if (basePathSet.has(p))
      errors.push(`[slug] ${f.path} の id が base の ${p} と衝突する`);
  }
  if (f.json?.featured !== false)
    errors.push(`[featured] ${f.path} は新規なので featured=false にする`);
  if (isPlainObject(f.json) && "featuredRank" in f.json)
    errors.push(`[featured] ${f.path} は新規なので featuredRank を置かない`);
  return errors;
}

// 変えた日本語版 JSON の featured・featuredRank は base から変えない
function revisedPostErrors(f, base) {
  const baseText = base[f.path];
  if (baseText === undefined)
    return [`[featured] ${f.path} の base の中身が無い`];
  let baseJson;
  try {
    baseJson = JSON.parse(baseText);
  } catch (err) {
    return [
      `[featured] ${f.path} の base を JSON として読めない: ${err.message}`,
    ];
  }
  const errors = [];
  for (const k of ["featured", "featuredRank"]) {
    if (JSON.stringify(f.json?.[k]) !== JSON.stringify(baseJson?.[k])) {
      errors.push(`[featured] ${f.path} の ${k} を base から変えている`);
    }
  }
  return errors;
}

// slug と featured（日本語版 JSON）
function slugFeaturedErrors(textFiles, basePaths, base) {
  const errors = [];
  const basePathSet = new Set(basePaths);
  for (const f of textFiles.filter(
    (t) => t.kind === "json" && JA_JSON_RE.test(t.path),
  )) {
    errors.push(
      ...(f.status === "A"
        ? newPostErrors(f, basePathSet)
        : revisedPostErrors(f, base)),
    );
  }
  return errors;
}

// 画像: 参照先が HEAD にあり寸法が読める。足した画像はどれかが参照している
function imageErrors(textFiles, live, head) {
  const errors = [];
  // 図の JSON の文字列は画像の参照に数えない（図は画像を持たない）
  const refs = referencedImagePaths(
    textFiles.filter((f) => !CHART_JSON_RE.test(f.path)).map((f) => f.text),
  );
  for (const p of refs) {
    if (head[p] === undefined)
      errors.push(`[image] 参照している ${p} が HEAD に無い`);
    else if (!/\.(jpe?g)$/i.test(p) || !readJpegSize(head[p]))
      errors.push(`[image] ${p} の JPEG ヘッダーから幅と高さを読めない`);
  }
  const refSet = new Set(refs);
  for (const e of live.filter((x) => IMAGE_RE.test(x.path))) {
    if (head[e.path] !== undefined && !readJpegSize(head[e.path])) {
      errors.push(`[image] ${e.path} の JPEG ヘッダーから幅と高さを読めない`);
    }
    // 足した画像も差し替えた画像も、この PR で変えた .md・JSON のどれかが参照していること
    // （別の記事の画像だけを差し替える PR を通さない）
    if (!refSet.has(e.path))
      errors.push(
        `[image] 変えた ${e.path} をどの .md・JSON（この PR で変えたもの）も参照していない`,
      );
  }
  return errors;
}

// 判断が要る句。実行役は、判断が要る句があれば PR を作らずオーナーへ回す（2026-10-20 オーケストレーター決定）。
// PR に来た時点で道を外れているので、見つかれば error にする。見るのは変えた行・足した行だけ（決定 (a)）
function judgementErrors(textFiles, base, config) {
  const errors = [];
  const found = new Set();
  for (const f of textFiles) {
    for (const t of changedTextsOf(f, base)) {
      for (const { hit } of findJudgementPhrases([t.text], config)) {
        found.add(hit);
        errors.push(
          `[judgement] ${t.where} に判断が要る句「${hit}」がある（PR を作らずオーナーの判断へ回す）`,
        );
      }
    }
  }
  return { errors, judgementWordsFound: [...found] };
}

// manifest を読んで関門にかける。{ errors, manifest, p1Recorded }（manifest は読めた JSON、読めなければ undefined）
function manifestSection(manifestPath, entries, input) {
  const { head, base, basePaths, headPaths, config } = input;
  const errors = [];
  let p1Recorded = { fan: 0, "seo-marketer": 0 };
  let manifest;
  const raw = head[manifestPath];
  let parsed = false;
  if (raw === undefined)
    errors.push(`[manifest] ${manifestPath} が HEAD に無い`);
  else {
    try {
      manifest = JSON.parse(toText(raw));
      parsed = true;
    } catch (err) {
      errors.push(
        `[manifest] ${manifestPath} を JSON として読めない: ${err.message}`,
      );
    }
  }
  if (parsed && !isPlainObject(manifest)) {
    errors.push(
      `[manifest] ${manifestPath} が JSON のオブジェクトでない（${Array.isArray(manifest) ? "配列" : manifest === null ? "null" : typeof manifest}）`,
    );
  } else if (parsed) {
    // 設定の変更は manifest の paths に入れない（checkGateConfigChange が別に見る）
    const diffPaths = entries.filter(
      (e) => e.path !== manifestPath && e.path !== GATE_CONFIG_PATH,
    );
    const r = checkManifest({
      manifestPath,
      manifest,
      diffPaths,
      head,
      base,
      basePaths,
      headPaths,
      config,
    });
    errors.push(...r.errors);
    p1Recorded = r.p1Recorded;
    if (
      Array.isArray(manifest.judgement_words) &&
      manifest.judgement_words.length > 0
    ) {
      errors.push(
        `[judgement] manifest.judgement_words が空でない（${manifest.judgement_words.join("・")}）。判断が要る記事は PR にしない`,
      );
    }
  }
  return { errors, manifest, p1Recorded };
}

/**
 * 関門の本体。
 * @param {object} input
 * @param {{status: string, path: string, mode?: string}[]} input.diff  git diff --raw --no-renames の行。mode は変更後の mode
 * @param {Record<string, Uint8Array|string>} input.head  HEAD の中身（追加・変更したファイルと、参照された画像）。キーが無い＝HEAD に無い
 * @param {Record<string, string>} input.base  base（分岐元）の中身（変更した .md・JSON。判断が要る句を変えた行・値だけで見るのと、featured の比較に使う）
 * @param {string[]} input.basePaths  base のファイル一覧（slug の衝突、.md と JSON の対応、図の JSON の実在）
 * @param {string[]} input.headPaths  HEAD のファイル一覧（同じ用途）
 * @param {object} input.config  scripts/content/content-pr-gate.json
 */
export function evaluateContentPr({
  diff,
  head,
  base,
  basePaths,
  headPaths = [],
  config,
}) {
  const entries = diff.map((d) => ({
    status: d.status,
    path: d.path,
    mode: d.mode,
  }));
  const errors = entryErrors(entries, config);

  const picked = pickManifest(entries);
  const { manifestPath } = picked;
  errors.push(...picked.errors);

  const live = entries.filter(
    (e) => e.status !== "D" && !MANIFEST_RE.test(e.path),
  );
  const existsAnywhere = new Set([...basePaths, ...headPaths]);

  const read = readTextFiles(live, head);
  const { textFiles } = read;
  errors.push(...read.errors);

  const body = bodyErrors(textFiles, existsAnywhere, config);
  errors.push(
    ...body.errors,
    ...pairErrors(textFiles, existsAnywhere),
    ...slugFeaturedErrors(textFiles, basePaths, base),
    ...imageErrors(textFiles, live, head),
  );

  const judgement = judgementErrors(textFiles, base, config);
  errors.push(...judgement.errors);

  const section = manifestPath
    ? manifestSection(manifestPath, entries, {
        head,
        base,
        basePaths,
        headPaths,
        config,
      })
    : {
        errors: [],
        manifest: undefined,
        p1Recorded: { fan: 0, "seo-marketer": 0 },
      };
  errors.push(...section.errors);

  const gateEntry = entries.find((e) => e.path === GATE_CONFIG_PATH);
  if (gateEntry)
    errors.push(
      ...checkGateConfigChange(gateEntry, {
        head,
        base,
        manifest: isPlainObject(section.manifest)
          ? section.manifest
          : undefined,
      }),
    );

  return {
    ok: errors.length === 0,
    errors,
    judgementWordsFound: judgement.judgementWordsFound,
    p1Recorded: section.p1Recorded,
    // meta（metaTitle・metaDescription）に「競艇」がある記事。暫定の例外を後で一括で外すための一覧
    metaKyotei: body.metaKyotei,
    manifest: manifestPath,
  };
}
