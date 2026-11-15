/**
 * RaceMeetTab 比較表の右（PC）／下の注記の段落。人数・準優の目安・対象外の内訳・凡例・出典。
 * 値は RaceMeetTabModel の `buildMeetModel` の結果（m）で受け取る。
 */
import { mdOf } from "./RaceMeetTabTrendModel";

// 順位の対象外の内訳で名前を出す上限（超えた分は「ほか◯人」、BOA-697）
const EXCLUDED_LIST_MAX = 6;

// **Ｗ優勝戦の節**は1つの節に独立した2つの勝ち上がりが同居する
// （全期間で6節）。何も言わずに人数が半分になると「なぜ減ったのか」に
// なるので、節全体の人数と併せて断る。準優の目安が出ていない日は
// その語に触れない。両方の選手が乗るレース（予選終了後の消化レース。
// 実データでは多摩川に5本）では分けられないので、そちらも断る（BOA-511）。
// 人数の行より先に置く。後ろにあると「24人」が先に来て、表の見出し
// 「前検（48人中）」と食い違って見えた（BOA-714）。準優の目安の段落よりも
// 先に置く。後ろにあると「準優の目安は12位」が、母数（24人）の説明より先に
// 出て、見出しの48人の中の12位と読めた（BOA-722 ファン評価1周目）
function SeriesNote({ m }) {
  const { t, board, seriesSplit, showBorderBadge, meetTotal, rankedOnly } = m;
  if (!board?.isSplitMeet) return null;
  return (
    <p className="rmt-series-note">
      {seriesSplit
        ? t(
            showBorderBadge
              ? "meetTab.seriesSplitNote"
              : "meetTab.seriesSplitNoteNoBorder",
            { meetTotal },
          )
        : t("meetTab.seriesMixedNote", { total: rankedOnly.length })}
    </p>
  );
}

// 準優の目安（表の点線の意味）は表のすぐ下に置く。対象外の一覧の後ろに
// あると、点線を見てから意味が読めるまで4段落離れた（BOA-722）。Ｗ優勝戦の節
// では、母数を断る注記の次に置く
function BorderNote({ m }) {
  const { t, sp, slots, border, medianRuns, seriesSplit } = m;
  const { showBorderBadge, borderPendingShown, tableHasInBorder } = m;
  if (!(showBorderBadge || borderPendingShown)) return null;
  return (
    <p className="rmt-border-note">
      {/* 何走時点の目安かを断る。2日目の朝の目安は、予選終了時の目安と
          平均0.46点ずれる（BOA-690 の実測。数値は画面に出さない） */}
      {showBorderBadge &&
        [
          t("meetTab.borderLine", { slots, rate: border.toFixed(2) }),
          // 点線は目安内の最後の艇の行の下に引くので、表の6艇に目安内が
          // 1艇もいないと点線が無い。そのときに「点線より上が…」と書くと、
          // 無い線を探させた（BOA-756、PR #1234 ファン評価3周目）
          t(
            tableHasInBorder
              ? "meetTab.borderNote"
              : "meetTab.borderNoneInTable",
          ),
          t("meetTab.borderAsOfRuns", { runs: medianRuns }),
        ].join(sp)}
      {/* まだ全員が走っていない間は目安を出さない理由を書く（BOA-690）。
          Ｗ優勝戦では「出場選手」が24人か48人か読めないので書き分ける */}
      {borderPendingShown &&
        t(
          seriesSplit
            ? "meetTab.borderPendingSeries"
            : "meetTab.borderPending",
        )}
    </p>
  );
}

// 人数の行の文言（節の出場・順位の対象・除く人数・まだ走っていない人数）
function countLineText(m) {
  const { t, ranking, rankedOnly, absentOnly, notYetStarted } = m;
  const { seriesSplit, entrantCount } = m;
  // 全部の走が欠場の選手も順位の対象外。数えないと「47人（対象42人・
  // 4人を除く）」と足し算が合わない（BOA-660）
  const excluded = ranking.length - rankedOnly.length + absentOnly.length;
  // まだ1走もしていない選手も順位にまだ入らない。書かないと初日に
  // 「48人（対象44人・1人を除く）」と合わなかった（BOA-690）
  // 全員がまだ走っていない（初日の1R等）なら「順位の対象は0人」と書かない。
  // 初戦を欠場した選手がいれば「全員が初戦」は誤りなので、従来の書き方に戻す
  if (rankedOnly.length === 0 && excluded === 0 && notYetStarted > 0)
    return t(`meetTab.compareSub${seriesSplit ? "Series" : ""}AllNotYet`, {
      all: entrantCount,
    });
  const variant =
    excluded > 0 && notYetStarted > 0
      ? "ExcludedNotYet"
      : excluded > 0
        ? "Excluded"
        : notYetStarted > 0
          ? "NotYet"
          : "";
  return t(`meetTab.compareSub${seriesSplit ? "Series" : ""}${variant}`, {
    all: entrantCount,
    total: variant ? rankedOnly.length : entrantCount,
    excluded,
    notYet: notYetStarted,
  });
}

// 理由ごとに名前を並べる。EXCLUDED_LIST_MAX 人を越えたぶんは畳む
function excludedParts(t, excludedGroups) {
  let budget = EXCLUDED_LIST_MAX;
  const parts = [];
  for (const g of excludedGroups) {
    if (budget <= 0) break;
    const shown = g.names.slice(0, budget);
    budget -= shown.length;
    parts.push(
      <span key={g.reason}>
        {parts.length > 0 && t("meetTab.excludedGroupSeparator")}
        {t(`meetTab.excludedReason_${g.reason}`)}
        {t("meetTab.excludedReasonSuffix")}
        {/* 名前の途中で改行しない（375pxで「北川／幸典」と切れた。BOA-714 ファン評価） */}
        {shown.map((name, i) => (
          <span key={name}>
            {i > 0 && t("meetTab.listSeparator")}
            <span className="rmt-excluded-name" translate="no">
              {name}
            </span>
          </span>
        ))}
      </span>,
    );
  }
  return parts;
}

