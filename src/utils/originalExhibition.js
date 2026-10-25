/**
 * オリジナル展示（BOATCAST、race_original_exhibition・_values）の行を画面の形にする（純関数）。
 *
 * `supabaseDataService.getRaceOriginalExhibition`（画面は直前情報タブ RaceBeforeInfoTab.jsx・
 * raceIndicators.jsx）の整形を手を加えずに移した（2026-10-25 hq 依頼、FT01。全貌動画の材料と同じ値にするため）。
 * 権限エラー（forbidden）の判定は取得側に残す。
 */

/**
 * オリジナル展示の項目の既定の並び（BOATCASTのTSVの並びに合わせる）。
 * 会場ごとに項目数が違うため、実際の並びは `item_labels` を正とする
 */
export const ORIGINAL_EXHIBITION_KINDS = [
  "一周",
  "半周ラップ",
  "まわり足",
  "直線",
];

/**
 * @param {{item_labels?: string|null, updated_at?: string|null}|null} header race_original_exhibition の行
 * @param {Array<{boat_number: number, kind: string, value: number|string|null}>} values race_original_exhibition_values の行
 * @returns {{state: "published"|"empty", capturedAt: string|null, kinds: string[],
 *   byBoat: Record<number, Record<string, number>>, fetchFailed?: true}}
 *   empty は値が1つも無い（まだ計測されていない・全艇欠測）。fetchFailed を付けて withCache に保存させない
 */
export function shapeOriginalExhibition(header, values) {
  // `value` は nullable で、欠測（BOATCASTのファイルの `--.--`。津・三国の
  // 一周など。091のコメント）は NULL で入る。**値がある行だけ**を数えて
  // 「出せるかどうか」を決める。行数だけで見ると、全艇が欠測の項目まで
  // 出典に名前が並んだり、1行も出ないのに出典ブロックだけ残ったりする
  const measured = (values ?? []).filter(
    (row) => row.value !== null && row.value !== undefined,
  );
  if (measured.length === 0) {
    // まだ計測されていない（または全艇欠測）。発走の30分前あたりに値が
    // 入るので、この状態をキャッシュすると出た後もリロードまで出ない
    return {
      state: "empty",
      capturedAt: null,
      kinds: [],
      byBoat: {},
      fetchFailed: true,
    };
  }

  const byBoat = {};
  measured.forEach((row) => {
    byBoat[row.boat_number] = {
      ...(byBoat[row.boat_number] ?? {}),
      [row.kind]: Number(row.value),
    };
  });

  // 会場によって項目が違う（例: 住之江・尼崎・徳山は「一周|まわり足」の2項目だけ）。
  // ヘッダの item_labels（"一周|まわり足|直線"）を正として順番を決め、
  // 実際に値がある種別だけ残す。ヘッダが無ければ既定の順に落とす
  const present = new Set(measured.map((row) => row.kind));
  const declared = (header?.item_labels ?? "")
    .split("|")
    .map((label) => label.trim())
    .filter(Boolean);
  const order = declared.length > 0 ? declared : ORIGINAL_EXHIBITION_KINDS;
  const kinds = order.filter((kind) => present.has(kind));

  return {
    state: "published",
    capturedAt: header?.updated_at ?? null,
    kinds,
    byBoat,
  };
}
