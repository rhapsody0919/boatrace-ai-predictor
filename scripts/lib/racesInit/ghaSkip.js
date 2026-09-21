/**
 * GitHub Actions 側の朝の初期化（morning-init.js）を止める変数 SKIP_MORNING_INIT_ON_GHA の判定（純粋関数）。
 *
 * 静的に止めるだけだと、Vercel の races-init が失敗した日に、誰も初期化しない（全ての窓型ジョブは races の
 * start_time を前提にするため、その日の取得が全て止まる。plan.md F1・cutover-fast-track.md §6）。そこで、
 * 変数が true でも、フェイルセーフとして、JST 07:00 になっても当日の races が1件も無ければ、従来どおり初期化する
 * （Vercel は 05:00 に始め、24会場でも約15分で終わるため、07:00 は十分な余裕。最悪でも、従来と同じ時刻＝07:00過ぎの初期化）。
 *
 *   変数が true でない            → 従来どおり実行する（何も変わらない）
 *   true・JST 07:00 より前        → 実行しない（Vercel の races-init の時間帯。DBは読まない）
 *   true・07:00 以降・races が1件以上 → 実行しない（Vercel が初期化済み。取りこぼし会場の確認・予測の再生成・unified も
 *                                    Vercel 側が担う）
 *   true・07:00 以降・races が0件      → 実行する（フェイルセーフ。この場合の pcexpect は、SKIP_PCEXPECT_ON_GHA に従う）
 *   true・07:00 以降・races の件数を確認できない（DB未設定・読み取り失敗） → 実行する（確認できないときは、止めない側に倒す）
 */

/** フェイルセーフが働き始める、JSTの時刻（時） */
export const FALLBACK_FROM_JST_HOUR = 7;

/**
 * @param {Object} params
 * @param {boolean} params.skipVar SKIP_MORNING_INIT_ON_GHA が true か
 * @param {number} params.jstHour 現在のJSTの時（0〜23）
 * @param {number|null} params.racesCount 当日の races の件数。確認していない・できない場合は null
 * @returns {{run: boolean, reason: string}}
 */
export function decideMorningInitOnGha({ skipVar, jstHour, racesCount }) {
  if (!skipVar) return { run: true, reason: "skip_var_off" };
  if (jstHour < FALLBACK_FROM_JST_HOUR) {
    return { run: false, reason: "vercel_window" };
  }
  if (racesCount === null || racesCount === undefined) {
    return { run: true, reason: "fallback_races_unknown" };
  }
  if (racesCount > 0) return { run: false, reason: "vercel_initialized" };
  return { run: true, reason: "fallback_no_races" };
}
