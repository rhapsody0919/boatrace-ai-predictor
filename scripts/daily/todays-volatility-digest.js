/**
 * 「本日のイン崩れ警戒レース」ダイジェスト生成
 *
 * 背景: 競合「ボートレース日和」の毎朝の「本日のデータ一覧」型投稿を調査した結果
 * （2026-08-23）、①内容の違いより投稿の継続自体が効いている低コストな型であること、
 * ②競合は「逃げ率70%以上」等の過去実績の静的な閾値フラグを並べているのに対し、
 * 龍神レーダーの「イン崩れ指数」は当日条件込みの予測値で解像度が高いこと、が分かった。
 * この差別化ポイントを活かし、当日開催の全レースをイン崩れ指数でソートして
 * 上位（荒れそうなレース）を提示する、低コストで自動化しやすいX投稿用ダイジェストを
 * 生成する。
 *
 * 使い方:
 *   node scripts/daily/todays-volatility-digest.js [--date=YYYY-MM-DD] [--top=5]
 *
 * 出力: 標準出力にランキングとX投稿用のキャプション案を表示する。
 * 投稿の実行はユーザーの承認を得てから別途行う（自動投稿はしない）。
 */
import { supabase, VENUE_NAMES } from "../lib/supabaseClient.js";
import { getTodayDateJST } from "../lib/dateUtils.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? true];
  }),
);
const TARGET_DATE = args.date || getTodayDateJST();
const TOP_N = Number(args.top ?? 5);

function parseRaceId(raceId) {
  const [, , , venueCode, raceNumber] = raceId.split("-");
  return {
    venueCode: parseInt(venueCode, 10),
    raceNumber: parseInt(raceNumber, 10),
  };
}

async function fetchAll(buildQuery) {
  const PAGE = 1000;
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function main() {
  const predictions = await fetchAll((from, to) =>
    supabase
      .from("predictions")
      .select("race_id, feature_contributions")
      .eq("model_id", "unified")
      .like("race_id", `${TARGET_DATE}-%`)
      .not("feature_contributions", "is", null)
      .range(from, to),
  );

  if (predictions.length === 0) {
    console.log(
      `${TARGET_DATE}のunified予想データが見つかりませんでした（まだ生成されていない可能性があります）。`,
    );
    return;
  }

  const races = predictions
    .map((p) => {
      const fc = p.feature_contributions;
      const volatilityPercentile = fc?.volatilityPercentile;
      if (typeof volatilityPercentile !== "number") return null;

      const { venueCode, raceNumber } = parseRaceId(p.race_id);
      return {
        raceId: p.race_id,
        venue: VENUE_NAMES[venueCode] || `${venueCode}番`,
        raceNumber,
        volatilityPercentile,
        volatilityComposite: fc?.volatilityComposite ?? 0,
        volatilityReasons: fc?.volatilityReasons || [],
      };
    })
    .filter(Boolean)
    // パーセンタイルは同一会場内の相対値のため上位が100%で並びがちになる。
    // その場合は生スコア(volatilityComposite)で細かく差をつける
    .sort(
      (a, b) =>
        b.volatilityPercentile - a.volatilityPercentile ||
        b.volatilityComposite - a.volatilityComposite,
    );

  const top = races.slice(0, TOP_N);

  console.log(
    `\n${TARGET_DATE} イン崩れ警戒レース TOP${TOP_N}（全${races.length}レース中）:\n`,
  );
  top.forEach((r, i) => {
    console.log(
      `${i + 1}. ${r.venue}${r.raceNumber}R — イン崩れ指数 ${Math.round(r.volatilityPercentile * 100)}%`,
    );
    r.volatilityReasons.forEach((reason) => console.log(`     - ${reason}`));
  });

  // X投稿用キャプション案（本文末のハッシュタグ羅列はしない、X公式ベストプラクティス準拠）
  const lines = top.map(
    (r, i) =>
      `${i + 1}. ${r.venue}${r.raceNumber}R（イン崩れ指数${Math.round(r.volatilityPercentile * 100)}%）`,
  );
  const caption = [
    `【本日のイン崩れ警戒レース】(${TARGET_DATE.slice(5).replace("-", "/")})`,
    "",
    "AIが「1号艇が崩れやすい」と判定した上位レースはこちら。",
    "",
    ...lines,
    "",
    "詳しい分析は無料で",
    "boat-ai.jp",
    "",
    "#龍神レーダー",
  ].join("\n");

  console.log("\n--- X投稿用キャプション案 ---\n");
  console.log(caption);
  console.log(
    "\n※ 投稿は必ずユーザーの承認を得てから行うこと（自動投稿はしない）。",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
