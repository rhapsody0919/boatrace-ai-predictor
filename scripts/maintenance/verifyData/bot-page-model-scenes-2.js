/**
 * verify-bot-page-model.js の後半の場面（2/4）。verify ではない。
 * 判定と期待値は分ける前の verify-bot-page-model.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { t, ja } from "./bot-page-model-scenes-1.js";

let failures, check, checkThrows, browserTouches, fresh, TODAY, restoreBrowserGlobals, buildVenueModel, buildTopModel, TodayRacesShapeError, transformTodayRaces;

const BROKEN = [
  ["null", null],
  ["文字列", "<html>"],
  ["success が false", { success: false, data: [] }],
  ["success が無い", { data: [] }],
  ["data が無い", { success: true }],
  ["data がオブジェクト", { success: true, data: {} }],
  ["会場コードが無い", { success: true, data: [{ races: [] }] }],
  [
    "会場コードが範囲外",
    { success: true, data: [{ place_cd: 99, races: [] }] },
  ],
  ["races が無い", { success: true, data: [{ place_cd: 1 }] }],
  [
    "raceNo が無い",
    { success: true, data: [{ place_cd: 1, races: [{ startTime: "10:00" }] }] },
  ],
];

function scene1() {
  // レース番号が逆順で来ても、人の画面と同じくレース番号順に並べる
  {
    const json = fresh();
    json.data[0].races.reverse();
    check(
      "並び: レース番号順",
      buildVenueModel(json, 1, { t }).races.map((r) => r.raceNumber),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    );
  }
  // 中止（その日のフィクスチャには無いので、1レースだけ書き換えて確かめる）
  {
    const json = fresh();
    const r3 = json.data[0].races.find((r) => r.raceNo === 3);
    r3.cancellationStatus = "confirmed";
    r3.result = null;
    const r4 = json.data[0].races.find((r) => r.raceNo === 4);
    r4.cancellationStatus = "confirmed"; // 結果があるので中止にしない（BOA-525）
    const r5 = json.data[0].races.find((r) => r.raceNo === 5);
    r5.cancellationStatus = "tentative"; // 暫定は中止にしない
    r5.result = null;
    const model = buildVenueModel(json, 1, { t });
    check("中止: confirmed で結果なし", model.races[2].cancelledLabel, "中止");
    check(
      "中止: confirmed でも結果があれば中止にしない",
      model.races[3].cancelledLabel,
      null,
    );
    check("中止: tentative は中止にしない", model.races[4].cancelledLabel, null);
  }
  // SG・G1 開催中は title・description に節タイトル（NFKC）が入る（人のページと同じ関数）
  {
    const json = fresh();
    json.data
      .find((v) => v.place_cd === 3)
      .races.forEach((r) => {
        r.raceGrade = "G1";
      });
    const model = buildVenueModel(json, 3, { t });
    check(
      "G1: title に節タイトル",
      model.meta.title,
      ja.venueRaceList.metaTitleSeries
        .replace("{{venue}}", "江戸川")
        .replace("{{series}}", "オールレディース 江戸川女王決定戦KIRINCUP"),
    );
    check("G1: カードのグレード", model.races[0].gradeLabel, "G1");
  }
  // ---- 3. 0件と壊れた入力 ----
  {
    const empty = {
      success: true,
      scrapedAt: "2026-10-11T00:00:00+00:00",
      data: [],
    };
    const emptyTop = buildTopModel(empty, { t, today: TODAY });
    check("0件: 開催中の会場は0", emptyTop.openVenueCount, 0);
    check(
      "0件: 24会場とも非開催",
      emptyTop.venues.every((v) => !v.isOpen),
      true,
    );
    const emptyVenue = buildVenueModel(empty, 1, { t });
    check(
      "0件: 会場ページは開催なしの文言",
      emptyVenue.emptyText,
      "本日、このレース場での開催はありません",
    );
    check("0件: 会場ページのレースは空", emptyVenue.races, []);
    check(
      "開催していない会場（フィクスチャの平和島）も開催なし",
      buildVenueModel(fresh(), 4, { t }).emptyText,
      ja.home.noRacesToday,
    );
  }
  for (const [label, input] of BROKEN) {
    checkThrows(
      `壊れた入力（${label}）: トップ`,
      () => buildTopModel(input, { t, today: TODAY }),
      "TodayRacesShapeError",
    );
    checkThrows(
      `壊れた入力（${label}）: 会場`,
      () => buildVenueModel(input, 1, { t }),
      "TodayRacesShapeError",
    );
  }
  check(
    "TodayRacesShapeError を公開している",
    typeof TodayRacesShapeError,
    "function",
  );
}

function scene2() {
  checkThrows(
    "会場コード 0 は RangeError",
    () => buildVenueModel(fresh(), 0, { t }),
    "RangeError",
  );
  checkThrows(
    "会場コード 25 は RangeError",
    () => buildVenueModel(fresh(), 25, { t }),
    "RangeError",
  );
  checkThrows(
    "会場コード文字列は RangeError",
    () => buildVenueModel(fresh(), "01", { t }),
    "RangeError",
  );
  // ---- 4. 選手名・オッズ等が入らない ----
  {
    const json = fresh();
    const racerNames = json.data.flatMap((v) =>
      v.races.flatMap((r) => (r.racers || []).map((p) => p.name)),
    );
    check(
      "フィクスチャに選手名がある（検査が空振りしない）",
      racerNames.length > 0,
      true,
    );
    const models = [
      buildTopModel(fresh(), { t, today: TODAY }),
      ...json.data.map((v) => buildVenueModel(fresh(), v.place_cd, { t })),
    ];
    const text = JSON.stringify(models);
    const leakedNames = racerNames.filter((n) => text.includes(n));
    check("選手名がモデルに無い", leakedNames.slice(0, 3), []);
    const FORBIDDEN_KEYS = [
      "racers",
      "players",
      "odds",
      "payout",
      "payouts",
      "result",
      "rank1",
      "volatility",
      "turnPrediction",
      "winRate",
      "motor2Rate",
    ];
    const keys = new Set();
    const collect = (v) => {
      if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === "object") {
        for (const [k, x] of Object.entries(v)) {
          keys.add(k);
          collect(x);
        }
      }
    };
    collect(models);
    check(
      "入れない項目のキーがモデルに無い",
      FORBIDDEN_KEYS.filter((k) => keys.has(k)),
      [],
    );
  }
}

async function scene3() {
  // transformTodayRaces は人の画面と同じ形（success・data・scrapedAt、会場名の補完、荒れ度の補助値）
  {
    const out = transformTodayRaces(
      {
        success: true,
        scrapedAt: "x",
        data: [
          {
            place_cd: 5,
            races: [{ raceNo: 1, placeCd: 5, volatility: { level: "high" } }],
          },
        ],
      },
      { 5: 0.5 },
    );
    check(
      "transformTodayRaces: 会場名を会場コードから補う",
      out.data[0].placeName,
      "多摩川",
    );
    check(
      "transformTodayRaces: 荒れ度に会場の1コース勝率を足す",
      out.data[0].races[0].volatility,
      { level: "high", venueWinRate: 0.5 },
    );
    check("transformTodayRaces: scrapedAt はそのまま", out.scrapedAt, "x");
    check(
      "transformTodayRaces: inCaution（BOA-822、RPC 157）は無ければ null にそろえる",
      out.data[0].races[0].inCaution,
      null,
    );
    const ic = { pct: 65, level: "high", n: 34842 };
    check(
      "transformTodayRaces: inCaution はレース直下にそのまま通す",
      transformTodayRaces(
        {
          data: [
            { place_cd: 5, races: [{ raceNo: 1, placeCd: 5, inCaution: ic }] },
          ],
        },
        {},
      ).data[0].races[0].inCaution,
      ic,
    );
  }
  // BOA-1219: 今日のレースで対象を決め、初日は race_series を使う。
  {
    const { seriesOfDate, seriesCoveringDate, SERIES_POSTPONE_TOLERANCE_DAYS } =
      await import("../../../src/utils/meetPageModel.js");
    const row = { start_date: "2026-10-06", end_date: "2026-10-11", title: "節", grade: "G1" };
    check("順延3日", seriesOfDate([row], "2026-10-14"), row);
    check("順延4日", seriesOfDate([row], "2026-10-15"), null);
    check("未来の節・空", seriesOfDate([row], "2026-10-05"), null);
    const older = { ...row, start_date: "2026-09-01" };
    check("初日降順の先頭", seriesOfDate([older, row], "2026-10-11"), row);
    check("画面とボットで順延許容日数を共有", SERIES_POSTPONE_TOLERANCE_DAYS, 3);
    // getSeriesOfDate の lte・降順・limit(1) と、その後の共通判定に一致する。
    const rows = [
      row,
      { ...row, start_date: "2026-10-20", end_date: "2026-10-25" },
      older,
    ];
    const before = JSON.stringify(rows);
    for (const date of [
      "2026-08-31", "2026-10-06", "2026-10-11",
      "2026-10-14", "2026-10-15", "2026-10-20",
    ]) {
      const latest = rows
        .filter((r) => r.start_date <= date)
        .sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
      check(
        `${date}: getSeriesOfDate と同じ行を返す`,
        seriesOfDate(rows, date) === seriesCoveringDate(latest, date),
        true,
      );
    }
    check("空の節一覧", seriesOfDate([], TODAY), null);
    check("節一覧を並べ替えない", JSON.stringify(rows), before);
    for (const lang of ["ja", "en", "zh-TW", "ko"]) {
      const json = fresh();
      json.data.find((v) => v.place_cd === 1).races.forEach((r) => { r.raceGrade = "G1"; r.raceTitle = "公式の節"; });
      const options = { t, lang, today: "2026-10-11", seriesRows: [row] };
      const model = buildVenueModel(json, 1, options);
      check(`${lang}: 節リンク`, model.meetBanner, {
        href: `${lang === "ja" ? "" : `/${lang}`}/venue/1/meet/2026-10-06`,
        name: "G1 公式の節", inProgress: t("venueMeetBanner.inProgress"), link: t("venueMeetBanner.link"),
      });
      check("行なし", buildVenueModel(json, 1, { ...options, seriesRows: [] }).meetBanner, null);
      check("期限切れ", buildVenueModel(json, 1, { ...options, today: "2026-10-15" }).meetBanner, null);
      for (const race of json.data.find((v) => v.place_cd === 1).races) race.raceTitle = "グランプリ";
      check("対象外", buildVenueModel(json, 1, options).meetBanner, null);
    }
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（failures・check・checkThrows・browserTouches・fresh・TODAY・restoreBrowserGlobals・buildVenueModel・buildTopModel・TodayRacesShapeError・transformTodayRaces） */
export async function runBotPageModelScenes4(env) {
  ({ failures, check, checkThrows, browserTouches, fresh, TODAY, restoreBrowserGlobals, buildVenueModel, buildTopModel, TodayRacesShapeError, transformTodayRaces } = env);
  scene1();
  scene2();
  await scene3();
}

