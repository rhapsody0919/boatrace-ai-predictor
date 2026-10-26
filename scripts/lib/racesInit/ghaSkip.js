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
 *   true・07:00 以降・races の件数を確認できない（DB未設定・読み取り失敗） → 下の肩代わりの判定へ
 *
 * 上の「実行する」（フェイルセーフ）は、さらに GitHub の肩代わりの条件（scripts/lib/ghaSkipGate.js の races_init。
 * mode=live・Vercel の races-init が指定時刻以降に起動していない・boatrace.jp のブレーカーが閉じている・直近の失敗が
 * 403・接続の失敗でない）を満たすときだけ実行する。races_init が公式の 403・接続の失敗で止まった日に、GitHub の IP から
 * 守りを通らない素の fetch（同時12）で公式を叩かない（docs/design/scraping-load-budget/spec.md §0・§8 の P0）。
 * 肩代わりの判定を確かめられない（gateSkip が true 以外）ときも実行しない。
 */

/** フェイルセーフが働き始める、JSTの時刻（時） */
export const FALLBACK_FROM_JST_HOUR = 7;

/**
 * @param {Object} params
 * @param {boolean} params.skipVar SKIP_MORNING_INIT_ON_GHA が true か
 * @param {number} params.jstHour 現在のJSTの時（0〜23）
 * @param {number|null} params.racesCount 当日の races の件数。確認していない・できない場合は null
 * @param {boolean} [params.gateSkip] 肩代わりの判定（shouldSkipOnGha の skip）。false のときだけフェイルセーフを実行する
 * @returns {{run: boolean, reason: string, needsGate: boolean}}
 *   needsGate: フェイルセーフの候補で、肩代わりの判定（gateSkip）がまだ渡されていない
 */
export function decideMorningInitOnGha({
  skipVar,
  jstHour,
  racesCount,
  gateSkip,
}) {
  if (!skipVar) return { run: true, reason: "skip_var_off", needsGate: false };
  if (jstHour < FALLBACK_FROM_JST_HOUR) {
    return { run: false, reason: "vercel_window", needsGate: false };
  }
  if (racesCount > 0) {
    return { run: false, reason: "vercel_initialized", needsGate: false };
  }
  const fallback =
    racesCount === null || racesCount === undefined
      ? "fallback_races_unknown"
      : "fallback_no_races";
  if (gateSkip === false)
    return { run: true, reason: fallback, needsGate: false };
  return {
    run: false,
    reason: `${fallback}_no_takeover`,
    needsGate: gateSkip === undefined,
  };
}
