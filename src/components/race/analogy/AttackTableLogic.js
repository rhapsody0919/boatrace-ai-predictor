import { rankBand } from "../../../utils/analogyScenario";

const rate = (o) => (o && o[1] ? o[0] / o[1] : null);
// 今日の区分の行が出るか（順位が分からない・区分の値が無いときは出ない。区切り線だけ残さないため。レビュー指摘）
const hasToday = (rank, by) => {
  const band = rank ? rankBand(rank) : null;
  return Boolean(band && by?.[band]);
};

/** すぐ外の艇の1着は、攻める艇の値をその艇の範囲で出しているときだけ外の艇の範囲の値にする */
function outerWinPair({ att, A, F, all, boats, slit }) {
  if (!att || att >= 6) return null;
  if (A !== F) return boats?.[att + 1]?.data?.winner?.[slit] ?? null;
  return [all.winner[att], all.n];
}

/** 重なりの最大（形, 率）。無ければ null */
function topOverlap(overlap) {
  return overlap
    ? Object.entries(overlap)
        .map(([f, v]) => [f, rate(v) ?? 0])
        .sort((a, b) => b[1] - a[1])[0]
    : null;
}

/** 攻める艇の値（BOA-806）: その艇の級をそろえた範囲があればそちら。無ければ1号艇の範囲の値 */
function attackerValues({ F, R, att, boats, slit }) {
  const own = att ? boats?.[att] : null;
  const A = own?.data?.attack?.[slit] ?? F;
  const AR = own?.data?.attack?.[slit]
    ? (own.reference?.attack?.[slit] ?? null)
    : R;
  return { A, AR };
}

/** 派生の値（攻める艇の値 A・比べる値 AR・すぐ外の艇の1着・勝ち手・重なり）を作る純関数 */
function deriveAttack({ attack, refAttack, slit, boats }) {
  const F = attack[slit];
  const R = refAttack?.[slit] ?? null;
  const att = F.attacker;
  const { A, AR } = attackerValues({ F, R, att, boats, slit });
  const all = A.all;
  const outerPair = outerWinPair({ att, A, F, all, boats, slit });
  const techs = ["makuri", "makurizashi", "sashi"].filter(
    (n) => all[`att_${n}_of_win`]?.[0] > 0,
  );
  const ov = topOverlap(F.overlap);
  return {
    F,
    R,
    att,
    A,
    AR,
    all,
    outerPair,
    scopeBoat: A !== F ? att : 1,
    techs,
    wins: all.att_win?.[0] ?? 0,
    ov,
  };
}

export { rate, hasToday, deriveAttack };
