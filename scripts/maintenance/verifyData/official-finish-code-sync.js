/**
 * verify-official-finish-code.js の日次の同期の検査（evaluateSync）。大きさの関所のため、本文を字のまま移した。verify ではない。
 */
import {
  DATE,
  K_TEXT,
  S1_RACE,
  fakeClient,
  show,
} from "./official-finish-code-fixtures.js";

export async function evaluateSync(sync) {
  const failed = [];
  const expect = (label, pass, detail) => {
    if (!pass) failed.push(`${label}${detail ? ` ${detail}` : ""}`);
  };
  const quietLog = console.log;
  console.log = () => {};
  try {
    // S1 のレースは 1・2号艇の行だけある（3〜6号艇は行が無い）。2号艇は NULL、1号艇は既に正しい値
    const client = fakeClient([
      { race_id: S1_RACE, boat_number: 1, official_finish_code: "01" },
      { race_id: S1_RACE, boat_number: 2, official_finish_code: null },
      { race_id: `${DATE}-18-11`, boat_number: 1, official_finish_code: "99" }, // 古い値（K と違う）は直す
    ]);
    let loads = 0;
    const r = await sync(DATE, {
      client,
      loadText: async () => (loads++, K_TEXT),
      now: () => new Date("2026-10-02T00:00:00Z"),
    });
    const written = client.upserts.flatMap((u) => u.batch);
    expect(
      "(b) 値が変わる既存の行だけ（S1 の2号艇と、値の違う 18-11 の1号艇）。行の無い艇・同じ値の行は書かない",
      r.status === "synced" &&
        show(
          written
            .map(
              (w) => `${w.race_id}#${w.boat_number}=${w.official_finish_code}`,
            )
            .sort(),
        ) ===
          show(
            [
              `${DATE}-18-11#1=${written.find((w) => w.race_id === `${DATE}-18-11`)?.official_finish_code}`,
              `${S1_RACE}#2=S1`,
            ].sort(),
          ) &&
        written.length === 2 &&
        written.find((w) => w.race_id === `${DATE}-18-11`)
          ?.official_finish_code !== "99",
      show(written),
    );
    expect(
      "(b) 書く列は race_id・boat_number・official_finish_code・updated_at だけ",
      written.every(
        (w) =>
          Object.keys(w).sort().join() ===
          "boat_number,official_finish_code,race_id,updated_at",
      ) &&
        client.upserts.every(
          (u) => u.opts.onConflict === "race_id,boat_number",
        ),
    );
    // 1日で1000行を超える日（2026-01-02 は192レース）: 1000行目より後ろの行も読んで書く
    const many = Array.from({ length: 1100 }, (_, i) => ({
      race_id: `${DATE}-01-${String(Math.floor(i / 6) + 1).padStart(3, "0")}`,
      boat_number: (i % 6) + 1,
      official_finish_code: "01",
    }));
    many.push({ race_id: S1_RACE, boat_number: 2, official_finish_code: null });
    const big = fakeClient(many);
    const br = await sync(DATE, { client: big, loadText: async () => K_TEXT });
    expect(
      "(b) 1000行を超える日も、1001行目以降の行（S1 の2号艇）を読んで書く",
      br.pending === 1 &&
        big.upserts
          .flatMap((u) => u.batch)
          .some((w) => w.race_id === S1_RACE && w.boat_number === 2),
      show(br),
    );
    await evaluateSyncRest(sync, expect);
    if (loads !== 1) failed.push("(b) K は1回だけ読む");
  } finally {
    console.log = quietLog;
  }
  return failed;
}

async function evaluateSyncRest(sync, expect) {
  // 全部入っていれば K を取得しない
  let loads2 = 0;
  const full = await sync(DATE, {
    client: fakeClient([
      { race_id: S1_RACE, boat_number: 2, official_finish_code: "S1" },
    ]),
    loadText: async () => (loads2++, K_TEXT),
  });
  expect(
    "(b) 成績コードが全部入っていれば K を取得しない",
    full.status === "nothing_pending" && loads2 === 0,
    show(full),
  );
  const missing = fakeClient([], { missingColumn: true });
  const mr = await sync(DATE, {
    client: missing,
    loadText: async () => K_TEXT,
  });
  expect(
    "(b) 列が未適用なら何も書かずに column_missing",
    mr.status === "column_missing" && missing.upserts.length === 0,
    show(mr),
  );
  const dry = fakeClient([
    { race_id: S1_RACE, boat_number: 2, official_finish_code: null },
  ]);
  const dr = await sync(DATE, {
    client: dry,
    dryRun: true,
    loadText: async () => K_TEXT,
  });
  expect(
    "(b) dry-run は書かない",
    dr.updated === 1 && dry.upserts.length === 0,
    show(dr),
  );
}
