/**
 * RateWithBaseline - 実績と会場平均の比較バー（BOA-402、screens.md C-4）
 *
 * 逃げ／まくり／逃がしの3セクションで使い回す。
 *
 * ## 画面に出すのは集計した事実だけ（2026-09-24、ユーザー指摘で改訂）
 *
 * 当初は「本日の会場での見込み」（= 本日の会場・級別の平均 + 会場構成で補正した差分、
 * ADR-0071）を大きく出していたが、**これは計算で作った推定値であり、事実ではない**。
 * 予想を提示している体裁になるため、カードからは外した。出すのは次の3つの集計値だけ。
 *
 *   - この選手の実績率（全国。その選手が走った全会場ぶん）      … `rate` / `sampleSize`
 *   - 本日の会場・級別の平均（全選手）                          … `venueBaseline`
 *   - その選手が走ってきた会場・級別の平均（展開時のみ）        … `rate - skillDelta`
 *
 * 会場によって逃げ率は20.3pt、グレードによって11.1pt開くため、実績率だけを並べると
 * 「戸田での70%」と「尼崎での70%」が同じに見える（ADR-0071）。本日の会場の平均を
 * 隣に並べることで、**読み手が自分で差を見て取れる**ようにするのが狙い。
 * 補正した差分（`skill_delta`）自体は、逃がしの抽出条件と注目レースの並び替えという
 * 内部処理には引き続き使う。表示だけを事実に寄せる。
 *
 * ## 専門用語を使わない（2026-09-24、ユーザー指摘で改訂）
 *
 * ボートレースファンに通じない語を3つ使っていた。
 *   - **「本日の級別」**: `venue_course_technique_baseline.race_grade` は
 *     SG/G1/G2/G3/ippan という**レースのグレード**で、A1/A2/B1/B2 の級別ではない。
 *     さらにグレードのセルが100走未満のときは `ALL`（全グレード）へフォールバックする
 *     （実測で110行中31行＝28.2%）。「本日の級別」は二重に誤り。実際に使ったセルを
 *     `detail.baselineGrade` に保存し、そのまま表示する
 *   - **「信頼下限」**: 統計の語。「控えめに見て」に言い換える
 *   - **「◯◯率」だけの見出し**: 何を分母に何を数えた率か分からない。
 *     「1コースに入ったときに逃げ切った割合」のように文で書く。
 *     とくに**「勝率」という語は使えない**（ボートレースの勝率は着順点の平均であって
 *     1着率ではないため、意味がまったく変わる）
 *
 * ## 対象範囲はバーのラベルに書く
 *
 * 「逃げ率88.2%」と「この選手90.1%」が何故違うのか分からない、という指摘を受けた。
 * 原因はどちらも「率」としか書いておらず、対象範囲（全国なのか、この会場なのか）が
 * 示されていないことだった。当初はバーの下に注記行
 * （`この選手＝全国38走ぶん／若松の平均＝全選手`）を置いたが冗長だったため、
 * **ラベル自体に `この選手（全国38走）` `若松の平均（一般戦）` と書き、注記行を無くした**。
 * ラベルが長くなるので、ラベルと値を1行目、バーを2行目に置いて**バーを全幅**にしている
 * （横に並べるとラベルに幅を取られてバーが短くなり、長さの比較ができなくなる）。
 *
 * ## 母数は折りたたんでも隠さない
 *
 * 34走の88%と9走の88%は別物で、母数の見えない率は信用度を判断できない。
 * 畳むのは確からしさの下限（Wilson95%下限、plan.md §2.3.1）・直近90日・
 * 走ってきた会場の平均だけ。
 */
import "./RateWithBaseline.css";

/** 0〜100%の横バー1本。ラベル＋値が1行目、バーが2行目（バーを全幅で使うため） */
function RateBar({ label, value, emphasis = false }) {
  const pct = Math.max(0, Math.min(100, Number(value)));
  return (
    <div className="rate-baseline__bar-row">
      <span className="rate-baseline__bar-head">
        <span className="rate-baseline__bar-label">{label}</span>
        <span
          className={`rate-baseline__bar-value${emphasis ? " rate-baseline__bar-value--emphasis" : ""}`}
        >
          {pct.toFixed(1)}%
        </span>
      </span>
      <span className="rate-baseline__bar-track">
        <span
          className={`rate-baseline__bar-fill${emphasis ? " rate-baseline__bar-fill--emphasis" : ""}`}
          style={{ width: `${pct}%` }}
        />
      </span>
    </div>
  );
}

/** venue_course_technique_baseline.race_grade の表示名 */
const BASELINE_GRADE_LABEL = {
  ALL: "全グレード",
  ippan: "一般戦",
  SG: "SG",
  G1: "G1",
  G2: "G2",
  G3: "G3",
};

function RateWithBaseline({
  label,
  rate,
  skillDelta = null,
  venueName,
  sampleSize,
  isSmallSample = false,
  wilsonLower = null,
  rate90d = null,
  sampleSize90d = null,
  venueBaseline = null,
  baselineGrade = null,
  expanded = true,
}) {
  // 過去に書き込んだ行には detail.baselineGrade が無い。その場合はグレードを書かない
  const gradeLabel = BASELINE_GRADE_LABEL[baselineGrade] ?? null;
  // その選手が走ってきた会場・級別の平均。差分ではなく水準そのものを出す
  const ownVenueMix =
    skillDelta === null || skillDelta === undefined
      ? null
      : Number(rate) - Number(skillDelta);

  return (
    <div className="rate-baseline">
      <p className="rate-baseline__label">{label}</p>

      <div className="rate-baseline__bars">
        {/* 対象範囲はラベルに書く。別行の注記にすると冗長になる */}
        <RateBar
          label={`この選手（全国${sampleSize}走）`}
          value={rate}
          emphasis
        />
        {venueBaseline !== null && (
          <RateBar
            label={`${venueName}の平均${gradeLabel ? `（${gradeLabel}）` : ""}`}
            value={venueBaseline}
          />
        )}
      </div>

      {isSmallSample && (
        <p className="rate-baseline__source">
          <span className="rate-baseline__small-sample">
            ⚠ 母数が少なく振れ幅が大きい
          </span>
        </p>
      )}

      {expanded && (
        <div className="rate-baseline__meta">
          {ownVenueMix !== null && (
            <span
              title="この選手が実際に走った会場・レースグレードの構成で、全選手を平均した割合。この選手の割合と見比べると、走ってきた条件が楽だったかどうかが分かる"
              className="rate-baseline__wilson"
            >
              この選手が走ってきた会場の平均 {ownVenueMix.toFixed(1)}%
            </span>
          )}
          {wilsonLower !== null && (
            <span
              title="母数が少ないほど割合は振れる。この母数なら、95%の確からしさで最低でもこの値はある、という下限（Wilson信頼区間の下限）"
              className="rate-baseline__wilson"
            >
              控えめに見て {Number(wilsonLower).toFixed(1)}%
            </span>
          )}
          {sampleSize90d !== null &&
            (rate90d !== null ? (
              <span>
                直近90日 <strong>{Number(rate90d).toFixed(1)}%</strong>（
                {sampleSize90d}走）
              </span>
            ) : (
              <span>
                直近90日 {sampleSize90d}走（母数が少なく率は出しません）
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

export default RateWithBaseline;
