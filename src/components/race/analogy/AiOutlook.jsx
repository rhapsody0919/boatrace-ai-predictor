import { useTranslation } from "react-i18next";
import NoteList from "./NoteList";
import useAnalogyContribution from "../../../hooks/useAnalogyContribution";
import { SCOPE_LINE } from "./analogyColors";
import { fmtDate } from "../../../utils/analogyFormat";
import { directionText, to100 } from "../../../utils/analogyOutlook";
import { roundToTotal } from "../../../utils/analogyContribution";

const k = "aiPredictionTab.analogy.outlook";

/** 外側の details と summary（どの状態でも同じ殻） */
function OutlookShell({ children }) {
  const { t } = useTranslation();
  return (
    <details className="af-details af-ai">
      <summary>{t(`${k}.summary`)}</summary>
      {children}
    </details>
  );
}

function OutlookError({ retry }) {
  const { t } = useTranslation();
  return (
    <>
      <p className="af-warn">{t("aiPredictionTab.analogy.states.error")}</p>
      <button type="button" className="af-btn" onClick={retry}>
        {t("aiPredictionTab.analogy.states.retry")}
      </button>
    </>
  );
}

function OutlookLoading() {
  const { t } = useTranslation();
  return (
    <p className="af-sub">{t("aiPredictionTab.analogy.states.loading")}</p>
  );
}

/** 項目の割合はテーマの中での比で、テーマの % に合計をそろえる（内訳の share とテーマの割合は分母が
 *  違うので、そのままだと合わない。学習側の回答 2026-10-06、旧 ContributionBreakdown と同じ） */
function groupsWithPct(row, key, themePct) {
  const groups = row.breakdown?.[key] ?? [];
  const gp = roundToTotal(
    groups.map((g) => g.share),
    themePct,
  );
  return groups.map((g, gi) => ({ ...g, pct: gp[gi] }));
}

function OutlookItem({ g, boat }) {
  const { t } = useTranslation();
  const dir = directionText(g.key, g.direction, t);
  const name =
    g.key === "national" && boat === 1
      ? t(`${k}.groups.nationalBoat1`)
      : t(`${k}.groups.${g.key}`, g.key);
  return (
    <div className="af-ai-item">
      <span>{name}</span>
      <span className="af-num">{g.pct}%</span>
      {dir && (
        <span className="af-ai-dir">
          {dir}
          {g.key === "wind" && t(`${k}.windNote`)}
        </span>
      )}
    </div>
  );
}

function OutlookTheme({ th, row, boat, share, max, pct }) {
  const { t } = useTranslation();
  return (
    <details className="af-ai-theme">
      <summary>
        <span aria-hidden="true">▸</span>
        <span>{t(`${k}.themes.${th.key}`, th.name)}</span>
        <span className="af-trk" style={{ height: 9 }}>
          <span
            className="af-trk-f"
            style={{
              width: `${(share / max) * 100}%`,
              background: SCOPE_LINE[boat],
            }}
          />
        </span>
        <span className="af-num">{pct}%</span>
      </summary>
      <div className="af-ai-items">
        {groupsWithPct(row, th.key, pct).map((g) => (
          <OutlookItem key={g.key} g={g} boat={boat} />
        ))}
      </div>
    </details>
  );
}

function OutlookNotes({ row, boat, data }) {
  const { t } = useTranslation();
  const period = data.testPeriod
    ? t("aiPredictionTab.analogy.period", {
        from: fmtDate(data.testPeriod[0]),
        to: fmtDate(data.testPeriod[1]),
      })
    : "—";
  return (
    <>
      <NoteList
        title={t(`aiPredictionTab.analogy.notes.howToRead`)}
        texts={[
          t(`${k}.foot`, {
            period,
            races: (row.n_races ?? 0).toLocaleString("ja-JP"),
          }),
          boat === 1 &&
            row.frame_ratio !== null &&
            row.frame_ratio !== undefined &&
            t(`${k}.boat1Note`, { pct: Math.round(row.frame_ratio * 100) }),
        ]}
      />
      <NoteList
        title={t(`aiPredictionTab.analogy.notes.caution`)}
        texts={[t(`${k}.foot2`)]}
      />
    </>
  );
}

function OutlookReady({ row, data, boat, target }) {
  const { t } = useTranslation();
  // その段のモデルに無いテーマ（展示前の天候・水面。plan「向きの計算」）は割合も内訳も無いので出さない
  const themes = (data.themes ?? []).filter(
    (th) => row.shares?.[th.key] !== undefined,
  );
  const shares = themes.map((th) => row.shares?.[th.key] ?? 0);
  const pct = to100(shares);
  const max = Math.max(...shares, 0.0001);
  return (
    <div className="af-ai-body">
      <h4 className="af-h3">
        {t(`${k}.heading`, {
          boat,
          finish: t(`${k}.finish.${target}`),
        })}
      </h4>
      <p className="af-sub">{t(`${k}.lede`)}</p>
      <div className="af-ai-themes">
        {themes.map((th, i) => (
          <OutlookTheme
            key={th.key}
            th={th}
            row={row}
            boat={boat}
            share={shares[i]}
            max={max}
            pct={pct[i]}
          />
        ))}
      </div>
      <OutlookNotes row={row} boat={boat} data={data} />
    </div>
  );
}

/**
 * AIの見立て（補助、spec FR-E）。全国の値（数えるレースに連動しない。Q3）。艇番×着順×時点
 * @param {{boat: number, target: 1|2|3, stage: "racecard"|"exhibition"}} props
 */
export default function AiOutlook({ boat, target, stage }) {
  const { t } = useTranslation();
  const { status, data, retry } = useAnalogyContribution({
    venue: 0,
    grade: "all",
    round: "all",
    target,
    stage,
  });
  if (status === "unavailable") return null;
  // 展示前で集計が無いときは準備中の1文だけ（見出し・説明文も隠す。spec FR-E）
  if (status === "preparing")
    return <p className="af-warn">{t(`${k}.preparing`)}</p>;
  // 殻は状態が変わっても同じ位置の同じ details のまま（利用者が開いた open を保つ）
  let body;
  const row = data?.boats?.[String(boat)];
  if (status === "error") body = <OutlookError retry={retry} />;
  else if (!row) body = <OutlookLoading />;
  else
    body = <OutlookReady row={row} data={data} boat={boat} target={target} />;
  return <OutlookShell>{body}</OutlookShell>;
}
