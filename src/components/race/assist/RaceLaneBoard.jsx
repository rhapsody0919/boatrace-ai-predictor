import { useEffect, useId, useRef } from "react";
import BoatBadge from "../BoatBadge";
import { BOAT_LINE_COLORS } from "../../../utils/colors";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";
import { METRICS } from "../../../utils/assistModel";
import { TheoryButton } from "./SheetButtons";

const scale = (model, x) =>
  Math.max(0, Math.min(100, ((x - model.lo) / (model.hi - model.lo)) * 100));

/** 図の数字1個（押すと6艇比較、D-32）。最良は金枠と視覚的に隠した「（6艇で一番）」（FR-3a） */
function NumButton({ num, boat, onMetric }) {
  const best = num.best ? " ind-best" : "";
  const descId = useId();
  if (!num.metric)
    return (
      // 押せない値（1着人気・過去の1着）はボタンの見た目にしない（ファン評価 PR4 1周目 指摘6）
      <span className="ta-num-static">
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

function Track({ model, row, onMetric }) {
  if (row.x == null)
    return (
      <div className="ta-track" aria-hidden="true">
        <span className="ta-track-rail" style={{ opacity: 0.4 }} />
        {model.kind !== "bet" && !row.pending && (
          <span className="ta-track-empty">{ASSIST_COPY.noRecord}</span>
        )}
      </div>
    );
  const x = scale(model, row.x);
  const color = BOAT_LINE_COLORS[row.boat];
  // 端の値（目盛りの外に詰めた値を含む）は文字を内側へ寄せ、右の印や図の外にはみ出させない（ファン評価 3周目 指摘12）
  const valClass = `ta-track-val ta-num${row.dotBest ? " ind-best" : ""}${row.flying ? " ta-track-val-f" : ""}${x > 85 ? " ta-track-val-end" : x < 15 ? " ta-track-val-start" : ""}`;
  const def = row.dotMetric ? METRICS[row.dotMetric] : null;
  return (
    <div
      className={`ta-track${model.good ? ` ta-track-good-${model.good}` : ""}`}
    >
      <span className="ta-track-rail" aria-hidden="true" />
      <span
        className="ta-track-bar"
        aria-hidden="true"
        style={{ width: `${x}%`, background: color }}
      />
      <span
        className={`ta-track-dot${row.flying ? " ta-track-dot-f" : ""}`}
        aria-hidden="true"
        style={{ left: `${x}%`, background: row.flying ? undefined : color }}
      />
      {row.dotText &&
        (def ? (
          // 点の値は押すと6艇比較（ファン評価で PR4 に回した「スタートの値の数字ボタン」）
          <button
            type="button"
            className={`${valClass} ta-track-val-btn`}
            style={{ left: `${x}%` }}
            aria-label={ASSIST_COPY.compareAria(def.label, row.dotAria)}
            onClick={() => onMetric(row.dotMetric, row.boat)}
          >
            {row.dotText}
          </button>
        ) : (
          <span
            className={valClass}
            style={{ left: `${x}%` }}
            aria-hidden="true"
          >
            {row.dotText}
          </span>
        ))}
    </div>
  );
}

/**
 * レースの図（FR-3、案②レーン）。行＝1〜6号艇（艇の丸・苗字・級）、横軸はレンズで変わる。
 * 艇の行を押すと深掘り、数字を押すと6艇比較（2段目、「図を戻す」で戻る）。
 * 買い目レンズでは行ごとに「1着・2着・3着」の候補、ほかのレンズでは右端の印からマークシートを開く（screens S-1 C）。
 * 欠場の艇には候補のボタンを出さない（D-38）。
 * marks はレンズごとの印（良い方の札・凹みの手がかり・攻め手・展示の偏り・チルト・交換。assistSummary から作る）。
 * 印と F は押すとセオリーカード（ファン評価 PR4 で2回出た「押せない」の解消）
 */
export default function RaceLaneBoard({
  model,
  lensLabel,
  oddsNote,
  racers,
  deep,
  bets,
  onDeep,
  onMetric,
  onBack,
  onToggleBet,
  onOpenSheet,
  onBasis = null,
  marks = null,
}) {
  const bet = model.kind === "bet";
  // 6艇比較に変わったら図の見出しまで送る。深掘りの中の値を押したときは図が画面の上に外れているため（screens「2段目は図の見出しまで送る」、BOA-808 1）
  const ref = useRef(null);
  const compare = model.kind === "metric" ? model.title : null;
  useEffect(() => {
    if (!compare) return;
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    )?.matches;
    ref.current?.scrollIntoView?.({
      block: "start",
      behavior: reduce ? "auto" : "smooth",
    });
  }, [compare]);
  return (
    <figure
      ref={ref}
      className="ta-board"
      aria-label={ASSIST_COPY.figure(lensLabel)}
      data-guide="board"
    >
      {model.basis && onBasis && (
        // 展示前の平均ST の切り替え（BOA-815 案A）。展示の後は横軸が展示ST になるので出さない
        <div className="ta-basis">
          <span>{ASSIST_COPY.stBasisGroup}</span>
          <span
            className="ta-seg"
            role="group"
            aria-label={ASSIST_COPY.stBasisGroup}
          >
            {["course", "overall"].map((b) => (
              <button
                key={b}
                type="button"
                aria-pressed={model.basis === b}
                onClick={() => onBasis(b)}
              >
                {ASSIST_COPY.stBasis[b]}
              </button>
            ))}
          </span>
        </div>
      )}
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
      {model.noOdds && <p className="ta-note">{oddsNote}</p>}
      {bet && <p className="ta-note">{ASSIST_COPY.pastWinNote}</p>}
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
              <Track model={model} row={row} onMetric={onMetric} />
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
                {row.filled && (
                  <span className="ta-tag">{ASSIST_COPY.stFilled}</span>
                )}
                {!r.absent &&
                  r.fCount > 0 &&
                  (model.kind === "axis" || model.kind === "flow") && (
                    <TheoryButton
                      id="TC-T4"
                      name={ASSIST_COPY.markName(`F${r.fCount}`, row.boat)}
                      boat={row.boat}
                      className="ta-th-lane"
                    >
                      <span className="ta-tag ta-tag-warn">F{r.fCount} ›</span>
                    </TheoryButton>
                  )}
                {!r.absent &&
                  (marks?.get(row.boat) ?? []).map((m) => (
                    <TheoryButton
                      key={m.text}
                      id={m.theory}
                      name={ASSIST_COPY.markName(m.text, row.boat)}
                      boat={row.boat}
                      className="ta-th-lane"
                    >
                      <span className={`ta-tag${m.hit ? " ta-tag-hit" : ""}`}>
                        {m.text} ›
                      </span>
                    </TheoryButton>
                  ))}
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
                {positions.length ? `${positions.join("-")}着` : "+"}
              </button>
            ) : (
              <span />
            )}
          </div>
        );
      })}
      {model.basis === "course" && (
        <p className="ta-note">{ASSIST_COPY.flowCourseNote}</p>
      )}
      {model.noSt && <p className="ta-note">{ASSIST_COPY.stNoData}</p>}
      {model.kind === "metric" && (
        <button type="button" className="ta-back" onClick={onBack}>
          × {ASSIST_COPY.backToFigure}
        </button>
      )}
    </figure>
  );
}
