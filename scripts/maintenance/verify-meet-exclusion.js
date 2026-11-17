/**
 * verify-meet-exclusion.js — 今節の「順位の対象から外す選手と理由」の判定の回帰テスト。
 *
 * 対象は `src/pure/meetExclusion.js` の `meetExclusionsOf`。`getMeetScoreboard`
 * （`src/services/supabaseDataService.js`）の中の即時関数を手を加えずに移したもの
 * （開発効率の計画 段3 の1件目。#1837 で `src/services/meetExclusion.js` に仮置きし、
 * pure の根へ移した。旧の置き場は再 export で、DAL はそこから読む）。この判定には fix が4件あった（#1000・#1128・
 * #1149・#1477）ので、それぞれの再現の入力を例に入れる。
 *
 * 期待値は2つに分ける（plan.md 3+2）:
 * - A. 旧の実装から取った値: 移す前の動きの固定。誤りも含めて写す
 * - B. 仕様の値: 公式の規程（フライングは賞典除外、得点率・順位は予選終了で確定、
 *   途中帰郷・賞典除外は順位を付けない）から決まる「外すか外さないか」
 * 切り出し後の BOA-1072 で、選手責任の出遅れ（L1）を判定する試験を追加。
 * 取得列と画面の対応は BOA-598 の子2で行う。
 *
 * 実 Supabase へは接続しない（tier=ci）。
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { meetExclusionsOf } from "../../src/pure/meetExclusion.js";
import * as seriesPoints from "../../src/pure/seriesPoints.js";
import * as meetExclusionShim from "../../src/services/meetExclusion.js";

// src/ の .js は vite の書き方（拡張子の無い import・import.meta.env）なので、renderJsx の module hooks で読む。
// その上に、src/services/supabaseClient.js を偽のクライアントを返すだけの物へ差し替える hook を重ねる
const FAKE_KEY = "__verifyMeetExclusionSupabase";
const SWAP_CLIENT = `
export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  if (resolved.url.endsWith("/src/services/supabaseClient.js")) {
    return {
      url: "data:text/javascript," + encodeURIComponent("export const supabase = globalThis.${FAKE_KEY};"),
      shortCircuit: true,
    };
  }
  return resolved;
}
`;

// 節: 10/1〜10/2 が予選、10/3 が準優（1R）・優勝戦（2R）
const conditions = [
  { race_id: "2026-10-01-04-01", race_stage: "予選" },
  { race_id: "2026-10-01-04-02", race_stage: "予選" },
  { race_id: "2026-10-02-04-01", race_stage: "予選" },
  { race_id: "2026-10-02-04-02", race_stage: "予選" },
  { race_id: "2026-10-03-04-01", race_stage: "準優勝戦" },
  { race_id: "2026-10-03-04-02", race_stage: "優勝戦" },
];
const entry = (race_id, boat_number, racer_id) => ({
  race_id,
  boat_number,
  racer_id,
});
const st = (race_id, boat_number, extra = {}) => ({
  race_id,
  boat_number,
  is_flying: false,
  finish_mark: null,
  ...extra,
});
const base = {
  usesOfficialSeries: false,
  officialSeries: null,
  conditions,
  meetStarts: [],
  meetRows: [],
  prelimOfficial: null,
  date: "2026-10-02",
};
const run = (over) => meetExclusionsOf({ ...base, ...over });
const excluded = (out) => new Set(out.withdrawnRacerIds);

let count = 0;
const check = (name, fn) => {
  fn();
  count += 1;
  console.log(`  ok ${name}`);
};

console.log("A. 旧の実装から取った値");

// #1000（BOA-587）: 予選の後で公式の備考がある節は備考が正
check("A1 #1000 予選の後・公式の備考: 賞典除外と途中帰郷を分ける", () => {
  const out = run({
    usesOfficialSeries: true,
    officialSeries: [
      { racer_id: 5001, remarks: "途中帰郷" },
      { racer_id: 5002, remarks: "賞典除外" },
      { racer_id: 5003, remarks: null },
      { racer_id: 5004, remarks: "" },
      { racer_id: 5005, remarks: "途中帰郷 賞典除外" },
    ],
    date: "2026-10-03",
  });
  assert.deepEqual(out, {
    withdrawnRacerIds: [5001, 5002, 5005],
    exclusionReasonByRacer: {
      5001: "officialWithdrawn",
      5002: "awardExcluded",
      5005: "awardExcluded",
    },
  });
});

check("A2 公式の備考があれば推定（F・不在）を見ない", () => {
  const out = run({
    usesOfficialSeries: true,
    officialSeries: [{ racer_id: 5002, remarks: "賞典除外" }],
    meetRows: [
      entry("2026-10-01-04-01", 1, 5010),
      entry("2026-10-02-04-01", 1, 5011),
    ],
    meetStarts: [st("2026-10-01-04-01", 1, { is_flying: true })],
  });
  assert.deepEqual(out.withdrawnRacerIds, [5002]);
});

// #1149（ファン評価2周目）: 予選中に公式の備考を使うと、まだ走っている選手を外した
// （児島G1 10/1 9R の丸野一樹）
check("A3 #1149 予選中は公式の備考を使わない", () => {
  const out = run({
    usesOfficialSeries: false,
    officialSeries: [{ racer_id: 5020, remarks: "途中帰郷" }],
    meetRows: [
      entry("2026-10-01-04-01", 1, 5020),
      entry("2026-10-02-04-01", 1, 5020),
    ],
  });
  assert.deepEqual(out, { withdrawnRacerIds: [], exclusionReasonByRacer: {} });
});

check("A4 公式を使う日でも備考の行が無ければ推定に落ちる", () => {
  const out = run({
    usesOfficialSeries: true,
    officialSeries: [{ racer_id: 5030, remarks: null }],
    meetRows: [
      entry("2026-10-01-04-01", 1, 5030),
      entry("2026-10-02-04-01", 2, 5031),
    ],
  });
  assert.deepEqual(out, {
    withdrawnRacerIds: [5030],
    exclusionReasonByRacer: { 5030: "withdrawn" },
  });
});

// #1000: 備考が無い節は今節Fで賞典除外を推定する。L は外さない
check(
  "A5 #1000 今節F（is_flying・F・全角Ｆ）は flying、L・欠は外さない",
  () => {
    const rows = [1, 2, 3, 4, 5].map((b) =>
      entry("2026-10-01-04-01", b, 5040 + b),
    );
    const out = run({
      meetRows: [
        ...rows,
        ...rows.map((r) => ({ ...r, race_id: "2026-10-02-04-01" })),
      ],
      meetStarts: [
        st("2026-10-01-04-01", 1, { is_flying: true }),
        st("2026-10-01-04-01", 2, { finish_mark: "F" }),
        st("2026-10-01-04-01", 3, { finish_mark: "Ｆ" }),
        st("2026-10-01-04-01", 4, { finish_mark: "L" }),
        st("2026-10-01-04-01", 5, { finish_mark: "欠" }),
      ],
    });
    assert.deepEqual(out, {
      withdrawnRacerIds: [5041, 5042, 5043],
      exclusionReasonByRacer: {
        5041: "flying",
        5042: "flying",
        5043: "flying",
      },
    });
  },
);

// #1000（ファン評価1周目）: 予選の後は予選終了までのFだけで判定する
// （桐生 9/24 で 1〜8R は47人、9〜12R は45人と、最終日のレースごとに順位が動いた）
check("A6 #1000 予選の後の準優のFでは外さない", () => {
  const meetRows = [
    entry("2026-10-02-04-02", 1, 5050),
    entry("2026-10-02-04-02", 2, 5051),
    entry("2026-10-03-04-01", 1, 5050),
    entry("2026-10-03-04-01", 2, 5051),
    entry("2026-10-03-04-02", 1, 5050),
    entry("2026-10-03-04-02", 2, 5051),
  ];
  const out = run({
    date: "2026-10-03",
    meetRows,
    meetStarts: [
      st("2026-10-02-04-02", 1, { is_flying: true }),
      st("2026-10-03-04-01", 2, { is_flying: true }),
    ],
  });
  assert.deepEqual(out, {
    withdrawnRacerIds: [5050],
    exclusionReasonByRacer: { 5050: "flying" },
  });
});

check("A7 予選の締めが分からない節は全部のFで判定する", () => {
  const out = run({
    conditions: [{ race_id: "2026-10-03-04-01", race_stage: "一般" }],
    date: "2026-10-03",
    meetRows: [
      entry("2026-10-03-04-01", 1, 5060),
      entry("2026-10-03-04-02", 1, 5060),
    ],
    meetStarts: [st("2026-10-03-04-01", 1, { is_flying: true })],
  });
  assert.deepEqual(out.exclusionReasonByRacer, { 5060: "flying" });
});

// #1128（BOA-674）→ #1149: 予選中に帰った選手を、表示日に1走も無ければその日から外す
// （桐生 2026-09-20〜25: 北川・田中が 9/22 で帰郷。以前は最終日まで残った）
check(
  "A8 #1128・#1149 予選中でも前の日に走って表示日に番組が無い選手は withdrawn",
  () => {
    const out = run({
      date: "2026-10-02",
      meetRows: [
        entry("2026-10-01-04-01", 1, 5070),
        entry("2026-10-01-04-01", 2, 5071),
        entry("2026-10-02-04-01", 2, 5071),
      ],
    });
    assert.deepEqual(out, {
      withdrawnRacerIds: [5070],
      exclusionReasonByRacer: { 5070: "withdrawn" },
    });
  },
);

check(
  "A9 #1149 表示日の番組が会場に1件も無い日は誰も外さない（取得遅れ）",
  () => {
    const out = run({
      date: "2026-10-02",
      meetRows: [
        entry("2026-10-01-04-01", 1, 5080),
        entry("2026-10-01-04-01", 2, 5081),
      ],
    });
    assert.deepEqual(out, {
      withdrawnRacerIds: [],
      exclusionReasonByRacer: {},
    });
  },
);

// #1477（BOA-782）: 予選中は前夜の公式の表の途中帰郷を先に入れる
// （三国G1 10/6 の安河内将: 表示日に番組が残っていて、推定では拾えなかった）
check(
  "A10 #1477 予選中の前夜の途中帰郷は officialWithdrawn、推定より先",
  () => {
    const out = run({
      date: "2026-10-02",
      meetRows: [
        entry("2026-10-01-04-01", 1, 5090),
        entry("2026-10-02-04-01", 1, 5090),
        entry("2026-10-01-04-01", 2, 5091),
        entry("2026-10-02-04-01", 3, 5092),
      ],
      prelimOfficial: { withdrawnRacerIds: [5090, 5091] },
    });
    assert.deepEqual(out, {
      withdrawnRacerIds: [5090, 5091],
      exclusionReasonByRacer: {
        5090: "officialWithdrawn",
        5091: "officialWithdrawn",
      },
    });
  },
);

check("A11 #1477 今節Fの理由は前夜の途中帰郷で上書きしない", () => {
  const out = run({
    meetRows: [
      entry("2026-10-01-04-01", 1, 5100),
      entry("2026-10-02-04-01", 1, 5100),
    ],
    meetStarts: [st("2026-10-01-04-01", 1, { is_flying: true })],
    prelimOfficial: { withdrawnRacerIds: [5100] },
  });
  assert.deepEqual(out.exclusionReasonByRacer, { 5100: "flying" });
});

check(
  "A12 推定の経路の ID は数値（呼び出し側は Set で引くので順は固定しない）",
  () => {
    const out = run({
      meetRows: [
        entry("2026-10-01-04-01", 1, 5203),
        entry("2026-10-01-04-01", 2, 5201),
        entry("2026-10-02-04-01", 3, 5202),
      ],
      meetStarts: [st("2026-10-01-04-01", 1, { is_flying: true })],
    });
    assert.deepEqual(
      [...out.withdrawnRacerIds].sort((a, b) => a - b),
      [5201, 5203],
    );
    assert.ok(out.withdrawnRacerIds.every((id) => typeof id === "number"));
  },
);

check("A13 入力が null でも落ちず空", () => {
  const out = meetExclusionsOf({
    usesOfficialSeries: true,
    officialSeries: null,
    conditions: null,
    meetStarts: null,
    meetRows: [],
    prelimOfficial: null,
    date: "2026-10-02",
  });
  assert.deepEqual(out, { withdrawnRacerIds: [], exclusionReasonByRacer: {} });
});

check(
  "A14 L は外さない（旧の動き。公式の L1 は賞典除外、BOA-598 で直す）",
  () => {
    const out = run({
      meetRows: [
        entry("2026-10-01-04-01", 1, 5300),
        entry("2026-10-02-04-01", 1, 5300),
      ],
      meetStarts: [st("2026-10-01-04-01", 1, { finish_mark: "L" })],
    });
    assert.deepEqual(out.withdrawnRacerIds, []);
  },
);

check(
  "A15 今節Fの後に帰った選手の理由は flying のまま（不在・前夜の途中帰郷で上書きしない）",
  () => {
    const out = run({
      date: "2026-10-02",
      meetRows: [
        entry("2026-10-01-04-01", 1, 5310),
        entry("2026-10-02-04-01", 2, 5311),
      ],
      meetStarts: [st("2026-10-01-04-01", 1, { is_flying: true })],
      prelimOfficial: { withdrawnRacerIds: [5310] },
    });
    assert.deepEqual(out, {
      withdrawnRacerIds: [5310],
      exclusionReasonByRacer: { 5310: "flying" },
    });
  },
);

console.log("B. 仕様の値（外すか外さないか）");

check("B1 予選中に切った今節Fは賞典除外で順位から外す", () => {
  const out = run({
    meetRows: [
      entry("2026-10-01-04-02", 4, 5400),
      entry("2026-10-02-04-01", 4, 5400),
    ],
    meetStarts: [st("2026-10-01-04-02", 4, { is_flying: true })],
  });
  assert.ok(excluded(out).has(5400));
});

check(
  "B2 得点率・順位は予選終了で確定する。予選の後のFでは順位を動かさない",
  () => {
    const out = run({
      date: "2026-10-03",
      meetRows: [
        entry("2026-10-02-04-02", 1, 5410),
        entry("2026-10-03-04-01", 1, 5410),
        entry("2026-10-03-04-02", 1, 5410),
      ],
      meetStarts: [st("2026-10-03-04-01", 1, { is_flying: true })],
    });
    assert.ok(!excluded(out).has(5410));
  },
);

check("B3 途中帰郷した選手は順位を付けない", () => {
  const out = run({
    date: "2026-10-02",
    meetRows: [
      entry("2026-10-01-04-01", 1, 5420),
      entry("2026-10-02-04-01", 2, 5421),
    ],
  });
  assert.ok(excluded(out).has(5420));
  assert.ok(!excluded(out).has(5421));
});

check("B4 公式が賞典除外・途中帰郷とした選手は順位を付けない", () => {
  const out = run({
    usesOfficialSeries: true,
    date: "2026-10-03",
    officialSeries: [
      { racer_id: 5430, remarks: "賞典除外" },
      { racer_id: 5431, remarks: "途中帰郷" },
      { racer_id: 5432, remarks: null },
    ],
  });
  assert.deepEqual(
    [...excluded(out)].sort((a, b) => a - b),
    [5430, 5431],
  );
});

check(
  "B5 フライングは即日帰郷ではない（Fの選手を途中帰郷の理由にしない）",
  () => {
    const out = run({
      meetRows: [
        entry("2026-10-01-04-01", 1, 5440),
        entry("2026-10-02-04-01", 1, 5440),
      ],
      meetStarts: [st("2026-10-01-04-01", 1, { is_flying: true })],
    });
    assert.equal(out.exclusionReasonByRacer[5440], "flying");
  },
);

// BOA-1072: L1 のみ賞典除外。旧の試験の入力・期待値は維持する。
check("B6 L1 は lateStart、L0・責任不明のL・他の成績コードは外さない", () => {
  const codes = ["L1", "L0", null, undefined, "01", "K1"];
  const meetRows = codes.map((_, i) =>
    entry("2026-10-02-04-01", i + 1, 5500 + i),
  );
  const out = run({
    meetRows,
    meetStarts: codes.map((code, i) =>
      st("2026-10-02-04-01", i + 1, {
        finish_mark: "L",
        official_finish_code: code,
      }),
    ),
  });
  assert.deepEqual(out, {
    withdrawnRacerIds: [5500],
    exclusionReasonByRacer: { 5500: "lateStart" },
  });
});

check("B7 L1 は予選終了のレースまで、予選後のL1では外さない", () => {
  const out = run({
    date: "2026-10-03",
    meetRows: [
      entry("2026-10-02-04-02", 1, 5510),
      entry("2026-10-03-04-01", 2, 5511),
      entry("2026-10-03-04-02", 1, 5510),
    ],
    meetStarts: [
      st("2026-10-02-04-02", 1, { official_finish_code: "L1" }),
      st("2026-10-03-04-01", 2, { official_finish_code: "L1" }),
    ],
  });
  assert.deepEqual(out.exclusionReasonByRacer, { 5510: "lateStart" });
});

check("B8 公式の備考があればL1の推定も使わない", () => {
  const out = run({
    usesOfficialSeries: true,
    officialSeries: [{ racer_id: 5520, remarks: "途中帰郷" }],
    meetRows: [entry("2026-10-02-04-01", 1, 5521)],
    meetStarts: [st("2026-10-02-04-01", 1, { official_finish_code: "L1" })],
  });
  assert.deepEqual(out, {
    withdrawnRacerIds: [5520],
    exclusionReasonByRacer: { 5520: "officialWithdrawn" },
  });
});

check("B9 FとL1の両方なら、発生順にかかわらずflyingを優先", () => {
  for (const codes of [
    ["F", "L1"],
    ["L1", "F"],
  ]) {
    const out = run({
      meetRows: [
        entry("2026-10-02-04-01", 1, 5530),
        entry("2026-10-02-04-02", 2, 5530),
      ],
      meetStarts: codes.map((code, i) =>
        st(`2026-10-02-04-0${i + 1}`, i + 1, {
          finish_mark: code === "F" ? "F" : "L",
          official_finish_code: code,
        }),
      ),
    });
    assert.deepEqual(out.exclusionReasonByRacer, { 5530: "flying" });
  }
});

check("B10 L1の理由は不在・前夜の途中帰郷で上書きしない", () => {
  const out = run({
    meetRows: [
      entry("2026-10-01-04-01", 1, 5540),
      entry("2026-10-02-04-01", 2, 5541),
    ],
    meetStarts: [st("2026-10-01-04-01", 1, { official_finish_code: "L1" })],
    prelimOfficial: { withdrawnRacerIds: [5540] },
  });
  assert.deepEqual(out.exclusionReasonByRacer, { 5540: "lateStart" });
});

check("B11 予選の締めが不明でも、入力されたL1は対象", () => {
  const out = run({
    conditions: [],
    meetRows: [entry("2026-10-02-04-01", 1, 5550)],
    meetStarts: [st("2026-10-02-04-01", 1, { official_finish_code: "L1" })],
  });
  assert.deepEqual(out.exclusionReasonByRacer, { 5550: "lateStart" });
});

check("B12 L1の純関数はレースと艇番で結合し、重複・不明な選手を除く", () => {
  const race = "2026-10-02-04-01";
  const starts = [1, 1, 2, 3, 4].map((boat) =>
    st(race, boat, { official_finish_code: "L1" }),
  );
  const entries = [
    entry(race, 1, 5560),
    entry("2026-10-01-04-01", 2, 5561),
    entry(race, 3, null),
    entry(race, 4, undefined),
  ];
  const before = JSON.stringify({ starts, entries });
  assert.deepEqual(
    seriesPoints.lateStartL1RacerIdsInMeet(starts, entries),
    [5560],
  );
  assert.equal(JSON.stringify({ starts, entries }), before);
  assert.deepEqual(seriesPoints.lateStartL1RacerIdsInMeet(null, null), []);
  assert.deepEqual(seriesPoints.lateStartL1RacerIdsInMeet([], []), []);
});

// getMeetScoreboard（サービス層）を偽の supabase の上で呼び、返り値の除外が meetExclusionsOf の判定どおりであること。
// 即時関数の判定が DAL に戻っていても、使う入力（予選の締め・出走表・本番ST・公式の備考）を取り違えても、ここで落ちる
register(new URL("../lib/renderJsx.js", import.meta.url));
register(`data:text/javascript,${encodeURIComponent(SWAP_CLIENT)}`);
let currentFake = null;
globalThis[FAKE_KEY] = { from: (table) => currentFake.from(table) };
globalThis.localStorage ??= {
  getItem: () => null,
  setItem() {},
  removeItem() {},
  key: () => null,
  length: 0,
};
const { getMeetScoreboard } =
  await import("../../src/services/meetQueries2.js");
const { clearCache } = await import("../../src/services/core.js");

/**
 * 偽の supabase クライアント（メモリ上の表）。select・eq・gte・lt・lte・like・in・order・range と await を扱う
 */
