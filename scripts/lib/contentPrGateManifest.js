/**
 * 記事の PR の関門のうち manifest（docs/content-manifests/<id>.json）を見る部分（純粋関数。contentPrGate.js から使う）。
 * 4つの役のレビュー・paths と files・図の JSON・kind・関門の設定の変更。契約: docs/operation/content-pr-contract.md
 */
import {
  CHART_JSON_RE,
  JA_JSON_RE,
  MANIFEST_RE,
  MANIFEST_SCHEMA,
  MD_RE,
  REVIEW_ROLES,
  articleIdOf,
  computeContentSha256,
  countInternalLinks,
  isCount,
  isIso,
  isNonEmptyString,
  isPlainObject,
  sha256Hex,
  toText,
} from "./contentPrGateCommon.js";

// p1 が0でなければ error にする役。残り（fan・seo-marketer）は件数を記録するだけ
const P1_BLOCKING_ROLES = new Set(["content-qa", "wording-editor"]);

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

// manifest の項目（schema・id・kind・ticket・author・時刻・judgement_words）の形
function manifestFieldErrors(manifest, fileId) {
  const errors = [];
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
  return errors;
}

// paths と差分の一致（削除は許さないので、全部「-」なし）
function manifestPathsErrors(manifest, declared, diffPaths) {
  const errors = [];
  if (!Array.isArray(manifest.paths))
    errors.push("[manifest] paths が配列でない");
  if (Array.isArray(manifest.paths) && declared.length === 0)
    errors.push("[manifest] paths が空（記事のファイルの変更が無い）");
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
  return errors;
}

// files と HEAD の中身の一致、content_sha256 と files からの計算の一致
function manifestFilesErrors(manifest, declared, head) {
  const errors = [];
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
  return errors;
}

// 1つの PR に1記事。変えた .md・JSON の記事がすべて manifest.id
function manifestSingleArticleErrors(manifest, diffPaths) {
  const otherIds = [
    ...new Set(diffPaths.map((d) => articleIdOf(d.path)).filter(Boolean)),
  ].filter((id) => id !== manifest.id);
  return otherIds.length > 0
    ? [
        `[manifest] 1つの PR に1記事。manifest.id "${manifest.id}" 以外の記事 ${otherIds.join("・")} が入っている`,
      ]
    : [];
}

const chartArticleOf = (raw) => {
  try {
    const j = JSON.parse(toText(raw));
    return isPlainObject(j) ? j.article : undefined;
  } catch {
    return undefined; // 読めない JSON は [json] で出している
  }
};

// 図の JSON 1つ（差分の1行）が manifest.id の記事のものか
function chartDiffErrors(manifest, d, { head, base, longerIds }) {
  const errors = [];
  const name = d.path.match(CHART_JSON_RE)[1];
  if (
    !name.startsWith(`${manifest.id}-`) ||
    name.length === manifest.id.length + 1
  )
    errors.push(
      `[chart] ${d.path} の名前が「${manifest.id}-{図id}」の形でない（図の名前は {記事id}-{図id}.json）`,
    );
  const owner = longerIds.find((id) => name.startsWith(`${id}-`));
  if (owner)
    errors.push(
      `[chart] ${d.path} は記事 ${owner} の図（manifest.id は "${manifest.id}"）`,
    );
  if (head[d.path] !== undefined) {
    const article = chartArticleOf(head[d.path]);
    if (article !== manifest.id)
      errors.push(
        `[chart] ${d.path} の article ${JSON.stringify(article)} が manifest.id "${manifest.id}" と違う`,
      );
  }
  if (d.status === "M" && base[d.path] !== undefined) {
    const baseArticle = chartArticleOf(base[d.path]);
    if (baseArticle !== manifest.id)
      errors.push(
        `[chart] ${d.path} の base の article ${JSON.stringify(baseArticle)} が manifest.id "${manifest.id}" と違う（別の記事の図は変えない）`,
      );
  }
  return errors;
}

// 図の JSON も manifest.id の記事のもの。名前が「{記事id}-{図id}」、article が記事 id（HEAD も、M なら base も）。
// manifest.id を接頭辞に持つ別の記事（a と a-b）の図は、名前が長いほうの記事 id で始まるので落とす
function manifestChartErrors(
  manifest,
  diffPaths,
  { head, base, basePaths, headPaths },
) {
  const errors = [];
  const chartDiffs = diffPaths.filter((x) => CHART_JSON_RE.test(x.path));
  const longerIds = [...basePaths, ...headPaths]
    .map((p) => p.match(JA_JSON_RE)?.[1])
    .filter((id) => id && id.startsWith(`${manifest.id}-`));
  for (const d of chartDiffs)
    errors.push(...chartDiffErrors(manifest, d, { head, base, longerIds }));
  // 図だけ日々更新しない。図を変えたら同じ記事の本文（.md）も同じ PR で直す（docs/design/blog-charts/contract.md 2節）
  if (
    chartDiffs.length > 0 &&
    !diffPaths.some(
      (d) => MD_RE.test(d.path) && articleIdOf(d.path) === manifest.id,
    )
  )
    errors.push(
      `[chart] 図の JSON を変えたのに、記事の本文（public/blog/${manifest.id}.md か翻訳）の差分が無い（本文と表も同じ PR で直す）`,
    );
  return errors;
}

