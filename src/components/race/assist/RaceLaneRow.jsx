import { useId } from "react";
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
      <span className={`ta-num-static${num.muted ? " ta-num-muted" : ""}`}>
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

function TrackEmpty({ model, row }) {
  return (
    <div className="ta-track" aria-hidden="true">
      <span className="ta-track-rail" style={{ opacity: 0.4 }} />
      {model.kind !== "bet" && !row.pending && (
        <span className="ta-track-empty">{ASSIST_COPY.noRecord}</span>
      )}
    </div>
  );
}

/** 相手レンズ（spec D-46）: ○3着以内を2つ目の点で置き、●2着以内との間を線でつなぐ */
function TrackSecondDot({ model, row, x, color }) {
  return (
    <>
      <span
        className="ta-track-span"
        aria-hidden="true"
        style={{
          left: `${x}%`,
          width: `${Math.max(0, scale(model, row.x2) - x)}%`,
          background: color,
        }}
      />
      <span
        className="ta-track-dot ta-track-dot-o"
        aria-hidden="true"
        style={{ left: `${scale(model, row.x2)}%`, borderColor: color }}
      />
    </>
  );
}

function TrackValue({ row, x, def, onMetric }) {
  // 端の値（目盛りの外に詰めた値を含む）は文字を内側へ寄せ、右の印や図の外にはみ出させない（ファン評価 3周目 指摘12）
  const valClass = `ta-track-val ta-num${row.dotBest ? " ind-best" : ""}${row.flying ? " ta-track-val-f" : ""}${x > 85 ? " ta-track-val-end" : x < 15 ? " ta-track-val-start" : ""}`;
  return def ? (
    // 点の値は押すと6艇比較（ファン評価で PR4 に回した「スタートの値の数字ボタン」）
    <button
      type="button"
      className={`${valClass} ta-track-val-btn`}
      style={{ left: `${x}%` }}
      aria-label={
        row.dotLabel ?? ASSIST_COPY.compareAria(def.label, row.dotAria)
      }
      onClick={() => onMetric(row.dotMetric, row.boat)}
    >
      {row.dotText}
    </button>
  ) : (
    <span className={valClass} style={{ left: `${x}%` }} aria-hidden="true">
      {row.dotText}
    </span>
  );
}

function Track({ model, row, onMetric }) {
  if (row.x == null) return <TrackEmpty model={model} row={row} />;
  const x = scale(model, row.x);
  const color = BOAT_LINE_COLORS[row.boat];
  const def = row.dotMetric ? METRICS[row.dotMetric] : null;
  return (
    <div
      className={`ta-track${model.good ? ` ta-track-good-${model.good}` : ""}`}
    >
      <span className="ta-track-rail" aria-hidden="true" />
      {/* 棒（長さ）は「長いほど良い」図だけ（軸の全国勝率など、良いが右）。左ほど良い図（展開の ST・機力の
          展示タイムの差）と買い目（オッズ）は点だけにし、長さに意味を持たせない（BOA-801 3、2026-10-10 ユーザー決定） */}
      {model.good === "right" && (
        <span
          className="ta-track-bar"
          aria-hidden="true"
          style={{ width: `${x}%`, background: color }}
        />
      )}
      <span
        className={`ta-track-dot${row.flying ? " ta-track-dot-f" : ""}`}
        aria-hidden="true"
        style={{ left: `${x}%`, background: row.flying ? undefined : color }}
      />
      {row.x2 != null && (
        <TrackSecondDot model={model} row={row} x={x} color={color} />
      )}
      {row.dotText && (
        <TrackValue row={row} x={x} def={def} onMetric={onMetric} />
      )}
    </div>
  );
}

function BoatButton({ row, r, deep, onDeep }) {
  return (
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
  );
}

function LaneMarks({ model, row, r, marks, onMetric }) {
  return (
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
        <span className="ta-tag ta-tag-warn">{ASSIST_COPY.absent}</span>
      )}
      {row.exhRank != null && (
        // 展示後の展示タイムの6艇の順位（spec D-47 (2)）。数字は点の上の値とこの札の2個まで
        <span className="ta-tag ta-tag-exh ta-num">
          {ASSIST_COPY.exhRankTag(row.exhRank)}
        </span>
      )}
      {row.filled && <span className="ta-tag">{ASSIST_COPY.stFilled}</span>}
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
  );
}

function PosPicker({ row, bet, ordered, legs, bets, onToggleBet }) {
  return (
    <div className="ta-pos3" role="group" aria-label={`${row.boat}号艇の候補`}>
      {/* 連複は札の近くに「順不同」（1着の数字の横で「1艇目＝1着」と読まれないように。BOA-990 ② ファン評価1周目 P2-2） */}
      {bet && !ordered && (
        <span className="ta-pos3-cap">{ASSIST_COPY.unorderedMark}</span>
      )}
      {[1, 2, 3].map((k) => (
        <button
          key={k}
          type="button"
          className={bet && k > legs ? "is-unused" : undefined}
          disabled={bet && k > legs}
          aria-label={ASSIST_COPY.candidateAria(row.boat, k, !bet || ordered)}
          aria-pressed={bets[k].has(row.boat)}
          onClick={() => onToggleBet(k, row.boat)}
        >
          {ASSIST_COPY.candidateLabel(k, !bet || ordered)}
        </button>
      ))}
    </div>
  );
}

function AddButton({ model, row, positions, pickRow, setPick }) {
  return (
    <button
      type="button"
      className={`ta-add${positions.length ? " ta-add-on" : ""}`}
      aria-label={ASSIST_COPY.markAria(row.boat, positions)}
      aria-expanded={pickRow === row.boat}
      onClick={() =>
        setPick(
          pickRow === row.boat ? null : { kind: model.kind, boat: row.boat },
        )
      }
    >
      {positions.length ? `${positions.join("-")}着` : "+"}
    </button>
  );
}

function LaneRow({ row, bet, pickRow, setPick, ...p }) {
  const { model, racers, deep, bets, onDeep, onMetric, onToggleBet } = p;
  const r = racers[row.boat - 1];
  const positions = [1, 2, 3].filter((k) => bets[k].has(row.boat));
  return (
    <div
      className={`ta-lane${deep && deep !== row.boat ? " ta-lane-faded" : ""}`}
    >
      <BoatButton row={row} r={r} deep={deep} onDeep={onDeep} />
      <div>
        <Track model={model} row={row} onMetric={onMetric} />
        <LaneMarks
          model={model}
          row={row}
          r={r}
          marks={p.marks}
          onMetric={onMetric}
        />
        {(bet || pickRow === row.boat) && !r.absent && (
          <PosPicker
            row={row}
            bet={bet}
            ordered={p.ordered}
            legs={p.legs}
            bets={bets}
            onToggleBet={onToggleBet}
          />
        )}
      </div>
      {!bet && !r.absent ? (
        <AddButton
          model={model}
          row={row}
          positions={positions}
          pickRow={pickRow}
          setPick={setPick}
        />
      ) : (
        <span />
      )}
    </div>
  );
}

export default LaneRow;
