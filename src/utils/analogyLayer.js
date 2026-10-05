/**
 * 類似レースの層（そろえる条件）の説明文（BOA-271 spec B-3 の前半。plan「層の説明文の共用の関数」）。
 * BOA-635（予想の過去発生率チェック）と共用する。文言は aiPredictionTab.analogy.layer.*（4言語）。
 *
 * 例（count あり）: 「今日と同じ『G1以上の優勝戦』で、1号艇の級別・1号艇と勝率トップの差・勝率トップの艇番が
 * そろう過去レース7,286件」。ラウンド・グレードでそろえない日は「今日と同じく、…そろう過去レース7,286件」。
 * count なしは「…そろう過去レース」まで。
 *
 * @param {{round: "yusho"|"junyu"|null, grade_g1plus: boolean}} conditions layer・similar の conditions
 * @param {(key: string, opts?: object) => string} t i18n
 * @param {{count?: number}} [opts]
 */
export function describeAnalogyLayer(conditions, t, { count } = {}) {
  const k = "aiPredictionTab.analogy.layer";
  const kind = layerKind(conditions, t);
  const races =
    count === undefined || count === null
      ? t(`${k}.races`)
      : t(`${k}.racesCount`, { count: Number(count).toLocaleString("ja-JP") });
  return kind
    ? t(`${k}.withKind`, { kind, races })
    : t(`${k}.plain`, { races });
}

/**
 * そろえる条件のうちレースの種類（「G1以上の優勝戦」「優勝戦」「G1以上」）。予選などは null
 * @param {{round: "yusho"|"junyu"|null, grade_g1plus: boolean}} conditions
 */
export function layerKind(conditions, t) {
  const k = "aiPredictionTab.analogy.layer";
  const round = conditions?.round
    ? t(`aiPredictionTab.analogy.rounds.${conditions.round}`)
    : null;
  const grade = conditions?.grade_g1plus ? t(`${k}.g1plus`) : null;
  return round && grade
    ? t(`${k}.gradeRound`, { grade, round })
    : (round ?? grade ?? null);
}
