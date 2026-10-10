/**
 * 思考アシスト（BOA-430）の GA4 のイベント。画面の操作（reducer の action）と押す前の状態から、送るイベントを決める純関数。
 * 定義と GA4 の登録は docs/design/thinking-assist/events.md。パラメータ名に GA4 の予約語（source・id 等）を使わない
 *
 * - 状態が変わらない操作（選択中のレンズの押し直し、開いている艇の押し直し＝閉じる、比較中の項目の押し直し）は送らない
 * - ガイドは段を出したとき（1段目＝1）。閉じたときは送らない
 * - シートは開いたとき。種類は mark・rough・venue・term・theory
 * - 軸の要約の入口1行（openFacts、2026-10-11 案D）から深掘りを開いたときも assist_deep_open。開いている艇の押し直しは送らない
 * @param {{lens: string, deep: number|null, metric: string|null}} state 押す前の状態
 * @param {{type: string, [key: string]: unknown}} action
 * @returns {{name: string, params: Record<string, string|number>} | null}
 */
export function assistEventOf(state, action) {
  switch (action.type) {
    case "lens":
      return action.lens === state.lens
        ? null
        : {
            name: "assist_lens_select",
            params: { assist_lens: action.lens },
          };
    case "deep":
    case "openFacts":
      return action.boat === state.deep
        ? null
        : {
            name: "assist_deep_open",
            params: { assist_boat: action.boat, assist_lens: state.lens },
          };
    case "metric":
      return action.metric === state.metric
        ? null
        : {
            name: "assist_metric_compare",
            params: { assist_metric: action.metric, assist_lens: state.lens },
          };
    case "guide":
      return action.step == null
        ? null
        : {
            name: "assist_guide_step",
            params: { assist_guide_step: action.step + 1 },
          };
    case "sheet":
      return action.sheet == null
        ? null
        : {
            name: "assist_sheet_open",
            params: {
              assist_sheet:
                typeof action.sheet === "string"
                  ? action.sheet
                  : action.sheet.type,
            },
          };
    default:
      return null;
  }
}
