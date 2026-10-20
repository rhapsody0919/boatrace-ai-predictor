/**
 * 記事の中身だけの PR を機械で判定する関門（純粋関数）。
 * fs・git・時計に触れない。入力は全部引数で受ける（集めるのは scripts/content/check-content-pr.js）。
 * 契約: docs/operation/content-pr-contract.md、設定: scripts/content/content-pr-gate.json
 */
import { createHash } from "node:crypto";

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
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TRANSLATION_SUFFIX_RE = /-(en|ko|zh-tw)$/;
const MANIFEST_RE = /^docs\/content-manifests\/([^/]+)\.json$/;
const JA_JSON_RE = /^src\/data\/blog-posts\/([^/]+)\.json$/;
const MD_RE = /^public\/blog\/[^/]+\.md$/;
const JSON_RE = /^src\/data\/blog-posts\/(?:[^/]+\/)?[^/]+\.json$/;
const IMAGE_RE = /^public\/images\/blog\/[^/]+$/;
const IMAGE_REF_RE = /\/images\/blog\/[^\s)"'\]>]+/g;

export const sha256Hex = (data) =>
  createHash("sha256").update(data).digest("hex");

const toText = (data) =>
  typeof data === "string" ? data : new TextDecoder("utf-8").decode(data);

const isNonEmptyString = (v) => typeof v === "string" && v.trim() !== "";

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

