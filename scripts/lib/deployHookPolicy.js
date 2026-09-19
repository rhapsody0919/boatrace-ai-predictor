/**
 * Vercel Deploy Hook を叩くかどうかの判定（BOA-361）。
 *
 * 予測の再計算（mainRefresh）は約5分ごとに走り、従来は毎回Deploy Hookを叩いていたため、
 * 本番が約6分間隔で再デプロイされていた。ここでは「時刻」と「実際にDBへ書いた件数」だけで
 * 頻度を抑える。GitHub Actionsのジョブには永続的な状態を置けないため、
 * 「前回いつ叩いたか」を持たない、状態なしの方式にしている。
 *
 *   (a) 毎時の先頭 DEPLOY_HOOK_WINDOW_MINUTES 分間の実行でしか叩かない。
 *       実行間隔が5分以上なら、1時間に高々1回（GitHub Actionsの遅延で実行が
 *       詰まった場合のみ2回になりうる）。
 *   (c) 実際に更新したレースが0件なら叩かない。
 *
 * 分は「UTC」で判定する。JSTはUTC+9（ちょうど9時間）なので、分の値はJSTと一致し、
 * 実行環境のタイムゾーン設定（TZ）に依存しない。
 */
export const DEPLOY_HOOK_WINDOW_MINUTES = 5;

/**
 * @param {Object} params
 * @param {string|undefined} params.hookUrl VERCEL_DEPLOY_HOOK（未設定なら叩かない）
 * @param {Date} params.now 現在時刻
 * @param {number} params.changedRaceCount 今回の実行で実際に更新したレース数
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
