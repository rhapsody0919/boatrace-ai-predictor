/**
 * 展示データ専用軽量スクレイピングスクリプト
 *
 * beforeinfo ページから展示タイム・展示STのみを取得し、
 * Supabase exhibition_data テーブルに直接 upsert する。
 * data/races.json には一切触れない。
 *
 * 実行時間: 約3-4分（取得済みレースはスキップ）
 */

import { getTodayDateJST, parseDateArg } from "../lib/dateUtils.js";
import {
  supabase,
  isSupabaseEnabled,
  fetchAll,
  VENUE_NAMES,
} from "../lib/supabaseClient.js";
import { getRaceSchedule, getRacesInWindow } from "../lib/raceSchedule.js";
import { buildStartTimeLookup } from "../lib/beforeinfoWeather.js";
import { parseBeforeInfoDocument } from "../lib/beforeInfoParser.js";
import { detectPreRaceSchema } from "../lib/preRaceSchema.js";
import {
  absorbVenueResults,
  groupTargetsByVenue,
  toLegacyExhibition,
  upsertExhibitionRows,
} from "../lib/exhibitionJobParts.js";
import {
  fetchExhibitionDetailed,
  updateRaceConditionsWeather,
} from "../lib/exhibitionRunForRaces.js";

// 読み手（backfill-exhibition-time.js 等）が今までどおりこのファイルから読めるように再 export
export { toLegacyExhibition };

// マイグレーション056（BOA-221）・059（BOA-289）で追加した列。未適用のDBでは除いて書き込む
/**
 * Supabase から「展示タイムが取得済み」の race_id セットを取得
 *
 * 行が存在するかではなく exhibition_time が非nullの行があるかで判定する。
 * 鳴門・丸亀・児島・江戸川等では公式ページが展示ST（スタート展示）を展示タイムより
 * 先に公開するため、その間に取得すると exhibition_time=null・start_timing のみの行が
 * 書かれる。行の有無で判定すると、この行が「取得済み」とみなされ展示タイムが
 * 永久に補完されない（2026-09-19判明、9/18は29レース＝16%が該当）。
 * 展示ST（start_timing）も非nullであることを条件にする（BOA-271 の前提の補完、2026-10-01）。Kファイルから
 * exhibition_time だけを入れた過去のレース（2025-12〜2026-03）を「取得済み」にすると、展示ST・チルト・体重を
 * 直前情報の過去日ページから後で補う道が閉じるため。当日の取得への影響は、展示STが無いレース（9月は月に約20）が
 * 窓の中で再試行されるだけ（過去日を自動で取り直す経路は無い。過去日は手動の補完 CLI のみ）。
 *
 * exhibition_data は1レース6行のため、1日180レースで1000行のデフォルト上限を超える。
 * fetchAll でページネーションして取りこぼしを防ぐ。
 */
export async function getRaceIdsWithExhibitionTime(date) {
  if (!isSupabaseEnabled()) return new Set();

  const rows = await fetchAll(
    "exhibition_data",
    "race_id",
    (q) =>
      q
        .gte("race_id", date)
        .lt("race_id", `${date}~`)
        .not("exhibition_time", "is", null)
        .not("start_timing", "is", null)
        .order("race_id")
        .order("boat_number"),
    // 取得済みのスキップ判定にだけ使う。失敗したら空・途中までの集合になり、窓内のレースを取り直す（取得先への
    // 負荷が少し増えるだけで、データは欠けない）。例外にすると、その回の展示の取得が丸ごと飛ぶ
    // 握りつぶし可（BOA-391）: スキップ判定だけで、失敗時は取り直すため欠けない
    { throwOnError: false },
  );

  return new Set(rows.map((r) => r.race_id));
}

/**
 * beforeinfo ページから展示データをスクレイピング（旧実装と同じ形。全項目の解析は
 * scripts/lib/beforeInfoParser.js の parseBeforeInfoDocument）
 * @returns {{ data: Array|null, reason: string|null }}
 *   reason: 'tables_lt_2' | 'no_boats' | 'no_values' | null(成功)
 */
export function scrapeExhibitionData($) {
  return toLegacyExhibition(
    parseBeforeInfoDocument($),
    $(".table1").eq(1).find("tbody").length,
  );
}

export {
  fetchExhibitionDetailed,
  runForRaces,
  updateRaceConditionsWeather,
} from "../lib/exhibitionRunForRaces.js";

/**
 * 1レースの展示データと気象を取得する（従来の入口。失敗は data: null に丸めてログに出す）
 * @returns {{ data: Array|null, reason: string|null, conditions: Object|null }}
 *   conditions: 水面気象情報の解析結果（ページを取得できなかった場合は null）。
 *   展示データが未公開（data が null）でも、気象は解析する
 */
