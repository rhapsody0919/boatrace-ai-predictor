/**
 * 記事の中身だけの PR を機械で判定する関門（純粋関数）。
 * fs・git・時計に触れない。入力は全部引数で受ける（集めるのは scripts/content/check-content-pr.js）。
 * 契約: docs/operation/content-pr-contract.md、設定: scripts/content/content-pr-gate.json
 */
import { createHash } from "node:crypto";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { parseBlogChartLine } from "../../src/utils/blogChartTag.js";

export const MANIFEST_SCHEMA = "content-pr-manifest/v1";
export const REVIEW_ROLES = [
  "content-qa",
  "wording-editor",
  "fan",
  "seo-marketer",
];
// p1 が0でなければ error にする役。残り（fan・seo-marketer）は件数を記録するだけ
const P1_BLOCKING_ROLES = new Set(["content-qa", "wording-editor"]);
const KYOTEI = "競艇";
// JSON で「競艇」を許すキー（画面に出ないメタ情報。.claude/rules/code-style.md の例外1）
const KYOTEI_ALLOWED_JSON_KEYS = new Set(["metaTitle", "metaDescription"]);
const REGULAR_FILE_MODE = "100644";
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TRANSLATION_SUFFIX_RE = /-(en|ko|zh-tw)$/;
const MANIFEST_RE = /^docs\/content-manifests\/([^/]+)\.json$/;
const JA_JSON_RE = /^src\/data\/blog-posts\/([^/]+)\.json$/;
const TR_JSON_RE = /^src\/data\/blog-posts\/(?:en|ko|zh-TW)\/([^/]+)\.json$/;
const MD_RE = /^public\/blog\/([^/]+)\.md$/;
const IMAGE_RE = /^public\/images\/blog\/[^/]+$/;
const IMAGE_REF_RE = /\/images\/blog\/[^\s)"'\]>]+/g;
// 末尾が Z か ±hh:mm の ISO 8601 だけ受ける
const ISO_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

export const sha256Hex = (data) =>
  createHash("sha256").update(data).digest("hex");

const toText = (data) =>
  typeof data === "string" ? data : new TextDecoder("utf-8").decode(data);

const isNonEmptyString = (v) => typeof v === "string" && v.trim() !== "";
const isPlainObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * JPEG のヘッダー（SOF）から幅と高さを読む。読めなければ null。
 * PR #1699 の scripts/lib/blogImageDimensions.js の readJpegSize と同じ考え方。
 * #1699 が master に入ったら、そちらに共通化する。
 */
