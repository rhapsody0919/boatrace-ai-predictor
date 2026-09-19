/**
 * Vercel Deploy Hook を叩くかどうかの判定（BOA-361）。
 *
 * 予測の再計算（mainRefresh）は約5分ごとに走り、従来は毎回Deploy Hookを叩いていたため、
 * 本番が約6分間隔で再デプロイされていた。ここでは「時刻」と「実際にDBへ書いた件数」だけで
 * 頻度を抑える。GitHub Actionsのジョブには永続的な状態を置けないため、
 * 「前回いつ叩いたか」を持たない、状態なしの方式にしている。
 *
 *   (a) 判定時刻（mainRefreshの書き込み完了時点）が毎時の先頭
 *       DEPLOY_HOOK_WINDOW_MINUTES 分間にあるときだけ叩く。実行は直列に走り、
 *       終了時刻の間隔がおおむね5分以上あるため、1時間に概ね1回に収まる
 *       （窓に終了が入る実行が無い時間帯は0回、詰まって連続した場合は2回になりうる）。
 *   (c) 実際に更新したレースが0件なら叩かない。
 *
 * 分は「UTC」で判定する。JSTはUTC+9（ちょうど9時間）なので、分の値はJSTと一致し、
 * 実行環境のタイムゾーン設定（TZ）に依存しない。
 */
export const DEPLOY_HOOK_WINDOW_MINUTES = 5;

/**
 * @param {Object} params
 * @param {string|undefined} params.hookUrl VERCEL_DEPLOY_HOOK（未設定なら叩かない）
 * @param {Date} params.now 判定時刻
 * @param {number} params.changedRaceCount 今回の実行で実際に更新した races の行数
 *   （predictions は毎回全件を入れ替えるため変更の有無を区別できず、代わりにこれを使う）
 * @returns {{ trigger: boolean, reason: string }}
 */
export function decideDeployHook({ hookUrl, now, changedRaceCount }) {
  if (!hookUrl) {
    return { trigger: false, reason: "VERCEL_DEPLOY_HOOK 未設定" };
  }
  if (!(changedRaceCount > 0)) {
    return { trigger: false, reason: "更新したレースが0件" };
  }
  const minute = now.getUTCMinutes();
  if (minute >= DEPLOY_HOOK_WINDOW_MINUTES) {
    return {
      trigger: false,
      reason: `毎時0〜${DEPLOY_HOOK_WINDOW_MINUTES - 1}分の実行のみ対象（現在${minute}分）`,
    };
  }
  return { trigger: true, reason: "" };
}
