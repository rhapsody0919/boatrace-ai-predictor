/**
 * verify-odds-live-api.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-odds-live-api.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

let printOut, check, show, TODAY_RACE;

async function scene1() {
  // DBアダプターも偽のクライアントで検証する（実接続なし）。
  {
    const { createLiveOddsReaders } = await import("../../../api/odds/live.js");
    let row; let error; const calls = [];
    const chain = {};
    for (const method of ["select", "eq", "order", "limit"]) {
      chain[method] = (...args) => { calls.push([method, ...args]); return chain; };
    }
    chain.maybeSingle = async () => ({ data: row, error });
    const readers = createLiveOddsReaders({ from: (table) => {
      calls.push(["from", table]); return chain;
    } });
    row = { race_date: "2026-09-29", start_time: "09:10:00" };
    check("racesのJST締切を読む", (await readers.getDeadline(TODAY_RACE)).toISOString() ===
      "2026-09-29T00:10:00.000Z");
    row = null;
    check("races行なしは締切不明", await readers.getDeadline(TODAY_RACE) === null);
    const maps = {
      "3t": ["trifecta_all", "trifectaAll"], "3f": ["trio_all", "trioAll"],
      "2tf": ["exacta_all", "exactaAll"], k: ["wide_all", "wideAll"],
    };
    for (const [page, [column, key]] of Object.entries(maps)) {
      const value = { "1-2": page === "k" ? { low: 1.2, high: 2.3 } : 12.3 };
      row = { captured_at: "2026-09-29T00:00:00+00:00", [column]: value };
      const got = await readers.getLatestSnapshot(TODAY_RACE, page);
      check(`${page}: 保存列の写像・取得時刻`, got.fetchedAt === row.captured_at &&
        show(got.data[key]) === show(value) && got.officialUpdatedAt === null && !got.final);
    }
    row = { captured_at: "saved", quinella_all: { "1-2": 4.5 } };
    check("2tf: 2連複も保持", (await readers.getLatestSnapshot(TODAY_RACE, "2tf"))
      .data.quinellaAll["1-2"] === 4.5);
    row = { captured_at: "saved", odds_win_1: 0, odds_place_2_low: 1.2, odds_place_2_high: 2.3 };
    check("tf: 単勝0・複勝レンジ・欠損を区別", show((await readers.getLatestSnapshot(TODAY_RACE, "tf")).data) ===
      show({ win: { 1: 0 }, place: { 2: { low: 1.2, high: 2.3 } } }));
    for (const missing of [null, {}, { trifecta_all: {} }, { trio_all: { "1-2-3": 2 } }]) {
      row = missing;
      check("最新行なし・要求券種なしはnull", await readers.getLatestSnapshot(TODAY_RACE, "3t") === null);
    }
    error = new Error("read failure");
    for (const read of [() => readers.getDeadline(TODAY_RACE),
      () => readers.getLatestSnapshot(TODAY_RACE, "3t")]) {
      let caught; try { await read(); } catch (e) { caught = e; }
      check("アダプターのDBエラーを保持", caught === error);
    }
    check("最新の窓を取得時刻降順の1行で読む", calls.some((c) => show(c) ===
      show(["order", "captured_at", { ascending: false }])) &&
      calls.some((c) => show(c) === show(["limit", 1])));
  }
  printOut("");
}

/** verify から呼ぶ入口。env は verify 側の束縛（printOut・check・show・TODAY_RACE） */
export async function runOddsLiveApiScenes3(env) {
  ({ printOut, check, show, TODAY_RACE } = env);
  await scene1();
}

function scene2() {
  printOut("✅ すべての検証に成功しました");
}

/** verify から呼ぶ入口。env は verify 側の束縛（printOut・check・show・TODAY_RACE） */
export function runOddsLiveApiScenes4(env) {
  ({ printOut, check, show, TODAY_RACE } = env);
  scene2();
}