// 順位の対象外の内訳（BOA-697）。人数だけでは誰が外れたか分からず、予選の後に
// 順位が動いた理由も読めなかった。公式の備考欄に近い形で名前を理由ごとに出す。
// 7人以上は6人まで出して「ほか◯人」と畳む（行が長くなりすぎないように）。
// 理由を名前の前に置き、表のセルと同じ書き方（賞典除外（今節F））にそろえる。
// 名前の後ろに括弧で付けると括弧が入れ子になった（BOA-714）
function ExcludedList({ m }) {
  const { t, excludedGroups } = m;
  if (excludedGroups.length === 0) return null;
  const total = excludedGroups.reduce((n, g) => n + g.names.length, 0);
  return (
    <p className="rmt-excluded-list">
      <strong>{t("meetTab.excludedListLabel")}</strong>
      {excludedParts(t, excludedGroups)}
      {total > EXCLUDED_LIST_MAX &&
        t("meetTab.excludedMore", { count: total - EXCLUDED_LIST_MAX })}
    </p>
  );
}

// 金枠の凡例は対象外の一覧の後ろに置く。人数の行に付けると、人数が金枠の説明の
// 後ろに来て探しにくかった（BOA-722）
function BestLegend({ m }) {
  const { t, sp, showBestLegend, showSmallSampleLegend } = m;
  if (!showBestLegend) return null;
  return (
    <p className="rmt-table-notes">
      {/* 金枠の意味（PR #1187 ファン評価1周目: 説明がどこにも無かった） */}
      {/* ⚠の艇に金枠を付けない断りは、表に⚠があるときだけ。⚠の説明を表に⚠が
          あるときだけ出すようにしたので、⚠が無いと何の記号か書いた文が無いまま
          凡例だけが⚠に触れた（BOA-746） */}
      {showBestLegend &&
        (showSmallSampleLegend
          ? [t("meetTab.bestLegend"), t("meetTab.bestLegendWarn")].join(sp)
          : t("meetTab.bestLegend"))}
    </p>
  );
}

// 公式の順位表は52名中3名（賞典除外1・途中帰郷2）を順位から外す。
// 当社は全員で順位を振るため下位ほどズレる（2026-09-27に若松G1で
// 実測: 得点率は6/6一致、順位は最大4つ差）。除外の判定材料が
// 自社データに無いので、合わせにいかずに違いを書く
function RankSourceNote({ m }) {
  const { t, sp, board, usesOfficialScore, prelimOver } = m;
  return (
    <p className="rmt-rank-note">
      {/* 公式の備考で外すのは予選の後だけで、そのときは得点率も公式の値になる
          （rankSourceNoteOfficial）。それ以外は当社の推定（PR #1149 ファン評価2周目） */}
      {t(
        usesOfficialScore
          ? "meetTab.rankSourceNoteOfficial"
          : "meetTab.rankSourceNote",
      )}
      {/* 予選中は公式の前夜の減点・途中帰郷を足している（BOA-782）。得点率が
          自社の着順点の合計と合わない理由と、その値の時点を書く */}
      {!usesOfficialScore && board?.officialPrelimAsOf && (
        <>
          {sp}
          {t("meetTab.rankSourceNotePrelimOfficial", {
            date: mdOf(board.officialPrelimAsOf),
          })}
        </>
      )}
      {/* 予選の後の扱い（Fは外さない・帰郷は外す）は、予選が終わってから
          関係する話なので、予選中は出さない（注記が長くなるだけだった） */}
      {!usesOfficialScore && prelimOver && (
        <>
          {sp}
          {t("meetTab.rankSourceNoteAfterPrelim")}
        </>
      )}
    </p>
  );
}

export default function RaceMeetTabCompareSide({ m }) {
  const { t, showSmallSampleLegend, hasMarkNotes, markNotes, sp } = m;
  return (
    <div className="race-split__side">
      <p className="rmt-hint">{t("meetTab.rowHint")}</p>
      {/* ⚠の意味は表のすぐ下に出す。予選序盤は6艇すべてに⚠が付き、説明が表の下
          4段落目では「この記号は何か」を探すことになった（BOA-738、ファン評価2周続けて） */}
      {showSmallSampleLegend && (
        <p className="rmt-hint">{t("meetTab.smallSampleLegend")}</p>
      )}
      <SeriesNote m={m} />
      <BorderNote m={m} />
      <p className="rmt-sub">
        {/* 賞典除外・途中帰郷の選手も節は走っているので、「出場」から外さない。
            順位の対象の人数と分けて書く（ファン評価2周目: 出場50人なのに
            前検51位の選手がいた） */}
        {/* Ｗ優勝戦で分けたときは「節の出場」と書かない。下の注記の
            「節全体は◯人」と食い違って読める（BOA-660） */}
        {countLineText(m)}
      </p>
      <ExcludedList m={m} />
      <BestLegend m={m} />
      {/* 表の印（予選後F・欠場・今節初戦・欠）の説明は金枠の凡例と段落を分ける。
          1段落に混ざると「予選後F」を探す人が金枠の文から読むことになった（BOA-738） */}
      {hasMarkNotes && <p className="rmt-mark-notes">{markNotes.join(sp)}</p>}
      <RankSourceNote m={m} />
      <p className="rmt-source">{t("basicInfo.meetPretestSource")}</p>
    </div>
  );
}
