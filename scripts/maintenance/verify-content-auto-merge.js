/**
 * verify-content-auto-merge.js - 記事の PR を人の手なしでマージしてよいかの判定（scripts/lib/contentAutoMerge.js）を確かめる。
 * 守る物: 段階0 F の条件を1つでも欠く PR はマージしない（置き場の外・削除・審査の不合格・P0・content-qa と言葉の P1・
 * 判断の要る語・必須の check が緑でない・pr-lane が light でない・記事の枝でない）。ネットワークに触れない。
 */
import assert from "node:assert/strict";
import { judge } from "../lib/contentAutoMerge.js";

const rv = (role, p0 = 0, p1 = 0, result = "pass") => ({ role, result, p0, p1 });
const ok = () => ({
  headRef: "claude/content-toda-wind",
  files: [
    { path: "public/blog/toda-wind.md", status: "added" },
    { path: "src/data/blog-posts/toda-wind.json", status: "added" },
    { path: "docs/content-manifests/toda-wind.json", status: "added" },
  ],
  manifest: {
    reviews: [rv("content-qa"), rv("wording-editor"), rv("fan", 0, 2), rv("seo-marketer", 0, 1)],
    judgement_words: [],
  },
  checks: [
    { name: "e2e", conclusion: "success" },
    { name: "verify", conclusion: "success" },
    { name: "ml-tests", conclusion: "success" },
  ],
  lane: "light",
});

assert.deepEqual(judge(ok()), { merge: true, reasons: [] }, "fan・seo の P1 は助言なので止めない");

const no = (mutate, why) => {
  const pr = ok();
  mutate(pr);
  assert.equal(judge(pr).merge, false, why);
};
no((p) => (p.headRef = "claude/boa-1-x"), "記事の枝でない");
no((p) => p.files.push({ path: "src/App.jsx", status: "modified" }), "置き場の外");
no((p) => (p.files[0].status = "removed"), "削除");
no((p) => p.files.push({ path: "docs/content-manifests/b.json", status: "added" }), "manifest が2つ");
no((p) => (p.manifest = null), "manifest が読めない");
no((p) => (p.manifest.reviews = p.manifest.reviews.slice(1)), "審査が欠ける");
no((p) => (p.manifest.reviews[0] = rv("content-qa", 0, 0, "fail")), "不合格");
no((p) => (p.manifest.reviews[2] = rv("fan", 1, 0)), "P0 はどの役でも止める");
no((p) => (p.manifest.reviews[0] = rv("content-qa", 0, 1)), "content-qa の P1");
no((p) => (p.manifest.reviews[1] = rv("wording-editor", 0, 1)), "言葉の P1");
no((p) => (p.manifest.judgement_words = ["回収率"]), "判断の要る語");
no((p) => delete p.manifest.judgement_words, "判断の語の欄が無い");
no((p) => (p.checks = p.checks.slice(1)), "必須の check が無い");
no((p) => (p.checks[0].conclusion = "failure"), "必須の check が赤");
no((p) => p.checks.push({ name: "e2e", conclusion: null }), "同じ名の check が走っている");
no((p) => (p.lane = "heavy"), "heavy");
no((p) => (p.lane = "unknown"), "pr-lane が読めない");

console.log("verify-content-auto-merge: OK（段階0 F の条件を欠く PR はマージしない）");