/** フェンスのコードブロックとインラインコードを除いた行（行番号つき） */
function proseLines(text) {
  const out = [];
  let fence = null;
  text.split("\n").forEach((line, idx) => {
    const m = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length)
        fence = null;
      return;
    }
    if (m) {
      fence = m[1];
      return;
    }
    out.push({ no: idx + 1, text: line.replace(/(`+)[\s\S]*?\1/g, "") });
  });
  return out;
}

/** 生の HTML: .md 本文（コードを除く）に `<` の直後が英字・`/`・`!` のものが0件 */
export function checkRawHtml(path, text) {
  return proseLines(text)
    .filter((l) => /<[A-Za-z/!]/.test(l.text))
    .map((l) => `[html] ${path}:${l.no} 本文に HTML タグがある`);
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

/** 「競艇」: JSON の title・description に0件（metaTitle・metaDescription は許す） */
export function checkKyoteiJson(path, obj) {
  return ["title", "description"]
    .filter((k) => typeof obj?.[k] === "string" && obj[k].includes(KYOTEI))
    .map((k) => `[kyotei] ${path} の ${k} に「${KYOTEI}」がある`);
}

/** 内部リンク: `](/` で始まるリンクが1本以上。既存の免除一覧は改稿（status M）のときだけ効く */
export function checkInternalLinks(path, text, status, config) {
  if (text.includes("](/")) return [];
  const grandfathered =
    status === "M" && (config.internalLinkGrandfathered ?? []).includes(path);
  return grandfathered
    ? []
    : [`[link] ${path} に内部リンク（](/ で始まるリンク）が無い`];
}

const collectStrings = (v) =>
  typeof v === "string"
    ? [v]
    : Array.isArray(v)
      ? v.flatMap(collectStrings)
      : v && typeof v === "object"
        ? Object.values(v).flatMap(collectStrings)
        : [];

/** 判断が要る語を探す。.md の「競艇」の例外行は「競艇」の対象から外す */
function findJudgementWords(textFiles, config) {
  const found = new Set();
  for (const f of textFiles) {
    const strings = f.kind === "md" ? [f.text] : collectStrings(f.json);
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

const normalizeStatus = (s) => (s === "T" ? "M" : s);

function parseManifestPaths(paths) {
  return paths.map((p) =>
    p.startsWith("-")
      ? { path: p.slice(1), deleted: true }
      : { path: p, deleted: false },
  );
}

const isIso = (v) => isNonEmptyString(v) && !Number.isNaN(Date.parse(v));
const isCount = (v) => Number.isInteger(v) && v >= 0;

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
  const contentAt = Date.parse(manifest.content_at);
  const createdAt = Date.parse(manifest.created_at);

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
    if (!isIso(r.at)) errors.push(`${label} の at が ISO の時刻でない`);
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
    errors.push("[manifest] content_at が ISO の時刻でない");
  if (!isIso(manifest.created_at))
    errors.push("[manifest] created_at が ISO の時刻でない");
  if (
    !Array.isArray(manifest.judgement_words) ||
    !manifest.judgement_words.every((w) => typeof w === "string")
  ) {
    errors.push("[manifest] judgement_words が文字列の配列でない");
  }

  // paths と差分の一致（追加・変更は「-」なし、削除は「-」つき）
  const declared = Array.isArray(manifest.paths) ? manifest.paths : [];
  if (!Array.isArray(manifest.paths))
    errors.push("[manifest] paths が配列でない");
  if (new Set(declared).size !== declared.length)
    errors.push("[manifest] paths に重複がある");
  const expected = new Set(
    diffPaths.map((d) => (d.status === "D" ? `-${d.path}` : d.path)),
  );
  const declaredSet = new Set(declared);
  for (const p of expected)
    if (!declaredSet.has(p))
      errors.push(`[manifest] paths に差分の ${p} が無い`);
  for (const p of declaredSet)
    if (!expected.has(p)) errors.push(`[manifest] paths の ${p} が差分に無い`);

  // files と HEAD の中身の一致
  const files =
    manifest.files && typeof manifest.files === "object" ? manifest.files : {};
  if (!manifest.files || typeof manifest.files !== "object")
    errors.push("[manifest] files がオブジェクトでない");
  const livePaths = parseManifestPaths(declared)
    .filter((p) => !p.deleted)
    .map((p) => p.path);
  const fileKeys = Object.keys(files);
  for (const p of livePaths)
    if (!(p in files)) errors.push(`[manifest] files に ${p} が無い`);
  for (const p of fileKeys) {
    if (!livePaths.includes(p)) {
      errors.push(`[manifest] files の ${p} が paths（削除以外）に無い`);
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

  const reviewResult = checkReviews(manifest, config, manifest.content_sha256);
  return {
    errors: [...errors, ...reviewResult.errors],
    p1Recorded: reviewResult.p1Recorded,
  };
}

/**
 * 関門の本体。
 * @param {object} input
 * @param {{status: string, path: string}[]} input.diff  git diff --name-status --no-renames の行（A/M/D/T）
 * @param {Record<string, Uint8Array|string>} input.head  HEAD の中身（追加・変更したファイルと、参照された画像）。キーが無い＝HEAD に無い
 * @param {Record<string, string>} input.base  base の中身（変更した日本語版 JSON。featured の比較に使う）
 * @param {string[]} input.basePaths  base のファイル一覧（slug の衝突を見る）
 * @param {object} input.config  scripts/content/content-pr-gate.json
 */
export function evaluateContentPr({ diff, head, base, basePaths, config }) {
  const errors = [];
  const entries = diff.map((d) => ({
    status: normalizeStatus(d.status),
    path: d.path,
  }));

  // 許可のパス
  const patterns = (config.allowedPathPatterns ?? []).map((s) => new RegExp(s));
  for (const e of entries) {
    if (!["A", "M", "D"].includes(e.status))
      errors.push(`[path] ${e.path} の状態 ${e.status} は扱わない`);
    if (!patterns.some((re) => re.test(e.path)))
      errors.push(`[path] ${e.path} は記事の PR で変えてよいパスでない`);
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

  // .md と JSON を読む
  const textFiles = [];
  for (const e of live) {
    if (MD_RE.test(e.path)) {
      if (head[e.path] === undefined)
        errors.push(`[path] ${e.path} が HEAD に無い`);
      else textFiles.push({ ...e, kind: "md", text: toText(head[e.path]) });
    } else if (JSON_RE.test(e.path)) {
      if (head[e.path] === undefined) {
        errors.push(`[path] ${e.path} が HEAD に無い`);
        continue;
      }
      const text = toText(head[e.path]);
      try {
        textFiles.push({ ...e, kind: "json", text, json: JSON.parse(text) });
      } catch (err) {
        errors.push(`[json] ${e.path} を JSON として読めない: ${err.message}`);
      }
    }
  }

  // 本文の関門
  for (const f of textFiles) {
    if (f.kind === "md") {
      errors.push(
        ...checkRawHtml(f.path, f.text),
        ...checkKyoteiMd(f.path, f.text, config),
        ...checkInternalLinks(f.path, f.text, f.status, config),
      );
    } else {
      errors.push(...checkKyoteiJson(f.path, f.json));
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
      if (f.json && typeof f.json === "object" && "featuredRank" in f.json)
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

  // 判断が要る語
  const judgementWordsFound = findJudgementWords(textFiles, config);

  // manifest
  let p1Recorded = { fan: 0, "seo-marketer": 0 };
  let declaredWords = [];
  if (manifestPath) {
    const raw = head[manifestPath];
    let manifest = null;
    if (raw === undefined)
      errors.push(`[manifest] ${manifestPath} が HEAD に無い`);
    else {
      try {
        manifest = JSON.parse(toText(raw));
      } catch (err) {
        errors.push(
          `[manifest] ${manifestPath} を JSON として読めない: ${err.message}`,
        );
      }
    }
    if (manifest && typeof manifest === "object") {
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
      declaredWords = Array.isArray(manifest.judgement_words)
        ? manifest.judgement_words
        : [];
      const missing = judgementWordsFound.filter(
        (w) => !declaredWords.includes(w),
      );
      if (missing.length > 0) {
        errors.push(
          `[judgement] manifest.judgement_words に見つかった語 ${missing.join("・")} が無い`,
        );
      }
    }
  }

  const hold = judgementWordsFound.length > 0 || declaredWords.length > 0;
  return {
    ok: errors.length === 0,
    hold,
    errors,
    judgementWordsFound,
    p1Recorded,
    manifest: manifestPath,
  };
}