export function readJpegSize(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1; // 詰め物の 0xFF
      continue;
    }
    // 長さを持たない単独のマーカー
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof) {
      if (i + 8 >= b.length) return null;
      const height = (b[i + 5] << 8) | b[i + 6];
      const width = (b[i + 7] << 8) | b[i + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

/** files（path→sha256）から content_sha256 を作る。path の昇順、各行 "path\tsha\n" をつないだ UTF-8 の sha256 */
export function computeContentSha256(files) {
  const body = Object.keys(files)
    .sort()
    .map((p) => `${p}\t${files[p]}\n`)
    .join("");
  return sha256Hex(Buffer.from(body, "utf8"));
}

/** 記事の描画（react-markdown + remark-gfm）と同じ GFM で mdast にする */
const parseMarkdown = (text) =>
  fromMarkdown(text, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });

const walk = (node, fn) => {
  fn(node);
  for (const c of node.children ?? []) walk(c, fn);
};

const isBlankLine = (line) => line !== undefined && line.trim() === "";

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
  if (!isBlankLine(lines[start.line - 2]) || !isBlankLine(lines[start.line]))
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

/** 「競艇」: JSON の metaTitle・metaDescription 以外のすべての文字列値（tags・category を含む）に0件 */
export function checkKyoteiJson(path, obj) {
  return collectKeyedStrings(obj)
    .filter(
      ({ keyPath, value }) =>
        value.includes(KYOTEI) &&
        !keyPath.some((k) => KYOTEI_ALLOWED_JSON_KEYS.has(k)),
    )
    .map(
      ({ keyPath }) =>
        `[kyotei] ${path} の ${keyPath.join(".") || "(値)"} に「${KYOTEI}」がある`,
    );
}

const isInternalUrl = (url) =>
  typeof url === "string" && url.startsWith("/") && !url.startsWith("//");

/** 内部リンクの本数。link と、定義が内部の linkReference を数える。画像・プロトコル相対（//）は数えない */
export function countInternalLinks(text) {
  const tree = parseMarkdown(text);
  const defs = new Map();
  walk(tree, (n) => {
    if (n.type === "definition") defs.set(n.identifier, n.url);
  });
  let count = 0;
  walk(tree, (n) => {
    if (n.type === "link" && isInternalUrl(n.url)) count += 1;
    if (n.type === "linkReference" && isInternalUrl(defs.get(n.identifier)))
      count += 1;
  });
  return count;
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

/** 判断が要る語を探す。.md の「競艇」の例外行は「競艇」の対象から外す */
function findJudgementWords(textFiles, config) {
  const found = new Set();
  for (const f of textFiles) {
    const strings =
      f.kind === "md"
        ? [f.text]
        : collectKeyedStrings(f.json).map((s) => s.value);
    for (const word of config.judgementWords ?? []) {
      const hit = strings.some((s) => {
        if (word === KYOTEI && f.kind === "md") {
          return s
            .split("\n")
            .some(
              (line) =>
                line.includes(word) &&
                !isKyoteiExceptionLine(f.path, line, config),
            );
        }
        return s.includes(word);
      });
      if (hit) found.add(word);
    }
  }
  return (config.judgementWords ?? []).filter((w) => found.has(w));
}

/** 変えた .md・JSON が参照する画像のリポジトリ上のパス（public/ つき）。CLI が HEAD から読む対象を決めるのにも使う */
export function referencedImagePaths(texts) {
  const refs = new Set();
  for (const t of texts) {
    for (const m of t.matchAll(IMAGE_REF_RE)) refs.add(`public${m[0]}`);
  }
  return [...refs].sort();
}

const isIso = (v) =>
  typeof v === "string" && ISO_RE.test(v) && !Number.isNaN(Date.parse(v));
const isCount = (v) => Number.isInteger(v) && v >= 0;

/** パスが属する記事の id（.md は翻訳の接尾辞を外す、JSON はファイル名）。記事のファイルでなければ null */
function articleIdOf(path) {
  const md = path.match(MD_RE);
  if (md) return md[1].replace(TRANSLATION_SUFFIX_RE, "");
  const ja = path.match(JA_JSON_RE);
  if (ja) return ja[1];
  const tr = path.match(TR_JSON_RE);
  return tr ? tr[1] : null;
}

function checkReviews(manifest, config, contentSha) {
  const errors = [];
  const p1Recorded = { fan: 0, "seo-marketer": 0 };
  const reviews = Array.isArray(manifest.reviews) ? manifest.reviews : null;
  if (!reviews)
    return { errors: ["[manifest] reviews が配列でない"], p1Recorded };

  for (const role of REVIEW_ROLES) {
    const n = reviews.filter((r) => r?.role === role).length;
    if (n !== 1)
      errors.push(`[review] role ${role} が ${n} 行ある（ちょうど1行が要る）`);
  }
  const contentAt = isIso(manifest.content_at)
    ? Date.parse(manifest.content_at)
    : NaN;
  const createdAt = isIso(manifest.created_at)
    ? Date.parse(manifest.created_at)
    : NaN;

  reviews.forEach((r, idx) => {
    const label = `[review] reviews[${idx}]（${r?.role ?? "role なし"}）`;
    if (!REVIEW_ROLES.includes(r?.role)) {
      errors.push(`${label} の role が4つの役のどれでもない`);
      return;
    }
    const allowed = config.allowedReviewAgents?.[r.role] ?? [];
    if (!allowed.includes(r.agent)) {
      errors.push(
        `${label} の agent "${r.agent}" は許されていない（許す: ${allowed.join(", ")}）`,
      );
    }
    if (r.result !== "pass")
      errors.push(`${label} の result が pass でない（${r.result}）`);
    if (!isCount(r.p0)) errors.push(`${label} の p0 が0以上の整数でない`);
    else if (r.p0 !== 0) errors.push(`${label} の p0 が ${r.p0} 件ある`);
    if (!isCount(r.p1)) errors.push(`${label} の p1 が0以上の整数でない`);
    else if (P1_BLOCKING_ROLES.has(r.role) && r.p1 !== 0) {
      errors.push(`${label} の p1 が ${r.p1} 件ある`);
    } else if (!P1_BLOCKING_ROLES.has(r.role)) p1Recorded[r.role] = r.p1;
    if (r.reviewed_sha256 !== contentSha) {
      errors.push(`${label} の reviewed_sha256 が content_sha256 と違う`);
    }
    if (!isNonEmptyString(r.model)) errors.push(`${label} の model が空`);
    if (!isIso(r.at))
      errors.push(`${label} の at が ISO の時刻でない（末尾は Z か ±hh:mm）`);
    else {
      const at = Date.parse(r.at);
      if (!Number.isNaN(contentAt) && at < contentAt)
        errors.push(`${label} の at が content_at より前`);
      if (!Number.isNaN(createdAt) && at > createdAt)
        errors.push(`${label} の at が created_at より後`);
    }
  });
  return { errors, p1Recorded };
}

function checkManifest({ manifestPath, manifest, diffPaths, head, config }) {
  const errors = [];
  const fileId = manifestPath.match(MANIFEST_RE)[1];
  if (manifest.schema !== MANIFEST_SCHEMA)
    errors.push(`[manifest] schema が ${MANIFEST_SCHEMA} でない`);
  if (manifest.id !== fileId)
    errors.push(
      `[manifest] id "${manifest.id}" がファイル名 "${fileId}" と違う`,
    );
  if (!["new", "revision"].includes(manifest.kind))
    errors.push("[manifest] kind が new か revision でない");
  if (!isNonEmptyString(manifest.ticket)) errors.push("[manifest] ticket が空");
  if (!isNonEmptyString(manifest.author?.model))
    errors.push("[manifest] author.model が空");
  if (!isNonEmptyString(manifest.author?.lane))
    errors.push("[manifest] author.lane が空");
  if (!isIso(manifest.content_at))
    errors.push(
      "[manifest] content_at が ISO の時刻でない（末尾は Z か ±hh:mm）",
    );
  if (!isIso(manifest.created_at))
    errors.push(
      "[manifest] created_at が ISO の時刻でない（末尾は Z か ±hh:mm）",
    );
  if (
    !Array.isArray(manifest.judgement_words) ||
    !manifest.judgement_words.every((w) => typeof w === "string")
  ) {
    errors.push("[manifest] judgement_words が文字列の配列でない");
  }

  // paths と差分の一致（削除は許さないので、全部「-」なし）
  const declared = Array.isArray(manifest.paths) ? manifest.paths : [];
  if (!Array.isArray(manifest.paths))
    errors.push("[manifest] paths が配列でない");
  if (new Set(declared).size !== declared.length)
    errors.push("[manifest] paths に重複がある");
  if (declared.some((p) => typeof p !== "string" || p.startsWith("-")))
    errors.push(
      "[delete] manifest.paths に削除（-）がある。記事の PR では削除を許さない",
    );
  const expected = new Set(diffPaths.map((d) => d.path));
  const declaredSet = new Set(declared);
  for (const p of expected)
    if (!declaredSet.has(p))
      errors.push(`[manifest] paths に差分の ${p} が無い`);
  for (const p of declaredSet)
    if (!expected.has(p)) errors.push(`[manifest] paths の ${p} が差分に無い`);

  // files と HEAD の中身の一致
  const files = isPlainObject(manifest.files) ? manifest.files : {};
  if (!isPlainObject(manifest.files))
    errors.push("[manifest] files がオブジェクトでない");
  const livePaths = declared.filter(
    (p) => typeof p === "string" && !p.startsWith("-"),
  );
  for (const p of livePaths)
    if (!(p in files)) errors.push(`[manifest] files に ${p} が無い`);
  for (const p of Object.keys(files)) {
    if (!livePaths.includes(p)) {
      errors.push(`[manifest] files の ${p} が paths に無い`);
      continue;
    }
    if (head[p] === undefined)
      errors.push(`[manifest] files の ${p} が HEAD に無い`);
    else if (files[p] !== sha256Hex(head[p]))
      errors.push(`[manifest] files の ${p} の sha256 が HEAD の中身と違う`);
  }
  const contentSha = computeContentSha256(files);
  if (manifest.content_sha256 !== contentSha)
    errors.push("[manifest] content_sha256 が files からの計算と違う");

  // 1つの PR に1記事。変えた .md・JSON の記事がすべて manifest.id
  const otherIds = [
    ...new Set(diffPaths.map((d) => articleIdOf(d.path)).filter(Boolean)),
  ].filter((id) => id !== manifest.id);
  if (otherIds.length > 0)
    errors.push(
      `[manifest] 1つの PR に1記事。manifest.id "${manifest.id}" 以外の記事 ${otherIds.join("・")} が入っている`,
    );

  // kind: new は日本語版 JSON の追加がある、revision は無い
  const addsJaJson = diffPaths.some(
    (d) => d.status === "A" && JA_JSON_RE.test(d.path),
  );
  if (manifest.kind === "new" && !addsJaJson)
    errors.push("[manifest] kind が new なのに日本語版 JSON の追加が無い");
  if (manifest.kind === "revision" && addsJaJson)
    errors.push("[manifest] kind が revision なのに日本語版 JSON の追加がある");

  const reviewResult = checkReviews(manifest, config, manifest.content_sha256);
  return {
    errors: [...errors, ...reviewResult.errors],
    p1Recorded: reviewResult.p1Recorded,
  };
}

/**
 * 関門の本体。
 * @param {object} input
 * @param {{status: string, path: string, mode?: string}[]} input.diff  git diff --raw --no-renames の行。mode は変更後の mode
 * @param {Record<string, Uint8Array|string>} input.head  HEAD の中身（追加・変更したファイルと、参照された画像）。キーが無い＝HEAD に無い
 * @param {Record<string, string>} input.base  base の中身（変更した日本語版 JSON。featured の比較に使う）
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
  const errors = [];
  const entries = diff.map((d) => ({
    status: d.status,
    path: d.path,
    mode: d.mode,
  }));

  // 許可のパス・状態・ファイルの型
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
    else if (!patterns.some((re) => re.test(e.path)))
      errors.push(`[path] ${e.path} は記事の PR で変えてよいパスでない`);
    if (e.status !== "D" && e.mode !== REGULAR_FILE_MODE)
      errors.push(
        `[mode] ${e.path} の mode が ${e.mode ?? "不明"}（${REGULAR_FILE_MODE} の通常のファイルだけ許す）`,
      );
  }

  // manifest はちょうど1つ（追加か変更）
  const manifestEntries = entries.filter((e) => MANIFEST_RE.test(e.path));
  const liveManifests = manifestEntries.filter((e) => e.status !== "D");
  let manifestPath = null;
  if (manifestEntries.length !== 1 || liveManifests.length !== 1) {
    errors.push(
      `[manifest] docs/content-manifests/ の差分がちょうど1つ（追加か変更）でない（${manifestEntries.length} 件）`,
    );
  } else {
    manifestPath = liveManifests[0].path;
  }

  const live = entries.filter(
    (e) => e.status !== "D" && !MANIFEST_RE.test(e.path),
  );
  const existsAnywhere = new Set([...basePaths, ...headPaths]);

  // .md と JSON を読む
  const textFiles = [];
  for (const e of live) {
    const isMd = MD_RE.test(e.path);
    const isJson = JA_JSON_RE.test(e.path) || TR_JSON_RE.test(e.path);
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

  // 本文の関門
  const chartExists = (p) => existsAnywhere.has(p);
  for (const f of textFiles) {
    if (f.kind === "md") {
      errors.push(
        ...checkRawHtml(f.path, f.text, chartExists),
        ...checkKyoteiMd(f.path, f.text, config),
        ...checkInternalLinks(f.path, f.text, f.status, config),
      );
    } else {
      errors.push(...checkKyoteiJson(f.path, f.json));
    }
  }

  // .md と JSON の対応
  for (const f of textFiles) {
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

  // slug と featured（日本語版 JSON）
  const basePathSet = new Set(basePaths);
  for (const f of textFiles.filter(
    (t) => t.kind === "json" && JA_JSON_RE.test(t.path),
  )) {
    const fileId = f.path.match(JA_JSON_RE)[1];
    const id = f.json?.id;
    if (f.status === "A") {
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
        errors.push(
          `[featured] ${f.path} は新規なので featuredRank を置かない`,
        );
    } else {
      const baseText = base[f.path];
      if (baseText === undefined) {
        errors.push(`[featured] ${f.path} の base の中身が無い`);
        continue;
      }
      let baseJson;
      try {
        baseJson = JSON.parse(baseText);
      } catch (err) {
        errors.push(
          `[featured] ${f.path} の base を JSON として読めない: ${err.message}`,
        );
        continue;
      }
      for (const k of ["featured", "featuredRank"]) {
        if (JSON.stringify(f.json?.[k]) !== JSON.stringify(baseJson?.[k])) {
          errors.push(`[featured] ${f.path} の ${k} を base から変えている`);
        }
      }
    }
  }

  // 画像: 参照先が HEAD にあり寸法が読める。足した画像はどれかが参照している
  const refs = referencedImagePaths(textFiles.map((f) => f.text));
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
    if (e.status === "A" && !refSet.has(e.path))
      errors.push(`[image] 足した ${e.path} をどの .md・JSON も参照していない`);
  }

  // 判断が要る語。実行役は、判断が要る語があれば PR を作らずオーナーへ回す（2026-10-20 オーケストレーター決定）。
  // PR に来た時点で道を外れているので、見つかれば error にする
  const judgementWordsFound = findJudgementWords(textFiles, config);
  if (judgementWordsFound.length > 0) {
    errors.push(
      `[judgement] 判断が要る語 ${judgementWordsFound.join("・")} が入っている（PR を作らずオーナーの判断へ回す）`,
    );
  }

  // manifest
  let p1Recorded = { fan: 0, "seo-marketer": 0 };
  if (manifestPath) {
    const raw = head[manifestPath];
    let manifest;
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
      const diffPaths = entries.filter((e) => e.path !== manifestPath);
      const r = checkManifest({
        manifestPath,
        manifest,
        diffPaths,
        head,
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
  }

  return {
    ok: errors.length === 0,
    errors,
    judgementWordsFound,
    p1Recorded,
    manifest: manifestPath,
  };
}