function makeFakeSupabase(tables) {
  const calls = [];
  return {
    calls,
    from(table) {
      const q = { table, filters: [], range: null };
      calls.push(q);
      const run = () => {
        const rows = (tables[table] ?? []).filter((row) =>
          q.filters.every(([op, col, val]) => {
            const v = row[col];
            if (op === "eq") return v === val;
            if (op === "gte") return v >= val;
            if (op === "lt") return v < val;
            if (op === "lte") return v <= val;
            if (op === "in") return val.includes(v);
            if (op === "like")
              return new RegExp(`^${val.replace(/_/g, ".")}$`).test(v);
            throw new Error(`偽のクライアントに無い絞り: ${op}`);
          }),
        );
        const [a, b] = q.range ?? [0, rows.length - 1];
        return Promise.resolve({
          data: rows.slice(a, b + 1).map((r) => ({ ...r })),
          error: null,
        });
      };
      const filter = (op) => (col, val) => {
        q.filters.push([op, col, val]);
        return chain;
      };
      const chain = {
        select: () => chain,
        eq: filter("eq"),
        gte: filter("gte"),
        lt: filter("lt"),
        lte: filter("lte"),
        like: filter("like"),
        in: filter("in"),
        order: () => chain,
        range(a, b) {
          q.range = [a, b];
          return run();
        },
        then: (res, rej) => run().then(res, rej),
      };
      return chain;
    },
  };
}