async function fetchExhibitionForRace(date, venueCode, raceNo) {
  const detail = await fetchExhibitionDetailed(date, venueCode, raceNo);
  if (detail.status === "ok") return detail;
  if (detail.status !== "http_error") {
    console.error(`  ❌ ${VENUE_NAMES[venueCode]} ${raceNo}R: ${detail.error}`);
  }
  return { data: null, reason: detail.reason, conditions: null };
}

/**
 * exhibition_data へ、変更のある行だけを upsert する（run・runForRaces の共通の書き込み）。
 * 変更の無い行は書かず、書く行には updated_at を設定する（WS2）。展示タイム未公開でSTだけの行は、
 * 展示タイムが入るまで毎回再取得されるため、値が同じ間は書かない（updated_atが「値が変わった時刻」
 * を表すようにする）。created_at は初回のINSERT時にDBの DEFAULT が入る
 *
 * BOA-221の新列（マイグレーション056）とBOA-289の新列（マイグレーション059）は別々の
 * マイグレーションのため、片方だけ未適用というケースがありうる（本プロジェクトはSupabase Access
 * Tokenの失効等でマイグレーションを手動・個別に適用してきた実績があり、054適用済み・056未適用の
 * ような部分適用状態は現実的に起こりうる）。1つの列不在エラーで両方の新列を一律に剥がすと、056が
 * 既に適用済みで正常に書き込めていたtilt等まで巻き添えで書き込み停止してしまう（PR #645セルフ
 * レビューで発見）。そのため、エラーに名前の出た列が属するグループだけを除いて書き直し、
 * 適用済みのマイグレーション分は引き続き書き込み続ける（scripts/lib/optionalColumns.js）
 * 書き込みエラーは upsertChangedRows がログに出す（呼び出し元の戻り値・後続処理は従来どおり）
 */
/**
 * オーケストレーターから呼び出し可能な展示データ取得処理
 * @param {Array} schedule - getRaceSchedule() の返り値（外部から渡す）
 * @param {string} date - YYYY-MM-DD
 * @param {{updateWeather?: boolean}} [options]
 *   updateWeather: 取得した beforeinfo の気象も race_conditions へ反映するか（既定 true、BOA-358）。
 *   過去レースの補完（scrape-exhibition-data の backfill 系）は、beforeinfo が「その日の最新の観測」
 *   を表示するため false にする
 * @returns {Promise<{updated: boolean, count: number, weather?: Object, changedRaceIds: string[]}>}
 *   changedRaceIds: 展示データ・気象を実際に書き込んだレース（変更の無い行は書かないため、
 *   updated=true でも含まれないレースがある）。予測の再計算（Vercel、REFRESH_ON_VERCEL）の対象
 */
/**
 * 展示データ取得のウィンドウ（BOA-55: 発走30分前・15分前・10分前）
 * 展示タイム取得済みのレースはスキップするため広めに取っても二重取得なし。
 */
const EXHIBITION_WINDOWS = [30, 15, 10];

export async function run(schedule, date, { updateWeather = true } = {}) {
  // BOA-55: 30分前（初回取得）・15分前・10分前（未取得時リトライ）のウィンドウをカバー
  const exhibitionTargetMap = new Map();
  for (const w of EXHIBITION_WINDOWS) {
    for (const r of getRacesInWindow(schedule, w, 3)) {
      exhibitionTargetMap.set(r.race_id, r);
    }
  }
  const windowRaces = [...exhibitionTargetMap.values()];

  if (windowRaces.length === 0) {
    console.log("📭 展示: 発走10〜33分前ウィンドウの対象レースなし");
    return { updated: false, count: 0, changedRaceIds: [] };
  }
  console.log(
    `🎯 展示データ取得: ${windowRaces.length}レース（発走30/15/10分前ウィンドウ）`,
  );

  // 展示タイム取得済みの race_id（スキップ判定用）。展示タイム未公開のnull行は
  // 取得済み扱いにせず、次回のcron実行で再取得・上書きする
  const fetchedRaceIds = await getRaceIdsWithExhibitionTime(date);
  const targets = windowRaces.filter((r) => !fetchedRaceIds.has(r.race_id));

  if (targets.length === 0) {
    console.log("📭 展示: 全レース取得済み（スキップ）");
    return { updated: false, count: 0, changedRaceIds: [] };
  }

  return scrapeAndUpsertRaces(targets, date, {
    updateWeather,
    // 「N R時点」の気象の観測時刻（Nレース目の発走予定時刻）の解決用
    startTimeLookup: buildStartTimeLookup(schedule),
  });
}