function scene4() {
  // ---- 1. の締め: 罠を外し、触った依存・握りつぶされた違反が無いかを見る ----
  restoreBrowserGlobals();
}

/** verify から呼ぶ入口。env は verify 側の束縛（failures・check・checkThrows・browserTouches・fresh・TODAY・restoreBrowserGlobals・buildVenueModel・buildTopModel・TodayRacesShapeError・transformTodayRaces） */
export function runBotPageModelScenes5(env) {
  ({ failures, check, checkThrows, browserTouches, fresh, TODAY, restoreBrowserGlobals, buildVenueModel, buildTopModel, TodayRacesShapeError, transformTodayRaces } = env);
  scene4();
}

function scene5() {
  for (const touch of new Set(browserTouches))
    failures.push(`botPageModel.js の木: ${touch}`);
}

/** verify から呼ぶ入口。env は verify 側の束縛（failures・check・checkThrows・browserTouches・fresh・TODAY・restoreBrowserGlobals・buildVenueModel・buildTopModel・TodayRacesShapeError・transformTodayRaces） */
export function runBotPageModelScenes6(env) {
  ({ failures, check, checkThrows, browserTouches, fresh, TODAY, restoreBrowserGlobals, buildVenueModel, buildTopModel, TodayRacesShapeError, transformTodayRaces } = env);
  scene5();
}