// 節（会場 04）: 10/1・10/2 が予選、10/3 が準優（1R）・優勝戦（2R）。表示中のレースは 10/3 の1R
const SB_DISPLAY = "2026-10-03-04-01";
const sbConditions = conditions.map((c, i) => ({
  ...c,
  series_day: Math.floor(i / 2) + 1,
  is_final_day: false,
}));
const SB_RACERS = [5601, 5602, 5603, 5604, 5605, 5606];
const sbEntries = conditions.flatMap((c) =>
  SB_RACERS.map((racer_id, i) => ({
    race_id: c.race_id,
    boat_number: i + 1,
    racer_id,
    player_name: `選手${racer_id}`,
    motor_number: 10 + i,
  })),
);
const scoreboardOf = async ({
  meetStarts = [],
  officialSeries = [],
  useOfficial,
  display = SB_DISPLAY,
}) => {
  clearCache();
  currentFake = makeFakeSupabase({
    race_entries: sbEntries,
    race_conditions: sbConditions,
    race_start_timings: meetStarts,
    racer_series_points: officialSeries.map((r) => ({
      venue_code: 4,
      meet_start_date: "2026-10-01",
      ...r,
    })),
  });
  return getMeetScoreboard(display, 4, { useOfficial });
};

const scoreboardCheck = async (name, fn) => {
  await fn();
  count += 1;
  console.log(`  ok ${name}`);
};