/**
 * 指定レースの展示データを取得して exhibition_data に upsert する
 * （取得済み判定・ウィンドウ判定は呼び出し側の責務。過去分の補完スクリプトからも使う）
 * @param {Array<{race_id: string, venue_code: number, race_no: number, start_time?: Date}>} targets
 *   start_time: 発走予定時刻。気象の更新（updateWeather）では、発走後の観測を弾くために使う
 * @param {string} date - YYYY-MM-DD
 * @param {{updateWeather?: boolean, startTimeLookup?: Function|null}} [options]
 *   updateWeather: 気象も race_conditions へ反映するか。既定 false（過去分の補完は、beforeinfo が
 *   発走後もその日の最新の観測を表示するため、気象を書かない）。run() は既定 true で呼ぶ
 *   startTimeLookup: buildStartTimeLookup() の戻り値（「N R時点」の観測時刻の解決用）
 *   client: テスト用のSupabaseクライアントの差し替え
 * @returns {Promise<{updated: boolean, count: number, weather: Object|null, changedRaceIds: string[]}>}
 */
export async function scrapeAndUpsertRaces(
  targets,
  date,
  {
    updateWeather = false,
    startTimeLookup = null,
    // テスト用の差し替え（既定は supabaseClient.js）
    client = supabase,
  } = {},
) {
  // 直前情報の新しい列（マイグレーション082）が適用済みかを先に判定する。未適用なら、旧実装と同じ列だけを書く
  const extended = (await detectPreRaceSchema(client)).exhibition;

  let totalFetched = 0;
  const allRows = [];
  // 気象の反映対象（レースごとの解析結果）。展示データが未公開でも、ページを取得できたレースは対象
  const weatherFetched = [];

  // 会場ごとにグループ化し、会場内の全対象レースを並列取得
  const venueEntries = [...groupTargetsByVenue(targets).entries()];
  for (let vi = 0; vi < venueEntries.length; vi++) {
    const [venueCode, races] = venueEntries[vi];
    const results = await Promise.all(
      races.map((r) =>
        fetchExhibitionForRace(date, venueCode, r.race_no).then(
          ({ data, reason, conditions, page }) => ({
            raceId: r.race_id,
            startTime: r.start_time ?? null,
            data,
            reason,
            conditions,
            page,
          }),
        ),
      ),
    );
    totalFetched += absorbVenueResults(results, {
      venueCode,
      extended,
      allRows,
      weatherFetched,
    });

    // 会場間1秒待機（サーバー負荷配慮）
    if (vi < venueEntries.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // 実際に書き込んだ（＝変更のあった、または新規の）レース。予測の再計算の対象になる
  const changedRaceIds = new Set();

  // 気象の反映（BOA-358）。展示より先に書く（展示タイムを見て動く読み手が同じ取得回の気象を読めるように。
  // BOA-271 T4-3）。失敗しても展示の成否・戻り値（予測リフレッシュの起動条件）には影響させない
  const weather = updateWeather
    ? await updateRaceConditionsWeather(weatherFetched, date, {
        startTimeLookup,
        client,
      })
    : null;

  // Supabase に upsert
  if (allRows.length > 0) {
    console.log(`\n💾 exhibition_data: ${allRows.length}件書き込み中...`);

    const written = await upsertExhibitionRows(client, allRows);
    // 書き込みが1行も成功していないバッチだけのとき（全滅）は、DBが変わっていないので含めない
    if (written.written > 0) {
      for (const row of written.toWrite) changedRaceIds.add(row.race_id);
    }
  } else {
    console.log("\n📭 展示: 新規データなし");
  }

  console.log(`📊 展示: 取得${totalFetched}R / データ${allRows.length}件`);

  // 気象も予測の入力（イン崩れ指数の風速・波高）のため、書き込んだレースは再計算の対象に含める
  for (const raceId of weather?.changedRaceIds ?? [])
    changedRaceIds.add(raceId);

  return {
    updated: allRows.length > 0,
    count: allRows.length,
    weather,
    changedRaceIds: [...changedRaceIds],
  };
}

/**
 * メイン処理（スタンドアローン実行用）
 */
async function main() {
  console.log("🚀 展示データ専用スクレイピング開始");
  console.log(`⏰ ${new Date().toISOString()}`);

  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です。");
    process.exit(1);
  }

  const date = parseDateArg() || getTodayDateJST();
  console.log(`📅 対象日: ${date}`);

  const schedule = await getRaceSchedule(date);
  if (schedule.length === 0) {
    console.log("📭 対象レースなし（スケジュール未登録）");
    return;
  }
  console.log(`📊 当日レース数: ${schedule.length}件`);

  await run(schedule, date);
  console.log("🏁 完了");
}

// スタンドアローン実行時のみ main() を呼ぶ（import 時に実行させない）
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    console.error("❌ エラー:", error);
    process.exit(1);
  });
}
