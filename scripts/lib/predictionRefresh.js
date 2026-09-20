/**
 * 予測の再計算（predictions のリフレッシュ）を、どこが・いつ起動するかの方針（案1、BOA-353 T4b-03、
 * docs/design/scraping-vercel-consolidation/plan.md §5）。
 *
 * 従来は、GitHub Actions の scrape-scheduled.js が、レース情報更新（発走60分前）・オッズ（60/30/15/10/5/0分前）・
 * 展示の更新のたびに、同じ実行の中で mainRefresh を呼んでいた。オッズは予測の入力に含まれないため、
 * オッズ起点の再計算の大半は、入力が変わらない再計算になっていた（1レース1日約6.6回、約1,200回/日の推定）。
 * 展示が Vercel Function に移った（2026-09-16、SKIP_EXHIBITION_ON_GHA）後は、展示の更新は GitHub Actions 側の
 * 再計算のきっかけから外れており、オッズが再計算を起動する副作用で間に合っていただけだった。
 *
 * 案1では、Vercel 側の展示取得が、実際に変更を書いたレースについてのみ、同じ関数の中で再計算する
 * （1レース約3回/日の見込み）。GitHub Actions 側は、オッズ起点の再計算を外す（レース情報更新の起点は残る）。
 *
 * 2つのトグル（どちらも既定は「現行動作」＝off）:
 *   REFRESH_ON_VERCEL=true          Vercel の環境変数。api/cron/exhibition.js が、変更を書いたレースを再計算する
 *   SKIP_ODDS_REFRESH_ON_GHA=true   GitHub のリポジトリ変数。scrape-scheduled.js が、オッズ起点の再計算を外す
 *
 * 組み合わせ（どちらも、再デプロイ・コード変更なしに切り替えられる。Vercel の環境変数は再デプロイが要る）:
 *   REFRESH_ON_VERCEL  SKIP_ODDS_REFRESH_ON_GHA  状態
 *   off                off                       現行（GitHub Actions が、レース情報・オッズ・展示の更新で再計算）
 *   on                 on                        案1（Vercel: 展示・気象の変更を起点 / GitHub: レース情報更新のみ）
 *   on                 off                       併走（同じレースを両方が再計算しうる。切り替えの過渡期のみ）
 *   off                on                        空白（展示の変更を起点にする再計算が、どこにも無い）。避ける
 * 併走でも、Vercel 側は upsert 方式（削除→挿入の交差が無い）のため、予測が空になったり、書き込みが
 * 衝突して失敗したりはしない（無駄な再計算が増えるだけ）。空白は、予測が古いまま残るため、最も避ける状態。
 * 切り替えの順序: 有効化は「Vercel を on → 確認 → GitHub を on」、切り戻しは「GitHub を off → Vercel を off」
 * （どちらも、空白を作らない順序。レースの無い時間帯に行えば、併走も起きない）。
 */

const isTrue = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase() === "true";

/** Vercel 側の再計算（展示の変更を起点）を有効にするか */
export function isRefreshOnVercelEnabled(env = process.env) {
  return isTrue(env.REFRESH_ON_VERCEL);
}

/** GitHub Actions 側で、オッズ起点の再計算を外すか */
export function isOddsRefreshSkippedOnGha(env = process.env) {
  return isTrue(env.SKIP_ODDS_REFRESH_ON_GHA);
}

/**
 * GitHub Actions（scrape-scheduled.js）の、再計算の対象レースを集める。
 * オッズ起点は、skipOddsRefresh が true のとき外す（レース情報更新・GitHub側で行った展示の更新は残す）。
 *
 * @param {Object} params
 * @param {Iterable<string>} params.infoRaceIds レース情報更新の対象（発走60分前）
 * @param {Iterable<string>} params.oddsRaceIds オッズ更新の対象（各窓）
 * @param {Iterable<string>} params.exhibitionRaceIds GitHub 側で展示を更新した対象（SKIP_EXHIBITION_ON_GHA=true なら空）
 * @param {boolean} params.skipOddsRefresh
 * @returns {Set<string>}
 */
export function collectGhaRefreshRaceIds({
  infoRaceIds = [],
  oddsRaceIds = [],
  exhibitionRaceIds = [],
  skipOddsRefresh = false,
}) {
  return new Set([
    ...infoRaceIds,
    ...(skipOddsRefresh ? [] : oddsRaceIds),
    ...exhibitionRaceIds,
  ]);
}

/**
 * 展示の取得（scrape-exhibition-data.js の run の戻り値）を受けて、変更を書いたレースの予測を再計算する
 * （api/cron/exhibition.js から、waitUntil の中で呼ぶ）。
 *
 *   - REFRESH_ON_VERCEL が on でなければ、何もしない（現行動作）
 *   - 変更を書いたレースが無い（未公開・変更なし）なら、再計算しない
 *   - 再計算の失敗は、投げずに結果に error として返す（展示データの取得・保存は済んでいるため、
 *     その成否と混同しない。失敗は関数ログに残す）
 *
 * @param {Object} params
 * @param {{changedRaceIds?: string[]}|null|undefined} params.result 展示取得の戻り値
 * @param {string} params.date 対象日（YYYY-MM-DD）
 * @param {(args: Object) => Promise<unknown>} params.refresh mainRefresh（遅延 import で渡す）
 * @param {Record<string, string|undefined>} [params.env]
 * @param {Pick<Console, "log"|"error">} [params.logger]
 * @returns {Promise<{refreshed: boolean, reason?: string, raceIds?: string[], error?: string}>}
 */
export async function refreshAfterExhibition({
  result,
  date,
  refresh,
  env = process.env,
  logger = console,
}) {
  if (!isRefreshOnVercelEnabled(env)) {
    return {
      refreshed: false,
      reason: "REFRESH_ON_VERCEL が有効ではありません",
    };
  }
  const raceIds = [...new Set(result?.changedRaceIds ?? [])];
  if (raceIds.length === 0) {
    return { refreshed: false, reason: "変更を書いたレースがありません" };
  }
  try {
    logger.log(`🤖 予測の再計算（Vercel）: ${raceIds.length}レース`);
    await refresh({
      isDryRun: false,
      specificRaceIds: raceIds,
      date,
      // 削除→挿入の交差・挿入失敗による「予測が空」を作らない。再計算のきっかけが展示の変更のみのため、
      // 失敗した再計算は次の再計算で自己修復されない
      writeMode: "upsert",
    });
    return { refreshed: true, raceIds };
  } catch (error) {
    logger.error("❌ 予測の再計算エラー（展示データは保存済み）:", error);
    return {
      refreshed: false,
      raceIds,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