await scoreboardCheck(
  "C1a getMeetScoreboard: 予選中の今節F（表示中のレースより前）は賞典除外（flying）で順位の対象から外す",
  async () => {
    const board = await scoreboardOf({
      meetStarts: [st("2026-10-01-04-01", 3, { is_flying: true })],
    });
    assert.deepEqual(board.withdrawnRacerIds, [5603]);
    assert.deepEqual(board.exclusionReasonByRacer, { 5603: "flying" });
  },
);

await scoreboardCheck(
  "C1b getMeetScoreboard: 予選終了より後のFは見ない（予選の締めを種別から取る）",
  async () => {
    // 優勝戦（2R）を表示。準優（1R）のFは予選終了より後なので外さない
    const board = await scoreboardOf({
      display: "2026-10-03-04-02",
      meetStarts: [st("2026-10-03-04-01", 3, { is_flying: true })],
    });
    assert.deepEqual(board.exclusionReasonByRacer, {});
    assert.deepEqual(board.withdrawnRacerIds, []);
  },
);

await scoreboardCheck(
  "C1c getMeetScoreboard: 公式の備考は予選の後（表示中が準優）に使い、賞典除外・途中帰郷を分ける",
  async () => {
    const board = await scoreboardOf({
      // 備考があれば推定のFは見ない
      meetStarts: [st("2026-10-01-04-01", 3, { is_flying: true })],
      officialSeries: [
        {
          racer_id: 5601,
          remarks: "賞典除外",
          placements: "",
          total_points: 0,
          penalty_points: 0,
          scraped_at: "2026-10-02T12:00:00Z",
        },
        {
          racer_id: 5602,
          remarks: "途中帰郷",
          placements: "",
          total_points: 0,
          penalty_points: 0,
          scraped_at: "2026-10-02T12:00:00Z",
        },
        {
          racer_id: 5604,
          remarks: null,
          placements: "",
          total_points: 0,
          penalty_points: 0,
          scraped_at: "2026-10-02T12:00:00Z",
        },
      ],
    });
    assert.deepEqual(board.withdrawnRacerIds, [5601, 5602]);
    assert.deepEqual(board.exclusionReasonByRacer, {
      5601: "awardExcluded",
      5602: "officialWithdrawn",
    });
  },
);

// DAL が読む旧の置き場（再 export）が、pure の根の同じ関数を指していること
check(
  "C2 src/services/meetExclusion.js は src/pure の meetExclusionsOf を再 export する",
  () => {
    assert.equal(meetExclusionShim.meetExclusionsOf, meetExclusionsOf);
  },
);

console.log(`✅ meetExclusion: ${count} 件の例を確認`);
