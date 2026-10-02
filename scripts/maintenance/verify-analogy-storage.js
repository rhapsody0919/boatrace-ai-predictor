/**
 * アナロジー・ファインダーの学習（BOA-271）で、Supabase Storage の版を壊さない規則を検証する。
 * scripts/ml/analogy/storageRules.js の純粋関数だけを使い、実の Storage に触らない。
 *
 * 1. 古い版を消すとき、表示中の版（is_active）は数に関係なく残す
 * 2. 表示中の版と同じ名前ではアップロードしない（同じ日の再実行で上書きしない）
 * 3. 長期データのキャッシュの列名が今のコードの列と違えば失敗する
 */
import {
  assertCachedHeader,
  assertUploadable,
  versionsToPrune,
} from "../ml/analogy/storageRules.js";

const failures = [];
const check = (label, ok) => {
  console.log(`${ok ? "✅" : "❌"} ${label}`);
  if (!ok) failures.push(label);
};
const throws = (fn) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

const names = [
  "2026-10-04",
  "2026-10-11",
  "2026-10-18",
  "2026-10-25",
  "source",
];
check(
  "新しい順に3つを残し、それより古い版を消す",
  JSON.stringify(versionsToPrune(names, "2026-10-25", 3)) === '["2026-10-04"]',
);
check(
  "表示中の版は古くても消さない（書き込みが3週続けて失敗した場合）",
  versionsToPrune(names, "2026-10-04", 3).length === 0,
);
check(
  "版のフォルダでないもの（source）は消さない",
  !versionsToPrune(names, null, 0).includes("source"),
);
check(
  "表示中の版と同じ名前ではアップロードしない",
  throws(() => assertUploadable("2026-10-25", "2026-10-25")),
);
check(
  "別の名前ならアップロードしてよい",
  !throws(() => assertUploadable("2026-11-01", "2026-10-25")),
);
check(
  "表示中の版が無い（初回）ならアップロードしてよい",
  !throws(() => assertUploadable("2026-11-01", null)),
);
check(
  "キャッシュの列名が一致すれば通る",
  !throws(() => assertCachedHeader("a,b\n1,2", ["a", "b"], "k")),
);
check(
  "キャッシュの列名が違えば失敗する",
  throws(() => assertCachedHeader("a,c\n1,2", ["a", "b"], "k")),
);
check(
  "列名の行しか無いキャッシュも列名で判定する",
  !throws(() => assertCachedHeader("a,b", ["a", "b"], "k")),
);

if (failures.length) {
  console.error(`\n${failures.length}件の失敗`);
  process.exit(1);
}
console.log("\nStorage の版の規則はすべて満たしています");
