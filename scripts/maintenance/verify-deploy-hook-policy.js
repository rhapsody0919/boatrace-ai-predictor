/**
 * verify-deploy-hook-policy.js - Deploy Hookを叩く条件の判定
 * （scripts/lib/deployHookPolicy.js、BOA-361）の検証。
 *
 * 確認する観点:
 *   1. 未設定・更新0件・窓の外では叩かない（境界: 分が0/4/5/9/10）
 *   2. 窓の中で更新があれば叩く
 *   3. 実行環境のタイムゾーンに依存しない（JSTの分とUTCの分が一致する）
 *   4. 実行間隔ごとの起動回数の見積り（従来: 実行のたびに叩く）
 */
import {
  DEPLOY_HOOK_WINDOW_MINUTES,
  decideDeployHook,
} from "../lib/deployHookPolicy.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

const HOOK = "http://localhost:0/hook";
// 2026-09-19 の JST hh:mm を、対応するUTC時刻の Date にする（JST = UTC+9）
const jst = (hh, mm) => new Date(Date.UTC(2026, 8, 19, hh - 9, mm, 30));
const decide = (over) =>
  decideDeployHook({
    hookUrl: HOOK,
    now: jst(12, 0),
    changedRaceCount: 3,
    ...over,
  });

// 1. 叩かない条件
check(
  "VERCEL_DEPLOY_HOOK 未設定なら叩かない",
  !decide({ hookUrl: undefined }).trigger,
);
check(
  "VERCEL_DEPLOY_HOOK が空文字でも叩かない",
  !decide({ hookUrl: "" }).trigger,
);
check(
  "更新0件なら窓の中でも叩かない",
  !decide({ changedRaceCount: 0 }).trigger,
);
check(
  "更新件数が不正（undefined/NaN）でも叩かない",
  !decide({ changedRaceCount: undefined }).trigger &&
    !decide({ changedRaceCount: NaN }).trigger,
);

// 境界（窓は 0 <= 分 < DEPLOY_HOOK_WINDOW_MINUTES）
check(
  `窓の幅は5分（実装値: ${DEPLOY_HOOK_WINDOW_MINUTES}）`,
  DEPLOY_HOOK_WINDOW_MINUTES === 5,
);
for (const [minute, expected] of [
  [0, true],
  [4, true],
  [5, false],
  [9, false],
  [10, false],
  [59, false],
]) {
  check(
    `${minute}分: ${expected ? "叩く" : "叩かない"}`,
    decide({ now: jst(12, minute) }).trigger === expected,
  );
}

// 2. 窓の中で更新があれば、どの時間帯でも叩く
check(
  "更新1件・窓の中なら叩く（07時・22時とも）",
  decide({ now: jst(7, 2), changedRaceCount: 1 }).trigger &&
    decide({ now: jst(22, 3), changedRaceCount: 1 }).trigger,
);

// 3. タイムゾーン非依存: 分の値がJSTと一致する（UTCで判定しているため）
check(
  "JST 12:04 は窓の中、JST 12:05 は窓の外（TZ環境変数によらず）",
  decide({ now: new Date("2026-09-19T12:04:59+09:00") }).trigger &&
    !decide({ now: new Date("2026-09-19T12:05:00+09:00") }).trigger,
);

// 理由が空でないこと（ログに出すため）
check(
  "叩かない場合は理由が付く",
  [
    decide({ hookUrl: undefined }),
    decide({ changedRaceCount: 0 }),
    decide({ now: jst(12, 30) }),
  ].every((d) => !d.trigger && d.reason.length > 0),
);

// 4. 起動回数の見積り。実行間隔（分）ごとに、1日（JST 07:00〜22:59）の
//    全実行が「更新あり」だったと仮定して数える。従来は実行のたびに叩いていた。
console.log("\n--- 起動回数の見積り（全実行が更新ありの最悪ケース）---");
for (const [interval, offset] of [
  [5, 0],
  [5, 3],
  [6, 0],
  [10, 0],
]) {
  let runs = 0;
  let hooks = 0;
  const hooksPerHour = new Map();
  for (let m = 7 * 60 + offset; m < 23 * 60; m += interval) {
    runs++;
    const hour = Math.floor(m / 60);
    if (decide({ now: jst(hour, m % 60) }).trigger) {
      hooks++;
      hooksPerHour.set(hour, (hooksPerHour.get(hour) ?? 0) + 1);
    }
  }
  const hours = 16;
  console.log(
    `  間隔${interval}分(開始+${offset}分): 実行${runs}回/日 → 起動${hooks}回/日（従来${runs}回）= ${(hooks / hours).toFixed(2)}回/時（従来${(runs / hours).toFixed(2)}回/時）`,
  );
  check(
    `間隔${interval}分(+${offset}): 1時間あたりの起動は高々1回`,
    Math.max(0, ...hooksPerHour.values()) <= 1,
    `1時間あたりの最大 ${Math.max(0, ...hooksPerHour.values())}回`,
  );
}

if (failures > 0) {
  console.error(`\n${failures}件失敗`);
  process.exit(1);
}
console.log("\n全て合格");
