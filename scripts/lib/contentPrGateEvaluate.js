/**
 * 記事の PR の関門の本体 evaluateContentPr（純粋関数）。fs・git・時計に触れない。
 * 入力は全部引数で受ける（集めるのは scripts/content/check-content-pr.js）。契約: docs/operation/content-pr-contract.md
 * contentPrGate.js が公開の名前として再 export する
 */
import { GATE_CONFIG_PATH } from "../maintenance/e2e-scope.js";
import {
  CHART_JSON_RE,
  JA_JSON_RE,
  MANIFEST_RE,
  MD_RE,
  TR_JSON_RE,
  TRANSLATION_SUFFIX_RE,
  isPlainObject,
  readJpegSize,
  toText,
} from "./contentPrGateCommon.js";
import { pairErrors, slugFeaturedErrors } from "./contentPrGatePosts.js";
import {
  checkGateConfigChange,
  checkManifest,
} from "./contentPrGateManifest.js";
import {
  changedTextsOf,
  checkInternalLinks,
  checkKyoteiJson,
  checkKyoteiMd,
  checkRawHtml,
  findJudgementPhrases,
  referencedImagePaths,
} from "./contentPrGateText.js";

const REGULAR_FILE_MODE = "100644";
const IMAGE_RE = /^public\/images\/blog\/[^/]+$/;

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
