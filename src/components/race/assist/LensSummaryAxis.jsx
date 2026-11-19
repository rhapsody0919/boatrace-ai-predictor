import BaseBar from "./BaseBar";
import ClassLineup from "./ClassLineup";
import Fold from "./Fold";
import { classLineup, restClassCounts } from "../../../utils/assistModel";
import {
  axisWhyKinds,
  b1Usual,
  factsEntry,
  factsScopeLabel,
} from "../../../utils/assistSummary";
import { ASSIST_COPY as C } from "../../../data/thinkingAssistCopy";
import { TermButton, TheoryButton } from "./SheetButtons";
import { comma, p1 } from "./lensSummaryFormat";

/** 軸の箱: 級の並びの注記（同じ級の並びのレースの件数） */
function AxisClassNote({ counts, classes, scope, venue }) {
  if (!counts) return null;
  return (
    <p className="ta-note">
      {C.classNote(1, classes[0], counts, factsScopeLabel(scope, venue))}
      <TermButton
        term={
          scope.kind === "VC" && venue
            ? C.scopeVenue(venue)
            : "全国・級の並びが同じ"
        }
      />
    </p>
  );
}

/** 軸の箱: 上の枠と数字が違う理由の1行 */
function AxisWhyLine({ headerInCaution, headerScope, scope, u }) {
  const hc = headerScope?.cell;
  return (
    <>
      {/* 上の枠と数字が違う理由は畳まずに出す（同じ「1号艇の1着」が 58% と 54.6% に見える。デザイナーのレビュー P1-3） */}
      {/* BOA-822: 上の枠の1着が注意度の裏返しのときは、集め方の違いをそのまま書く（返還の違いの行は同じ集め方のときだけ） */}
      {headerInCaution && (
        <p className="ta-note ta-num" data-testid="axis-why-in-caution">
          {C.whyHeaderInCaution(headerInCaution.n, headerInCaution.round)}
        </p>
      )}
      {!headerInCaution && hc && headerScope.kind === scope.kind && (
        <p className="ta-note ta-num">
          {C.whyRefund(
            comma(u.n),
            p1(u.k, u.n),
            comma(hc.n),
            p1(hc.b1_win, hc.n),
          )}
        </p>
      )}
    </>
  );
}

/** 軸の箱: 数え方の違いの理由を畳んだ中身 */
function AxisWhyFold({ why, headerInCaution, venue, va, vaCell, scope }) {
  if (why.length === 0) return null;
  return (
    // 上の枠の1着が注意度の裏返しのときは、違う理由を上の1行に書いたので、畳んだ中は数え方の話だけ（#1604 ファン評価2周目 P2）
    <Fold title={headerInCaution ? C.whyToggleCount : C.whyToggle}>
      <ul className="ta-list">
        {why.includes("venueScope") && !headerInCaution && (
          <li>{C.whyVenueScope(venue)}</li>
        )}
        {why.includes("venueRefund") && (
          <li className="ta-num">
            {C.whyVenueRefund(
              venue,
              comma(va.n),
              p1(va.k, va.n),
              comma(vaCell.n),
              p1(vaCell.b1_win, vaCell.n),
            )}
          </li>
        )}
        {why.includes("fellBack") && (
          <li className="ta-num">{C.whyFellBack(venue, scope.vcCount)}</li>
        )}
      </ul>
    </Fold>
  );
}

/** 軸の箱: 深掘り（1号艇）への入口1行 */
function AxisFactsEntry({ entry, onFacts }) {
  if (!entry) return null;
  return (
    // 差がつく材料は深掘り（1号艇）の1か所に出し、ここは入口1行だけ（2026-10-11 ユーザー決定 案D）。
    // ▲が無い日は深掘りの「全部の材料」を開いて渡す
    <button
      type="button"
      className="ta-facts-entry"
      onClick={() => onFacts(entry.hits === 0)}
    >
      <span>
        <b>
          {entry.hits > 0 ? C.factsEntry(1, entry.hits) : C.factsEntryNone(1)}
        </b>
        {entry.hits > 0 && (
          <span className="ta-facts-entry-names">
            {C.factsEntryNames(
              entry.keys.map((k) => C.factNames[k]),
              entry.rest,
            )}
          </span>
        )}
      </span>
      <span aria-hidden="true">›</span>
    </button>
  );
}

export function AxisSummary({ m }) {
  const {
    scope,
    chips,
    venue,
    headerScope,
    headerInCaution = null,
    vaFacts,
    vaCell,
    classes,
    onFacts,
  } = m;
  // 軸は1着だけ（2着以内・3着以内は相手レンズ。spec D-46）
  const u = b1Usual(scope, 1);
  const entry = factsEntry(chips);
  if (!u) return null;
  const va = vaFacts ? b1Usual({ facts: vaFacts }) : null;
  const why = axisWhyKinds({
    kind: scope.kind,
    fellBack: scope.fellBack,
    venue,
    win: true,
    venueRefund: Boolean(va && vaCell?.n > 0),
  });
  const label = factsScopeLabel(scope, venue, 1, classes?.[0]);
  const counts = restClassCounts(classes, 1);
  return (
    <>
      <section className="ta-box" data-guide="axis">
        <h3 className="ta-h3-row">
          {C.axisHeading(1)}
          {venue && (
            <TheoryButton id="TC-V1" name={C.theoryVenueTitle(venue)} />
          )}
        </h3>
        {/* 大きい数字の横に件数の札。同じ範囲の棒は出さず、比べる相手（会場の全レース）の棒だけ（2026-10-09 ユーザー決定 B） */}
        <div className="ta-big">
          <span className="ta-big-pct ta-num">{p1(u.k, u.n)}%</span>
          <span className="ta-big-cnt ta-num">{C.races(u.k, u.n)}</span>
          <span className="ta-scopechip ta-num">{C.scopeChip(label, u.n)}</span>
        </div>
        <ClassLineup lineup={classLineup(classes, 1)} />
        <AxisClassNote
          counts={counts}
          classes={classes}
          scope={scope}
          venue={venue}
        />
        {va && venue && (
          <BaseBar label={C.venueAllN(venue, va.n)} k={va.k} n={va.n} />
        )}
        <AxisWhyLine
          headerInCaution={headerInCaution}
          headerScope={headerScope}
          scope={scope}
          u={u}
        />
        <AxisWhyFold
          why={why}
          headerInCaution={headerInCaution}
          venue={venue}
          va={va}
          vaCell={vaCell}
          scope={scope}
        />
        <AxisFactsEntry entry={entry} onFacts={onFacts} />
      </section>
    </>
  );
}
