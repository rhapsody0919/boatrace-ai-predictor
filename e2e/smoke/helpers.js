import { fetchRecorded } from "../fixtures.js";

/**
 * 分析ツール（/winning-technique）の一部タブは「本日開催中のレース」を基準に
 * データを取得する実装になっている。E2Eは録画時刻で走るため、撮影時刻にたまたま
 * 開催中の会場が無い・本日分の結果確定レースが無いと、これらのタブが毎回
 * 空状態（.empty-state）だけで通ってしまい、中身を一度も検証しないまま
 * green になっていた（BOA-664）。test.skip ではないため check:e2e-skips でも
 * 検知できない。
 *
 * races/race_entries/race_results は「本日分しか持たない」という実装コメントに
 * 反して過去分も保持している（2026-10-02実測、2025-12-02〜現在で47,568行）ため、
 * レース詳細のE2E（BOA-445）と同じ戸田8R（2026-09-18-02-08、結果・進入コース
 * 補完済み）を使い、ブラウザ時計をその日に固定することで「本日」を確実に
 * データがある日として再現する。venue_code/race_id を受け付けるタブはそのレース
 * を直接指定し（ディープリンクは「本日開催」一覧の有無を問わず信頼される、
 * useVenueRaceSelector参照）、受け付けないタブ（好調・不調ランキング/
 * 会場ランキング）は時計だけで揃える。
 */
export const ANALYSIS_FIXED_DATE = "2026-09-18";

export const ANALYSIS_FIXED_VENUE_CODE = 2; // 戸田

export const ANALYSIS_FIXED_RACE_ID = `${ANALYSIS_FIXED_DATE}-02-08`;

/** 正午JST。当日の全レースは既に結果確定済みのため、時刻自体に意味は無い */
export const ANALYSIS_FIXED_NOON_JST = new Date(
  `${ANALYSIS_FIXED_DATE}T12:00:00+09:00`,
);

/**
 * 分析ツールのタブを、当日開催データが確実にある固定の過去日で開く（BOA-664）。
 * withRace=false のタブ（venue_code/race_id を受け付けない）では付与しない。
 */
export async function gotoAnalysisTabOnFixedDate(
  page,
  tab,
  { withRace = true } = {},
) {
  await page.clock.setFixedTime(ANALYSIS_FIXED_NOON_JST);
  const params = new URLSearchParams({ tab });
  if (withRace) {
    params.set("venue_code", String(ANALYSIS_FIXED_VENUE_CODE));
    params.set("race_id", ANALYSIS_FIXED_RACE_ID);
  }
  await page.goto(`/winning-technique?${params.toString()}`);
}

// 当日の開催状況に依存しないための固定のレース（BOA-445）。
//
// 以前は「本日開催中で未終了のレース」をトップページから探し、無ければ skip していた。
// E2Eは録画の時刻で走るので、撮影した時刻に発走前のレースが無いと、これらのテストが
// まとめて skip になり何も検証しなくなる（夜間の実行では9件が skip）。
//
// - 2026-09-18 戸田8R（締切 14:16）。結果・進入コースの補完が済んだ過去レース
// - イン崩れ指数 0.97（非フォールバック）＝ high。境界（0.7）から遠く、段階が揺れない
// - 同じレースをオッズ一覧のテスト（BOA-311）でも使っている
//
// 直近N走のように後から窓がずれる値には、アサーションを依存させないこと
// （進入コースの補完で窓がずれた実例がある。#1080 の T3-1）
export const FIXED_RACE_DATE = "2026-09-18";

export const FIXED_RACE_ID = `${FIXED_RACE_DATE}-02-08`;

/** 締切 14:16 の30分前。この時刻のブラウザでは「当日・発走前」として描画される */
export const FIXED_RACE_BEFORE_START = new Date(
  `${FIXED_RACE_DATE}T13:46:00+09:00`,
);

/**
 * 固定のレースを「当日・発走前」の状態で開く。AI用コピー・AI予想タブの予想・
 * イン崩れの演出など、結果が出る前にしか描画しないUIの検証に使う。
 *
 * - ブラウザの時計をそのレースの締切30分前に固定する（fixture が入れた録画時刻を上書きする）
 * - 予想データの応答（Edge API）から、そのレースの結果だけを外す。
 *   結果の有無は時計ではなく result で判定している（PredictionPanel の isFinished）ため、
 *   時計を戻すだけでは発走前にならない。他のレース・他の項目は実データのまま
 *
 * Edge API が失敗して Supabase への直接クエリに落ちた場合は結果が残り、
 * 呼び出し側のアサーション（バナーが出る等）で落ちる。黙って skip にはしない
 */
export async function openFixedRaceBeforeStart(page) {
  await page.addInitScript(() => localStorage.setItem("boatai-language", "ja"));
  await page.clock.setFixedTime(FIXED_RACE_BEFORE_START);
  await page.route(`**/api/predictions/${FIXED_RACE_DATE}*`, async (route) => {
    // route.fetch() は録画を通らないため fetchRecorded を使う（ADR-0077）
    const response = await fetchRecorded(route);
    const body = await response.json();
    const races = (body.races || []).map((race) =>
      race.raceId === FIXED_RACE_ID ? { ...race, result: null } : race,
    );
    await route.fulfill({
      status: response.status(),
      headers: response.headers(),
      json: { ...body, races },
    });
  });
  // 予想データは軽量版→フル版の順に2回取る（useDatePredictions）。フル版の応答まで待つ。
  // 待たずに検証が先に終わると、取得中の route がテスト終了で閉じた context に当たって
  // 失敗する（本番データの実行で再現）。フル版で描画が変わる項目の揺れも防ぐ
  const fullLoaded = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/predictions/${FIXED_RACE_DATE}`) &&
      !response.url().includes("light=true"),
  );
  await page.goto(`/race/${FIXED_RACE_ID}`);
  await fullLoaded;
}
