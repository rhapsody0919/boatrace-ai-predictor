/**
 * verify-meet-start-date.js の後半の場面（行から節の初日を決める共通の入口・BOA-861 の今節の区切り・サービス本体を偽のクライアントで）。verify ではない。
 * 判定と期待値は分ける前の verify-meet-start-date.js と同じ。check は verify 側の物を受け取る（失敗の数は verify が数える）。
 */
import { fetchCurrentMeetRaceEntries } from "../../../src/services/currentMeetEntries.js";
import {
  groupIntoCurrentMeet,
  groupCurrentMeetFromRows,
  meetDaysFromRows,
  meetStartFromRows,
  seriesDayByDate,
} from "../../../src/utils/meetGrouping.js";

// ---- 行から節の初日を決める共通の入口（BOA-856。今節タブ・会場の節の初日・節ページ・
// Shorts 用 API の4か所が同じ関数を使う） ----
const cond = (date, seriesDay, isFinalDay = false, r = "01") => ({
  race_id: `${date}-02-${r}`,
  series_day: seriesDay,
  is_final_day: isFinalDay,
});

// 戸田 2026-09（本番の実測）: 9/21 が中止確定で、9/22 にもう一度「4日目」。節は 9/18〜9/24
const TODA_RENUMBER = [
  cond("2026-09-17", 6, true),
  cond("2026-09-18", 1),
  cond("2026-09-19", 2),
  cond("2026-09-20", 3),
  cond("2026-09-21", 4),
  cond("2026-09-22", 4),
  cond("2026-09-23", 5),
  cond("2026-09-24", 6, true),
  cond("2026-09-26", 1),
];
const datesOf = (rows) => rows.map((c) => c.race_id.slice(0, 10));

// ---- Codex の BOA-856 報告の3点（getVenueMeetStart の窓・開催日の基準・空入力）を変えていないこと ----
// getVenueMeetStart は種別の行の日付だけを開催日として渡し、種別が1行も無ければ null を返す。
// 報告の合成入力（出走表 10/11〜13、種別は 10/11 が1日目・10/13 が2日目、最終日の印なし）で、
// 旧実装は 2026-10-13（種別の日付だけだと 10/11→10/13 が2日空き）、出走表を基準にする
// getMeetScoreboard・meetStartOf は 2026-10-11 だった。この差はそのまま残す
const CODEX_CONDS = [
  { race_id: "2026-10-11-05-01", series_day: 1, is_final_day: false },
  { race_id: "2026-10-13-05-01", series_day: 2, is_final_day: false },
];

// サービス本体に偽のクライアントを渡して実行する。本番クライアントは読み込まない。
// 画面のクライアントは throwOnError が既定なので、偽のクライアントも失敗を例外（reject）で返す。
const serviceEntries = ["2026-10-13-02-02", "2026-10-12-02-01", "2026-10-11-02-01"]
  .map((race_id) => ({ race_id, boat_number: 1 }));
const fakeClient = ({ failTable = null } = {}) => {
  const calls = [];
  const client = { from(table) {
    const query = {};
    for (const method of ["select", "eq", "order", "limit", "gte", "lte", "like"])
      query[method] = (...args) => { calls.push([table, method, ...args]); return query; };
    query.then = (resolve, reject) => {
      if (table === failTable)
        return Promise.reject(Object.assign(new Error("fixture"), { code: "57014" })).then(resolve, reject);
      return Promise.resolve({ data: table === "race_entries" ? serviceEntries : [
        cond("2026-10-11", 6, true), cond("2026-10-12", 1), cond("2026-10-13", 2),
      ] }).then(resolve, reject);
    };
    return query;
  } };
  return { client, calls };
};

/** 行から節の初日を決める共通の入口（seriesDayByDate・meetDaysFromRows・meetStartFromRows） */
export function checkRowsEntry(check) {
  check(
    "seriesDayByDate: その日の最小の series_day と、1行でも最終日なら最終日",
    [
      ...seriesDayByDate([
        cond("2026-09-24", null, true, "12"),
        cond("2026-09-24", 6, false, "01"),
        cond("2026-09-23", 5),
      ]).entries(),
    ],
    [
      ["2026-09-24", { seriesDay: 6, isFinalDay: true }],
      ["2026-09-23", { seriesDay: 5, isFinalDay: false }],
    ],
  );
  check(
    "meetDaysFromRows: 種別の無い日の isFinalDay は null、日付は重複を除いて昇順",
    meetDaysFromRows(
      ["2026-09-19", "2026-09-18", "2026-09-19"],
      [cond("2026-09-18", 1)],
    ),
    [
      { date: "2026-09-18", seriesDay: 1, isFinalDay: false },
      { date: "2026-09-19", seriesDay: null, isFinalDay: null },
    ],
  );
  check(
    "meetStartFromRows: 中止で日目が振り直されても節の初日は変わらない",
    meetStartFromRows(datesOf(TODA_RENUMBER), TODA_RENUMBER, "2026-09-24"),
    "2026-09-18",
  );
  check(
    "meetStartFromRows: 最終日の翌開催日から次の節",
    meetStartFromRows(datesOf(TODA_RENUMBER), TODA_RENUMBER, "2026-09-26"),
    "2026-09-26",
  );
  check(
    "meetStartFromRows: 出走表にしか無い日（種別が未取得）も開催日として数える",
    meetStartFromRows(
      ["2026-09-18", "2026-09-19", "2026-09-20"],
      [cond("2026-09-18", 1), cond("2026-09-19", 2)],
      "2026-09-20",
    ),
    "2026-09-18",
  );
  check(
    "meetStartFromRows: 開催日が空なら null",
    meetStartFromRows([], [], "2026-09-24"),
    null,
  );
}

