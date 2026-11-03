import "./RacerFrontTaking.css";

/**
 * 選手ページの前付けの説明（2026-11-03 オーナー承認のモック docs/design/inya-racer/mock/）。
 * 進入コース別成績の直上に1か所。札（イン屋）のある選手・無い選手・30走未満の4つの形。
 * 文言は wording-editor の確定案（docs/design/inya-racer/fan-panel.md）。判定は src/utils/frontTaking.js
 *
 * @param {{ result: ReturnType<typeof import("../../utils/frontTaking.js").computeFrontTaking> | null | undefined }} props
 *   undefined は取得中（高さを取っておく）、null は取得の失敗（何も出さない）
 */
export const FRONT_TAKING_ANCHOR = "racer-front-taking";

const slash = (ymd) => ymd.replaceAll("-", "/");

export default function RacerFrontTaking({ result }) {
  if (result === null) return null;
  if (result === undefined) {
    return (
      <div
        className="racer-front-taking racer-front-taking--loading"
        aria-hidden="true"
      />
    );
  }
  const { from, to, fullYear, n, k, rate, status } = result;
  const range = fullYear
    ? `直近1年（${slash(from)}〜${slash(to)}）`
    : `${slash(from)}〜${slash(to)}`;
  const pct = rate === null ? null : Math.round(rate * 100);
  const isInya = status === "inya";

  return (
    <div
      id={FRONT_TAKING_ANCHOR}
      tabIndex={-1}
      className={`racer-front-taking${isInya ? " racer-front-taking--inya" : ""}`}
      data-testid="racer-front-taking"
      data-status={status}
    >
      <h3>{isInya ? "イン屋（前付け）" : "4〜6号艇での進入（前付け）"}</h3>
      {isInya && (
        <p>
          4〜6号艇で出ても、前付け（枠より内のコースに入ること）で1〜3コースを取りに行く選手です。「イン屋」はファンの呼び名で、公式の用語ではありません。
        </p>
      )}
      {status === "insufficient" ? (
        <p>
          {n === 0
            ? `${range}に4〜6号艇で出た走はありません。`
            : `${range}の4〜6号艇の走は${n}走のため、前付けの割合は出していません（30走以上で表示します）。`}
        </p>
      ) : k === 0 ? (
        <p className="racer-front-taking-value">
          {range}、4〜6号艇で出た{n}
          走中、1〜3コースに入った走はありませんでした。
        </p>
      ) : (
        <>
          <p className="racer-front-taking-value">
            {range}、4〜6号艇で出た{n}走中{" "}
            <b>
              {k}走（{pct}%）
            </b>{" "}
            で1〜3コースに入りました。
          </p>
          <span className="racer-front-taking-meter" aria-hidden="true">
            <span style={{ width: `${pct}%` }} />
          </span>
        </>
      )}
      {status !== "insufficient" && (
        <p className="racer-front-taking-note">
          {isInya ? "当日も前付けするとは限りません。" : ""}
          当サイト集計。
          {isInya
            ? "4〜6号艇の走が30以上で、1〜3コースに入った割合が高い選手に付けています。"
            : ""}
        </p>
      )}
    </div>
  );
}
