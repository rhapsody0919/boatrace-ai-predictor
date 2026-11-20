/**
 * verify-analogy-facts.js の後半の場面（2/4）。verify ではない。
 * 判定と期待値は分ける前の verify-analogy-facts.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  agreementVerdict,
  rankPositions,
  todayPosition,
  factRows,
  seriesScoreNote,
  defaultScope,
  parseScopeKey,
} from "../../../src/utils/analogyFacts.js";
import {
  scopeName,
  fmtDate,
  fmtSt3,
  fmtExhSt,
  fmtRateCount,
  fmtEntry,
} from "../../../src/utils/analogyFormat.js";
import { describeAnalogyLayer } from "../../../src/utils/analogyLayer.js";

let check, example, ja;
let scopeFacts;

const HIB = { st_mean30: false };

// カードの並び: 差がはっきりしている（大きい・小さい）ものが先、その中は差の大きい順
const pairs = (b, w) => ({
  1: { win: b },
  2: { win: [0, 0] },
  3: { win: [0, 0] },
  4: { win: [0, 0] },
  5: { win: [0, 0] },
  6: { win: w },
});

// 既定の範囲（VC が300件未満なら NC）
const keys = { VC: "VC:20:2-1-3-0:1A1", NC: "NC:2-1-3-0:1A1", VA: "VA:20" };

const t = (key, opts = {}) => {
  const v = key.split(".").reduce((o, k) => o?.[k], ja);
  if (typeof v !== "string") return typeof opts === "string" ? opts : key;
  return v.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ""));
};

function scene1() {
  // 展示の形と本番の形（同じ Wilson のぶれ幅で言い分ける）
  check(
    "展示の形: 同じ形のほうがはっきり高い",
    agreementVerdict([300, 1000], [150, 1000]),
    "up",
  );
  check(
    "展示の形: 多摩川12R の例（12% と 15%、件数が少なくぶれ幅が重なる）",
    agreementVerdict([6, 50], [150, 1000]),
    "same",
  );
  check(
    "展示の形: 同じ形のほうがはっきり低い",
    agreementVerdict([100, 1000], [200, 1000]),
    "down",
  );
  check("展示の形: 件数0は出さない", agreementVerdict([0, 0], [1, 10]), null);
}

/** verify から呼ぶ入口。env は verify 側の束縛（check） */
export function runAnalogyFactsScenes3(env) {
  ({ check } = env);
  scene1();
}

function scene2() {
  for (const [k, v] of Object.entries(example.today.items))
    check(
      `例のレースの順位 ${k}`,
      rankPositions(v.values, HIB[k] ?? true),
      v.positions,
    );
  // 今日の位置: 同じ値の艇は一番良い・一番悪いの両方（3艇が同じ値の真ん中は min 順位）
  check(
    "今日の位置（同じ値の最良）",
    todayPosition([7, 7, 6, 5, 4, 3], true, 2),
    { bucket: 1, same: 2, value: 7, min: 3, max: 7 },
  );
  check(
    "今日の位置（中間の同じ値）",
    todayPosition([7, 5, 5, 5, 4, 3], true, 3).bucket,
    2,
  );
  check(
    "今日の位置（値なし）",
    todayPosition([null, 5, 5, 5, 4, 3], true, 1),
    null,
  );
  check(
    "今日の位置（遅いほど悪い）",
    todayPosition([0.15, 0.12, 0.13, 0.11, 0.18, 0.18], false, 6).bucket,
    6,
  );
  scopeFacts = {
    by: {
      1: {
        nat_win: pairs([60, 100], [40, 100]), // はっきり・差20
        loc_win: pairs([52, 100], [48, 100]), // はっきりしない
        motor_2: pairs([700, 1000], [600, 1000]), // はっきり・差10
        exh_time: pairs([90, 100], [10, 100]), // 展示前は出さない
      },
    },
  };
  check(
    "カードの並び（展示前）",
    factRows(scopeFacts, 1, 1, false).map((r) => r.key),
    ["nat_win", "motor_2", "loc_win"],
  );
  check(
    "カードの並び（展示後）",
    factRows(scopeFacts, 1, 1, true).map((r) => r.key),
    ["exh_time", "nat_win", "motor_2", "loc_win"],
  );
  // 今節の平均着順点の注記（R1: 最小3未満かつ最大1以上。優勝戦・準優勝戦の日は final だけ。
  // 初日（6艇とも0走）は first: カードと七角形の軸を出さず1行で断る。BOA-802 2026-10-10 ユーザー決定）
  check(
    "注記: 序盤",
    seriesScoreNote({
      round: "yosen",
      series_runs_before_today: [1, 2, 3, 3, 4, 2],
    }),
    "early",
  );
  check(
    "注記: 初日",
    seriesScoreNote({
      round: "yosen",
      series_runs_before_today: [0, 0, 0, 0, 0, 0],
    }),
    "first",
  );
  check(
    "注記: 走数が足りる",
    seriesScoreNote({
      round: "yosen",
      series_runs_before_today: [3, 3, 4, 5, 3, 3],
    }),
    null,
  );
  check(
    "注記: 優勝戦",
    seriesScoreNote({
      round: "yusho",
      series_runs_before_today: [1, 1, 1, 1, 1, 1],
    }),
    "final",
  );
  check("既定の範囲（VC）", defaultScope(keys, () => 300).key, keys.VC);
  check(
    "既定の範囲（NC）",
    defaultScope(keys, () => 299),
    { key: keys.NC, fellBack: true, vcCount: 299 },
  );
  check(
    "既定の範囲（VC の集計が無い）",
    defaultScope(keys, (k) => (k === keys.VC ? null : 500)).key,
    keys.NC,
  );
}

