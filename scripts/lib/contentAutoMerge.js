/**
 * 記事の PR を人の手なしでマージしてよいかの判定（純関数。オーナー 2026-11-23「記事の PR を、審査が通り CI が緑なら
 * 自動でマージする形」に yes）。条件は .claude/skills/owner-session/SKILL.md「マージしてよい範囲」の段階0 F。
 *
 * 今の書き手は非公開の hq の seo-human で、manifest の審査役の名前（hq-review:*）と作り手の欄が
 * docs/operation/content-pr-contract.md の契約と合わないので、check-content-pr.js の判定は使わず、F の条件を直に見る。
 * 書き手を龍神へ移したら（hq 閉鎖の段2）、契約どおりの manifest にして check-content-pr.js に寄せる。
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

/**
 * @param {{headRef: string, files: Array<{path: string, status: string}>, manifest: unknown,
 *          checks: Array<{name: string, conclusion: string|null}>, lane: string}} pr
 * @returns {{merge: boolean, reasons: string[]}} reasons は merge が false の訳（空なら merge）
 */
export function judge(pr) {
  const reasons = [];
  if (!/^claude\/content-/.test(pr.headRef)) reasons.push("記事の枝（claude/content-）でない");
  const bad = pr.files.filter(
    (f) => f.status === "removed" || !ALLOWED.some((re) => re.test(f.path)),
  );
  if (pr.files.length === 0) reasons.push("ファイルが無い");
  if (bad.length > 0) reasons.push(`置き場の外か削除: ${bad.map((f) => f.path).join(", ")}`);
  const manifests = pr.files.filter((f) => f.path.startsWith("docs/content-manifests/"));
  if (manifests.length !== 1) reasons.push(`manifest がちょうど1つでない（${manifests.length}）`);

  const m = pr.manifest && typeof pr.manifest === "object" ? pr.manifest : null;
  if (!m) reasons.push("manifest が読めない");
  else {
    const reviews = Array.isArray(m.reviews) ? m.reviews : [];
    for (const role of ROLES) {
      const r = reviews.find((x) => x?.role === role);
      if (!r) reasons.push(`審査 ${role} が無い`);
      else if (r.result !== "pass") reasons.push(`審査 ${role} が pass でない`);
      else if (r.p0 !== 0) reasons.push(`審査 ${role} の P0 が0でない`);
      else if (P1_BLOCKS.includes(role) && r.p1 !== 0) reasons.push(`審査 ${role} の P1 が0でない`);
    }
    if (!Array.isArray(m.judgement_words) || m.judgement_words.length > 0)
      reasons.push("判断の要る語がある（または欄が無い）");
  }

  for (const name of REQUIRED_CHECKS) {
    const runs = pr.checks.filter((c) => c.name === name);
    if (runs.length === 0) reasons.push(`必須の check ${name} がまだ無い`);
    else if (!runs.every((c) => c.conclusion === "success")) reasons.push(`必須の check ${name} が緑でない`);
  }
  if (pr.lane !== "light") reasons.push(`pr-lane が ${pr.lane}`);
  return { merge: reasons.length === 0, reasons };
}
