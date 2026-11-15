import { useEffect, useId, useRef, useState } from "react";
import BoatBadge from "../BoatBadge";
import { BOAT_LINE_COLORS } from "../../../utils/colors";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";
import { METRICS } from "../../../utils/assistModel";
import { TheoryButton } from "./SheetButtons";
import TargetSwitch from "./TargetSwitch";

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

/** 平均ST の切り替え（BOA-815 案A）。展示後も横軸は平均ST（spec D-47 (1)） */
function BasisSwitch({ model, onBasis }) {
  return (
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
  );
}

function BoardAxis({ model, bet }) {
  return (
    <div className="ta-board-axis" aria-hidden="true">
      <span>
        {model.good === "left" && (
          <span className="ta-good">◀ {ASSIST_COPY.good}</span>
        )}
        {model.left}
      </span>
      <span className={`ta-board-title${bet ? " is-bet" : ""}`}>
        {model.title}
      </span>
      <span>
        {model.right}
        {model.good === "right" && (
          <span className="ta-good">{ASSIST_COPY.good} ▶</span>
        )}
      </span>
    </div>
  );
}

function BoardHead({
  model,
  bet,
  oddsNote,
  onBasis,
  onMetric,
  target,
  onTarget,
}) {
  return (
    <>
      {model.basis && onBasis && (
        <BasisSwitch model={model} onBasis={onBasis} />
      )}
      {model.exhCompare && (
        <button
          type="button"
          className="ta-exh-open"
          onClick={() => onMetric("exh_st", null)}
        >
          {ASSIST_COPY.exhStOpen} ›
        </button>
      )}
      {/* 着順の切り替えと注記はオッズの見出しより上に置く。見出しと点の間に挟むと、点の位置まで着順で変わったように見える
          （BOA-831 ファン評価 1周目 指摘4） */}
      {bet && onTarget && <TargetSwitch target={target} onTarget={onTarget} />}
      {bet && <p className="ta-note">{ASSIST_COPY.pastWinNote(target)}</p>}
      {model.kind === "place" && (
        <p className="ta-note">{ASSIST_COPY.placeNote}</p>
      )}
      <BoardAxis model={model} bet={bet} />
      {model.noOdds && <p className="ta-note">{oddsNote}</p>}
    </>
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

function BoardNotes({ model, bet, legUnusedNote, onBack }) {
  return (
    <>
      {bet && legUnusedNote && <p className="ta-note">{legUnusedNote}</p>}
      {bet && model.missingFirst?.length > 0 && (
        <p className="ta-note">
          {ASSIST_COPY.boardMissingFirst(model.missingFirst)}
        </p>
      )}
      {model.basis === "course" && (
        <p className="ta-note">{ASSIST_COPY.flowCourseNote}</p>
      )}
      {model.noSt && <p className="ta-note">{ASSIST_COPY.stNoData}</p>}
      {model.kind === "metric" && (
        <button type="button" className="ta-back" onClick={onBack}>
          × {model.back ?? ASSIST_COPY.backToFigure}
        </button>
      )}
    </>
  );
}

/** 6艇比較に変わったら図の見出しまで送る。深掘りの中の値を押したときは図が画面の上に外れているため（screens「2段目は図の見出しまで送る」、BOA-808 1） */
function useScrollOnCompare(model) {
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
  return ref;
}

/**
 * レースの図（FR-3、案②レーン）。行＝1〜6号艇（艇の丸・苗字・級）、横軸はレンズで変わる。
 * 艇の行を押すと深掘り、数字を押すと6艇比較（2段目、「図を戻す」で戻る）。
 * 買い目レンズでは行ごとに「1着・2着・3着」の候補。ほかのレンズでは右端の「+」でその行に同じ候補のボタンを出す
 * （開くのは1行だけ。spec D-43・BOA-801 7。マークシートは固定の買い目から開く）。
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
  onBasis = null,
  marks = null,
  target = 1,
  onTarget = null,
  legs = 3,
  ordered = true,
  legUnusedNote = null,
}) {
  const bet = model.kind === "bet";
  // 「+」で候補のボタンを開いている行（開くのは1行だけ。レンズが替わったら閉じる。BOA-801 7）
  // レンズの種類と組で持ち、レンズが替わったら開いていないのと同じにする（effect で閉じない）
  const [pick, setPick] = useState(null);
  const pickRow = pick?.kind === model.kind ? pick.boat : null;
  const ref = useScrollOnCompare(model);
  const lane = { model, racers, deep, bets, onDeep, onMetric, onToggleBet };
  return (
    <figure
      ref={ref}
      className="ta-board"
      aria-label={ASSIST_COPY.figure(lensLabel)}
      data-guide="board"
    >
      <BoardHead
        model={model}
        bet={bet}
        oddsNote={oddsNote}
        onBasis={onBasis}
        onMetric={onMetric}
        target={target}
        onTarget={onTarget}
      />
      {model.rows.map((row) => (
        <LaneRow
          key={row.boat}
          row={row}
          bet={bet}
          pickRow={pickRow}
          setPick={setPick}
          marks={marks}
          ordered={ordered}
          legs={legs}
          {...lane}
        />
      ))}
      <BoardNotes
        model={model}
        bet={bet}
        legUnusedNote={legUnusedNote}
        onBack={onBack}
      />
    </figure>
  );
}