// kind: new は日本語版 JSON の追加がある、revision は無い
function manifestKindErrors(manifest, diffPaths, basePaths) {
  const errors = [];
  const addsJaJson = diffPaths.some(
    (d) => d.status === "A" && JA_JSON_RE.test(d.path),
  );
  if (manifest.kind === "new" && !addsJaJson)
    errors.push("[manifest] kind が new なのに日本語版 JSON の追加が無い");
  if (manifest.kind === "revision" && addsJaJson)
    errors.push("[manifest] kind が revision なのに日本語版 JSON の追加がある");
  const baseJaJson = `src/data/blog-posts/${manifest.id}.json`;
  if (manifest.kind === "revision" && !basePaths.includes(baseJaJson))
    errors.push(
      `[manifest] kind が revision なのに base に ${baseJaJson} が無い（実在しない記事の改稿）`,
    );
  return errors;
}

export function checkManifest({
  manifestPath,
  manifest,
  diffPaths,
  head,
  base,
  basePaths,
  headPaths,
  config,
}) {
  const fileId = manifestPath.match(MANIFEST_RE)[1];
  const errors = manifestFieldErrors(manifest, fileId);
  const declared = Array.isArray(manifest.paths) ? manifest.paths : [];
  errors.push(
    ...manifestPathsErrors(manifest, declared, diffPaths),
    ...manifestFilesErrors(manifest, declared, head),
    ...manifestSingleArticleErrors(manifest, diffPaths),
    ...manifestChartErrors(manifest, diffPaths, {
      head,
      base,
      basePaths,
      headPaths,
    }),
    ...manifestKindErrors(manifest, diffPaths, basePaths),
  );

  const reviewResult = checkReviews(manifest, config, manifest.content_sha256);
  return {
    errors: [...errors, ...reviewResult.errors],
    p1Recorded: reviewResult.p1Recorded,
  };
}

/**
 * 記事の PR に入った関門の設定（content-pr-gate.json）の変更を見る。オーナー決定 2026-10-26。
 * 通すのは、internalLinkGrandfathered から行を外すだけ（一覧の外のキー・残った行の順は変えない、足さない）で、
 * 外した行がすべて manifest の paths にある記事の .md、かつ改稿後の本文に内部リンクがあるときだけ。
 * 一覧に足す（関門を緩める）変更は通常の PR でオーナー承認（今までどおり）
 * grandfatherRemovals は scripts/maintenance/e2e-scope.js の同じ名前の関数（呼び側が渡す）
 */
export function checkGateConfigChange(
  entry,
  { head, base, manifest },
  grandfatherRemovals,
) {
  const p = entry.path;
  if (entry.status !== "M")
    return [`[gate-config] ${p} は変更（M）だけ扱う（状態 ${entry.status}）`];
  if (base[p] === undefined || head[p] === undefined)
    return [`[gate-config] ${p} の base か HEAD の中身が無い`];
  let baseCfg;
  let headCfg;
  try {
    baseCfg = JSON.parse(base[p]);
    headCfg = JSON.parse(toText(head[p]));
  } catch (err) {
    return [
      `[gate-config] ${p} の base か HEAD を JSON として読めない: ${err.message}`,
    ];
  }
  const removed = grandfatherRemovals(baseCfg, headCfg);
  if (!removed)
    return [
      `[gate-config] ${p} の変更は internalLinkGrandfathered からの削除だけ許す（足す・並べ替え・他のキーの変更・整形だけの変更は通常の PR でオーナー承認）`,
    ];
  const declared = Array.isArray(manifest?.paths) ? manifest.paths : [];
  const errors = [];
  for (const r of removed) {
    if (!MD_RE.test(r) || !declared.includes(r)) {
      errors.push(
        `[gate-config] 一覧から外した ${r} がこの PR の manifest の記事（paths の public/blog/<id>.md）でない`,
      );
      continue;
    }
    if (head[r] === undefined) {
      errors.push(`[gate-config] 一覧から外した ${r} が HEAD に無い`);
      continue;
    }
    if (countInternalLinks(toText(head[r])) === 0)
      errors.push(
        `[gate-config] 一覧から外した ${r} の改稿後の本文に内部リンクが無い（一覧から外せない）`,
      );
  }
  return errors;
}
