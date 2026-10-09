import { Link } from "react-router-dom";
import BaseBar from "./BaseBar";
import BottomSheet from "./BottomSheet";
import { TermButton, TheoryButton } from "./SheetButtons";
import { venueTechniqueTrend } from "../../../utils/assistModel";
import { ASSIST_COPY as C } from "../../../data/thinkingAssistCopy";

const p0 = (v) => Math.round(v * 100);

/** 決まり手（直近1年が主、直近90日を薄い帯で並べる。D-35）。「最近↑／↓」は印のある行だけ（D-37） */
function Techniques({ trend }) {
  return (
    <div className="ta-venue-tech">
      <h3>{C.venueTechHeading(trend.total365, trend.total90)}</h3>
      {trend.rows.map((r) => (
        <div key={r.technique} className="ta-venue-tech-row">
          <span className="ta-venue-tech-label">
            {r.mark ? (
              <span className="ta-tag ta-tag-hit ta-num">
                {C.venueTrend(
                  r.technique,
                  r.mark,
                  p0(r.rate90),
                  p0(r.ratePrev),
                )}
              </span>
            ) : (
              r.technique
            )}
          </span>
          <span className="ta-venue-tech-bars" aria-hidden="true">
            <span className="ta-bar-track">
              <span
                className="ta-bar-fill"
                style={{ width: `${r.rate365 * 100}%` }}
              />
            </span>
            {r.rate90 != null && (
              <span className="ta-bar-track ta-venue-tech-90">
                <span
                  className="ta-bar-fill"
                  style={{ width: `${r.rate90 * 100}%` }}
                />
              </span>
            )}
          </span>
          <span className="ta-num ta-venue-tech-pct">{p0(r.rate365)}%</span>
        </div>
      ))}
    </div>
  );
}

/**
 * 会場の特徴のシート（D-14・D-18・D-35・D-37）。ヘッダーの会場名から開く。
 * 水質・型（venues の water_type・cluster）、1号艇の1着（v16 facts の VA）、決まり手（直近1年＋直近90日と「最近↑／↓」）、
 * 潮の傾向（海水・汽水だけ）、会場ページへのリンク。取得の失敗と空を分ける（D-36 (5)）
 * @param {{venue: string, venueCode: number, info: {status: string, data: {waterType: string, cluster: string}|null},
 *   tech: {status: string, data: object[]|null}, vaB1: {k: number, n: number}|null, onClose: () => void}} props
 */
export default function VenueSheet({
  venue,
  venueCode,
  info,
  tech,
  vaB1,
  onClose,
}) {
  const water = info.data?.waterType ?? null;
  const cluster = info.data?.cluster ?? null;
  const trend =
    tech.status === "ready" ? venueTechniqueTrend(tech.data ?? []) : null;
  const tidal = water === "sea" || water === "brackish";
  return (
    <BottomSheet title={C.venueTitle(venue)} onClose={onClose}>
      {info.status === "error" ? (
        <p className="ta-note">{C.partFailed(C.venueWater)}</p>
      ) : (
        (water || cluster) && (
          <dl className="ta-kv">
            {water && (
              <>
                <dt>
                  {C.venueWater}
                  <TermButton term="水質" />
                </dt>
                <dd>
                  {C.waterType[water] ?? water}
                  {tidal && C.waterTide}
                  {tidal && (
                    <TheoryButton id="TC-T3" name={C.venueTide}>
                      {C.venueTide} ›
                    </TheoryButton>
                  )}
                </dd>
              </>
            )}
            {cluster && C.cluster[cluster] && (
              <>
                <dt>{C.venueType}</dt>
                <dd>{C.cluster[cluster]}</dd>
              </>
            )}
          </dl>
        )
      )}
      {vaB1 && (
        <BaseBar label={C.venueB1(venue, vaB1.n)} k={vaB1.k} n={vaB1.n} />
      )}
      {tech.status === "error" && (
        <p className="ta-note">{C.partFailed(C.venueTech)}</p>
      )}
      {(tech.status === "loading" || tech.status === "idle") && (
        <p className="ta-note">{C.loading}</p>
      )}
      {/* 空（0行）は節を出さない（D-36 (5)） */}
      {trend && <Techniques trend={trend} />}
      <p className="ta-note">{C.venueNote}</p>
      <Link className="ta-link" to={`/venue/${venueCode}`}>
        {C.venueLink(venue)}
      </Link>
    </BottomSheet>
  );
}
