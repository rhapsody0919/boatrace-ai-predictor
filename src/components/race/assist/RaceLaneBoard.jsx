import { useId } from "react";
import BoatBadge from "../BoatBadge";
import { BOAT_LINE_COLORS } from "../../../utils/colors";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

const scale = (model, x) =>
  Math.max(0, Math.min(100, ((x - model.lo) / (model.hi - model.lo)) * 100));

/** 図の数字1個（押すと6艇比較、D-32）。最良は金枠と視覚的に隠した「（6艇で一番）」（FR-3a） */
function NumButton({ num, boat, onMetric }) {
  const best = num.best ? " ind-best" : "";
  const descId = useId();
  if (!num.metric)
    return (
      <span className="ta-num-btn">
        {num.short} <b className="ta-num">{num.text}</b>
      </span>
    );
  return (
    <button
      type="button"
      className={`ta-num-btn${best}`}
      aria-label={ASSIST_COPY.compareAria(num.label, num.aria)}
      aria-describedby={num.best ? descId : undefined}
      onClick={() => onMetric(num.metric, boat)}
    >
      {num.short} <b className="ta-num">{num.text}</b>
      {/* 金枠を色だけに頼らない（screens「操作できる要素の名前」）。名前は「{項目名} {値}、6艇で比べる」のまま、説明で読む */}
      {num.best && (
        <span className="ta-sr" id={descId}>
          {num.aria}
          {ASSIST_COPY.bestHidden}
        </span>
      )}
    </button>
  );
}

function Track({ model, row }) {
  if (row.x == null)
    return (
      <div className="ta-track" aria-hidden="true">
        <span className="ta-track-rail" style={{ opacity: 0.4 }} />
        {model.kind !== "bet" && (
          <span className="ta-track-empty">{ASSIST_COPY.noRecord}</span>
        )}
      </div>
    );
  const x = scale(model, row.x);
  const color = BOAT_LINE_COLORS[row.boat];
  return (
    <div
      className={`ta-track${model.good ? ` ta-track-good-${model.good}` : ""}`}
      aria-hidden="true"
    >
      <span className="ta-track-rail" />
      <span
        className="ta-track-bar"
        style={{ width: `${x}%`, background: color }}
      />
      <span
        className="ta-track-dot"
        style={{ left: `${x}%`, background: color }}
      />
      {row.dotText && (
        <span
          className={`ta-track-val ta-num${row.dotBest ? " ind-best" : ""}`}
          style={{ left: `${x}%` }}
        >
          {row.dotText}
        </span>
      )}
    </div>
  );
}

/**
 * レースの図（FR-3、案②レーン）。行＝1〜6号艇（艇の丸・苗字・級）、横軸はレンズで変わる。
 * 艇の行を押すと深掘り、数字を押すと6艇比較（2段目、「図を戻す」で戻る）。
 * 買い目レンズでは行ごとに「1着・2着・3着」の候補、ほかのレンズでは右端の印からマークシートを開く（screens S-1 C）。
 * 欠場の艇には候補のボタンを出さない（D-38）
 */
export default function RaceLaneBoard({
  model,
  lensLabel,
  racers,
  deep,
  bets,
  onDeep,
  onMetric,
  onBack,
  onToggleBet,
  onOpenSheet,
}) {
  const bet = model.kind === "bet";
  return (
    <figure className="ta-board" aria-label={ASSIST_COPY.figure(lensLabel)}>
      <div className="ta-board-axis" aria-hidden="true">
        <span>
          {model.good === "left" && (
            <span className="ta-good">◀ {ASSIST_COPY.good}</span>
          )}
          {model.left}
        </span>
        <span className="ta-board-title">{model.title}</span>
        <span>
          {model.right}
          {model.good === "right" && (
            <span className="ta-good">{ASSIST_COPY.good} ▶</span>
          )}
        </span>
      </div>
      {model.noOdds && <p className="ta-note">{ASSIST_COPY.oddsNone}</p>}
      {model.rows.map((row) => {
        const r = racers[row.boat - 1];
        const positions = [1, 2, 3].filter((k) => bets[k].has(row.boat));
        return (
          <div
            key={row.boat}
            className={`ta-lane${deep && deep !== row.boat ? " ta-lane-faded" : ""}`}
          >
            <button
              type="button"
              className="ta-boat-btn"
              aria-label={`${row.boat}号艇 ${r.surname || r.name}`.trim()}
              aria-current={deep === row.boat ? "true" : undefined}
              onClick={() => onDeep(row.boat)}
            >
              <BoatBadge n={row.boat} size="sm" />
              <span className="ta-boat-name" translate="no">
                {r.surname}
              </span>
              <span className="ta-boat-cls">{r.cls ?? ""}</span>
            </button>
            <div>
              <Track model={model} row={row} />
              <div className="ta-lane-marks">
                {row.nums.map((num) => (
                  <NumButton
                    key={num.label}
                    num={num}
                    boat={row.boat}
                    onMetric={onMetric}
                  />
                ))}
                {r.absent && (
                  <span className="ta-tag ta-tag-warn">
                    {ASSIST_COPY.absent}
                  </span>
                )}
                {!r.absent && r.fCount > 0 && model.kind === "axis" && (
                  <span className="ta-tag ta-tag-warn">F{r.fCount}</span>
                )}
              </div>
              {bet && !r.absent && (
                <div
                  className="ta-pos3"
                  role="group"
                  aria-label={`${row.boat}号艇の候補`}
                >
                  {[1, 2, 3].map((k) => (
                    <button
                      key={k}
                      type="button"
                      aria-label={ASSIST_COPY.candidateAria(row.boat, k)}
                      aria-pressed={bets[k].has(row.boat)}
                      onClick={() => onToggleBet(k, row.boat)}
                    >
                      {ASSIST_COPY.candidateLabel(k)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {!bet && !r.absent ? (
              <button
                type="button"
                className={`ta-add${positions.length ? " ta-add-on" : ""}`}
                aria-label={ASSIST_COPY.markAria(row.boat, positions)}
                onClick={onOpenSheet}
              >
                {positions.length ? `${positions.join("·")}着` : "+"}
              </button>
            ) : (
              <span />
            )}
          </div>
        );
      })}
      {model.kind === "metric" && (
        <button type="button" className="ta-back" onClick={onBack}>
          × {ASSIST_COPY.backToFigure}
        </button>
      )}
    </figure>
  );
}
