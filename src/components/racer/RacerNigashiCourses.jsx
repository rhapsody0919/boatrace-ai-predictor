/**
 * 選手ページの「1コースの艇に逃げで1着を取られた走（進入コース別）」（逃し率、オーナー 2026-11-25）。
 * 絞り込みの枠の中に置き、絞り込み（会場・枠番・グレード・レース種別・進入コース）が効く履歴（vc.vcHistory）から数える。
 * 選手ごとの値は信頼性が低く予測にも効かないので、k/n と率の記録だけを出し、強調・並べ替えはしない。
 * 事実の記録なので「結果を保証しない」の断りは付けない（オーナー 2026-11-25）。
 */
import { useEffect, useState } from "react";
import {
  nationalNigashiBaseline,
  nigashiByCourse,
} from "../../pure/nigashiStats.js";
import { getNigashiBaselineRows } from "../../services/venueQueries3.js";

const slash = (date) => (date ? date.replaceAll("-", "/") : date);

/** 全国の基準（2コースの行。定義上2〜6コースのどれも会場の逃げ率と同じ値）。undefined＝取得中、null＝失敗 */
function useNationalBaseline() {
  const [state, setState] = useState(undefined);
  useEffect(() => {
    let cancelled = false;
    getNigashiBaselineRows(2)
      .then((rows) => {
        if (!cancelled)
          setState(nationalNigashiBaseline(rows) ?? { empty: true });
      })
      .catch((error) => {
        console.error("逃し率の全国の基準の取得に失敗:", error);
        if (!cancelled) setState(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

function BaselineNote({ baseline }) {
  if (baseline === undefined || baseline?.empty) return null;
  if (baseline === null)
    return (
      <p className="racer-stat-note" role="alert">
        全国の値を読み込めませんでした。
      </p>
    );
  return (
    <p className="racer-stat-note">
      全国では、{slash(baseline.from)}〜{slash(baseline.to)}
      のどのコースの走でも{baseline.pct}%で1コースの艇が逃げています。
    </p>
  );
}

export default function RacerNigashiCourses({ history }) {
  const baseline = useNationalBaseline();
  const { rows, from, to } = nigashiByCourse(history);
  if (rows.length === 0) return null;
  return (
    <div className="racer-nigashi" data-testid="racer-nigashi">
      <h3>1コースの艇に逃げで1着を取られた走（進入コース別）</h3>
      <p className="racer-stat-note">
        2〜6コースに入った走のうち、1コースの艇に逃げで1着を取られた走。主に2コースで見る値です（当社データ{" "}
        {slash(from)}〜{slash(to)}。上の絞り込み条件が効きます）
      </p>
      <dl className="racer-nigashi-rows">
        {rows.map((r) => (
          <div key={r.course} className="racer-nigashi-row">
            <dt>{r.course}コース</dt>
            <dd>
              {r.n}走中{r.count}走<small>（{r.pct}%）</small>
            </dd>
          </div>
        ))}
      </dl>
      <BaselineNote baseline={baseline} />
      <p className="racer-stat-note">
        ※この走数では、率は偶然で大きく動きます。コースごとの違いを選手の特徴とは読めません。
      </p>
    </div>
  );
}