/** Codex の BOA-856 報告の3点と、BOA-861 の今節の区切り（groupCurrentMeetFromRows） */
export function checkCodexAndGrouping(check) {
  check(
    "getVenueMeetStart の組み方（種別の日付だけ）は 2026-10-13（旧と同じ）",
    meetStartFromRows(datesOf(CODEX_CONDS), CODEX_CONDS, "2026-10-13"),
    "2026-10-13",
  );
  check(
    "getMeetScoreboard・meetStartOf の組み方（出走表の日付）は 2026-10-11（旧と同じ）",
    meetStartFromRows(
      ["2026-10-11", "2026-10-12", "2026-10-13"],
      CODEX_CONDS,
      "2026-10-13",
    ) ?? "2026-10-13",
    "2026-10-11",
  );
  check(
    "getVenueMeetStart の組み方は種別が空なら null（旧と同じ。呼び出し側は ?? を付けない）",
    meetStartFromRows(datesOf([]), [], "2026-10-13"),
    null,
  );

  // BOA-861: 同じ選手・会場・モーターでも、隣接する別節を混ぜない。
  for (const firstDate of ["2026-10-12", "2026-10-13"]) {
    const lastDate = firstDate === "2026-10-12" ? "2026-10-13" : "2026-10-14";
    const entries = ["2026-10-10", "2026-10-11", firstDate, lastDate]
      .map((date) => ({ race_id: `${date}-02-01`, boat_number: 1 }));
    const conditions = [
      cond("2026-10-10", 5), cond("2026-10-11", 6, true),
      cond(firstDate, 1), cond(lastDate, 2),
    ];
    check(`BOA-861: ${firstDate} 開始の節だけを返す`,
      groupCurrentMeetFromRows(entries, conditions), entries.slice(2));
    check(`BOA-861: ${firstDate} 種別が空なら従来の区間`,
      groupCurrentMeetFromRows(entries, []), groupIntoCurrentMeet(entries));
    check(`BOA-861: ${firstDate} 種別が null なら従来の区間`,
      groupCurrentMeetFromRows(entries, null), groupIntoCurrentMeet(entries));
  }
  // 審査 P2: 新しい節の初日（10/12）の種別の行がまだ無くても、前の節（10/05〜10/10、10/10 が最終日）の走を混ぜない
  {
    const entries = ["2026-10-07", "2026-10-12"].map((date) => ({ race_id: `${date}-02-01`, boat_number: 1 }));
    const conditions = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]
      .map((date, i) => cond(date, i + 1)).concat([cond("2026-10-10", 6, true)]);
    check("BOA-861: 対象日の種別の行が無くても前の節の走を混ぜない",
      groupCurrentMeetFromRows(entries, conditions), entries.slice(1));
  }
  // Codex P1: 途中の日（10/11）の種別の行だけが欠けても、開催休みとみなして節を切らない
  {
    const entries = ["2026-10-10", "2026-10-11", "2026-10-12"].map((date) => ({ race_id: `${date}-02-01`, boat_number: 1 }));
    check("BOA-861: 途中日の種別の行が欠けても今節の前半を落とさない",
      groupCurrentMeetFromRows(entries, [cond("2026-10-10", 1), cond("2026-10-12", 3)]), entries);
  }
  check("BOA-861: 出走が空なら空", groupCurrentMeetFromRows([], []), []);
}

/** サービス本体（fetchCurrentMeetRaceEntries）を偽のクライアントで回す。失敗は例外のまま上に流す */
export async function checkService(check) {
  {
    const { client, calls } = fakeClient();
    check("BOA-861: サービス取得は種別の初日（10/12）から今節を返す",
      await fetchCurrentMeetRaceEntries(client, 4320, 1), [...serviceEntries].reverse().slice(1));
    check("BOA-861: 種別の窓・会場",
      calls.filter(([table, method]) => table === "race_conditions" && ["gte", "lte", "like"].includes(method)), [
        ["race_conditions", "gte", "race_id", "2026-10-01"],
        ["race_conditions", "lte", "race_id", "2026-10-13-zz"],
        ["race_conditions", "like", "race_id", "__________-02-__"],
      ]);
  }
  // 取得の失敗は「データなし」や日付の推定に化けさせず、例外のまま上に流す（frontend-data-fetch.md）
  for (const failTable of ["race_entries", "race_conditions"]) {
    const { client } = fakeClient({ failTable });
    let thrown = null;
    try {
      await fetchCurrentMeetRaceEntries(client, 4320, 1);
    } catch (err) {
      thrown = err;
    }
    check(`BOA-861: ${failTable} の取得失敗は例外のまま上に流す`, thrown?.message, "fixture");
  }
}