function scene3() {
  check(
    "既定の範囲（級別なし）",
    defaultScope({ VA: "VA:20" }, () => 0).key,
    "VA:20",
  );
  check("範囲キーの分解", parseScopeKey("NCR:6-0-0-0:3A1:yusho"), {
    kind: "NCR",
    venue: null,
    combo: [6, 0, 0, 0],
    boat: 3,
    cls: "A1",
    round: "yusho",
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・example） */
export function runAnalogyFactsScenes4(env) {
  ({ check, example } = env);
  scene2();
  scene3();
}

function scene4() {
  check(
    "範囲の名前 VC（6艇とも）",
    scopeName("VC:20:6-0-0-0:1A1", t),
    "若松・6艇ともA1",
  );
  check(
    "範囲の名前 VC（混ざる）",
    scopeName("VC:20:2-1-3-0:1A1", t),
    "若松・A1が2艇・A2が1艇・B1が3艇（1号艇はA1）",
  );
  check(
    "範囲の名前 NCR",
    scopeName("NCR:6-0-0-0:1A1:yusho", t),
    "全国・6艇ともA1の優勝戦",
  );
  check("範囲の名前 VA", scopeName("VA:20", t), "若松の全レース");
  check("範囲の名前 VG", scopeName("VG:20", t), "若松のG1");
  check("範囲の名前 NA", scopeName("NA", t), "全国の全レース");
  check(
    "層の説明文（G1以上の優勝戦・件数）",
    describeAnalogyLayer({ round: "yusho", grade_g1plus: true }, t, {
      count: 7286,
    }),
    "今日と同じ『G1以上の優勝戦』で、1号艇の級別・1号艇と勝率トップの差・勝率トップの艇番がそろう過去レース7,286件",
  );
  check(
    "層の説明文（そろえない日・件数なし）",
    describeAnalogyLayer({ round: null, grade_g1plus: false }, t),
    "今日と同じく、1号艇の級別・1号艇と勝率トップの差・勝率トップの艇番がそろう過去レース",
  );
  // 表記
  check("日付", fmtDate("2019-04-01〜2026-09-26"), "2019/4/1〜2026/9/26");
  check("平均ST", fmtSt3(0.1333), ".133");
  check("展示ST（F）", fmtExhSt(-0.09), "F.09");
  check("展示ST", fmtExhSt(0.07), ".07");
  check("割合と件数", fmtRateCount([16, 45]), "36%（16/45）");
  check("進入", fmtEntry([2, 3, 1, 4, 5, 6]), "312/456");
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・example・ja） */
export function runAnalogyFactsScenes5(env) {
  ({ check, example, ja } = env);
  scene4();
}
