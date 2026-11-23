/**
 * 記事の PR を人の手なしでマージしてよいかの判定（純関数。オーナー 2026-11-23「記事の PR を、審査が通り CI が緑なら
 * 自動でマージする形」に yes）。条件は .claude/skills/owner-session/SKILL.md「マージしてよい範囲」の段階0 F。
 *
 * F の条件を直に見るのに加えて、契約の関門（master の版の scripts/content/check-content-pr.js を PR の木に当てた結果、
 * docs/operation/content-pr-contract.md）が ok でなければ入れない（BOA-1715、11/23 の書き手の移しの前の直し）。
 * 審査の欄だけだと、本文を直した後に manifest を作り直し忘れた版が入りうるため。
 * hq の seo-human の manifest は契約と形が合わない（審査役の名前 hq-review:*・作り手の欄）ので、この関門で止まり、窓口が段階0 F で入れる。
 */

// 記事の PR に入れてよい置き場（段階0 F）
const ALLOWED = [
  /^public\/blog\/[^/]+\.md$/,
  /^src\/data\/blog-posts\/(?:(?:en|ko|zh-TW)\/)?[^/]+\.json$/,
  /^public\/images\/blog\/[^/]+\.(?:jpg|jpeg)$/,
  /^public\/blog-charts\/[^/]+\.json$/,
  /^docs\/content-manifests\/[^/]+\.json$/,
];
const ROLES = ["content-qa", "wording-editor", "fan", "seo-marketer"];
// P1 で止める役（fan・seo-marketer の P1 は助言）
const P1_BLOCKS = ["content-qa", "wording-editor"];
export const REQUIRED_CHECKS = ["e2e", "verify", "ml-tests"];

function filesReasons(headRef, files) {
  const reasons = [];
  if (!/^claude\/content-/.test(headRef)) reasons.push("記事の枝（claude/content-）でない");
  if (files.length === 0) reasons.push("ファイルが無い");
  const bad = files.filter(
    (f) => f.status === "removed" || !ALLOWED.some((re) => re.test(f.path)),
  );
  if (bad.length > 0) reasons.push(`置き場の外か削除: ${bad.map((f) => f.path).join(", ")}`);
  const manifests = files.filter((f) => f.path.startsWith("docs/content-manifests/"));
  if (manifests.length !== 1) reasons.push(`manifest がちょうど1つでない（${manifests.length}）`);
  return reasons;
}

function reviewReason(reviews, role) {
  const r = reviews.find((x) => x?.role === role);
  if (!r) return `審査 ${role} が無い`;
  if (r.result !== "pass") return `審査 ${role} が pass でない`;
  if (r.p0 !== 0) return `審査 ${role} の P0 が0でない`;
  if (P1_BLOCKS.includes(role) && r.p1 !== 0) return `審査 ${role} の P1 が0でない`;
  return null;
}

function manifestReasons(manifest) {
  if (!manifest || typeof manifest !== "object") return ["manifest が読めない"];
  const reviews = Array.isArray(manifest.reviews) ? manifest.reviews : [];
  const reasons = ROLES.map((role) => reviewReason(reviews, role)).filter(Boolean);
  const words = manifest.judgement_words;
  if (!Array.isArray(words) || words.length > 0) reasons.push("判断の要る語がある（または欄が無い）");
  return reasons;
}

function checksReasons(checks) {
  return REQUIRED_CHECKS.flatMap((name) => {
    const runs = checks.filter((c) => c.name === name);
    if (runs.length === 0) return [`必須の check ${name} がまだ無い`];
    return runs.every((c) => c.conclusion === "success") ? [] : [`必須の check ${name} が緑でない`];
  });
}

function contractReasons(contract) {
  if (!contract || contract.ok !== true) {
    const head = (contract?.errors ?? []).slice(0, 2).join(" / ");
    return [`契約の関門が ok でない${head ? `（${head}）` : ""}`];
  }
  return [];
}

/**
 * @param {{headRef: string, files: Array<{path: string, status: string}>, manifest: unknown,
 *          checks: Array<{name: string, conclusion: string|null}>, lane: string,
 *          contract: {ok: boolean, errors?: string[]}}} pr  contract は契約の関門の結果
 * @returns {{merge: boolean, reasons: string[]}} reasons は merge が false の訳（空なら merge）
 */
export function judge(pr) {
  const reasons = [
    ...filesReasons(pr.headRef, pr.files),
    ...manifestReasons(pr.manifest),
    ...checksReasons(pr.checks),
    ...(pr.lane === "light" ? [] : [`pr-lane が ${pr.lane}`]),
    ...contractReasons(pr.contract),
  ];
  return { merge: reasons.length === 0, reasons };
}
