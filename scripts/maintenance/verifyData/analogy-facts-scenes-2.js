/**
 * verify-analogy-facts.js の後半の場面（2/4）。verify ではない。
 * 判定と期待値は分ける前の verify-analogy-facts.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { hintRows, hintBadgeByForm, minRanks } from "../../../src/utils/analogyScenario.js";
import { defaultScope, parseScopeKey } from "../../../src/utils/analogyFacts.js";
import { wilsonInterval } from "../../../src/utils/wilson.js";
import {
  scopeName,
  fmtDate,
  fmtSt3,
  fmtExhSt,
  fmtRateCount,
  fmtEntry,
} from "../../../src/utils/analogyFormat.js";
import { describeAnalogyLayer } from "../../../src/utils/analogyLayer.js";
import {
  sliderSteps,
  defaultStepIndex,
  normalizeNeighbor,
  aggregateNeighbors,
  trifectaList,
  itemRates,
  neighborCounts,
} from "../../../src/utils/analogyAggregate.js";
import { keys } from "./analogy-facts-scenes-1.js";

let check, ja;
let nb, ag, rates, rows;

const t = (key, opts = {}) => {
  const v = key.split(".").reduce((o, k) => o?.[k], ja);
  if (typeof v !== "string") return typeof opts === "string" ? opts : key;
  return v.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ""));
};

// 展開シナリオの画面の判定
const sh = {
  course: {
    kado4: { kado: { hit: [45, 220], miss: [66, 678] } },
    in_slow02: { d1: { hit: [31, 175], miss: [62, 723] } },
    flat03: { flat: { hit: [3, 20], miss: [100, 900] } },
  },
};

function scene1() {
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

/** verify から呼ぶ入口。env は verify 側の束縛（check） */
export function runAnalogyFactsScenes2(env) {
  ({ check } = env);
  scene1();
}

function scene2() {
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
  // スライダーの段（spec B-4）
  check("段（15件の層）", sliderSteps(15), [10, 15]);
  check("段（800件以上）", sliderSteps(800).length, 12);
  check(
    "既定の段（800件）",
    sliderSteps(800)[defaultStepIndex(sliderSteps(800))],
    400,
  );
  check(
    "既定の段（15件）",
    sliderSteps(15)[defaultStepIndex(sliderSteps(15))],
    15,
  );
  // 類似レースの集計
  nb = [
    {
      race_id: "2021-10-14-16-12",
      finish: [1, 3, 6],
      technique: "逃げ",
      items: { venue: 1, nat_win_6: 2, is_final_day: -1 },
    },
    {
      race_id: "2019-08-06-11-12",
      finish: [3, 1, 4],
      technique: "まくり",
      items: { venue: 0, nat_win_6: 2 },
    },
    {
      race_id: "2020-01-01-01-01",
      finish: [3, 1, 0],
      technique: null,
      items: {},
    },
  ].map(normalizeNeighbor);
  check(
    "日付・会場・R（race_id から）",
    [nb[0].date, nb[0].venue_code, nb[0].race_number],
    ["2021-10-14", 16, 12],
  );
  ag = aggregateNeighbors(nb);
  check("集計: 件数（着順の欠けを除く）", ag.n, 2);
  check("集計: 1着", ag.win, [1, 0, 1, 0, 0, 0]);
  check("集計: 3着以内", ag.hit[3], [2, 0, 2, 1, 0, 1]);
  check("集計: 決まり手", ag.tech, { 逃げ: 1, まくり: 1 });
  check("3連単", trifectaList(ag.tri, { not1: true }), [[[3, 1, 4], 1]]);
  rates = itemRates(nb, [
    { key: "venue" },
    { key: "nat_win_6" },
    { key: "is_final_day" },
  ]);
  check(
    "同じ割合（会場）",
    [rates.venue.same, rates.venue.near, rates.venue.n],
    [0, 1, 2],
  );
  check("同じ割合（欠損は数えない）", rates.is_final_day.n, 0);
}

function scene3() {
  check("1件の同じ・近い・違う", neighborCounts(nb[0], false), {
    same: 1,
    near: 1,
    diff: 0,
    total: 2,
  });
  rows = hintRows(
    sh,
    { kado4: true, in_slow02: true, flat03: true },
    "course",
    wilsonInterval,
  );
  check(
    "手がかりの札",
    rows.map((r) => [r.id, r.kind]),
    [
      ["kado4", "up"],
      ["in_slow02", "up"],
      ["flat03", "unclear"],
    ],
  );
  check(
    "全体の割合（当てはまる＋当てはまらない）",
    rows.map((r) => Number(r.pall.toFixed(4))),
    [
      Number((111 / 898).toFixed(4)),
      Number((93 / 898).toFixed(4)),
      Number((103 / 920).toFixed(4)),
    ],
  );
  check("札は形ごとに1つ", Object.keys(hintBadgeByForm(rows)), ["kado", "d1"]);
  check("min 順位", minRanks([34.2, 37.2, 39, null, 37.2, 30], true), [
    4,
    2,
    1,
    null,
    2,
    5,
  ]);
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・ja） */
export function runAnalogyFactsScenes3(env) {
  ({ check, ja } = env);
  scene2();
  scene3();
}
