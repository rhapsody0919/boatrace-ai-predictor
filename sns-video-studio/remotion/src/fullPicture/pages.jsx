/**
 * 段（STEP）の頁の部品。中身は材料の build（scripts/full-picture/scenes/*.mjs）が決め、ここは決まった手順で描くだけ。
 * 見た目は龍神レーダーの暗いカード（ソナー・思考アシスト）に寄せる。配置は pageLayout.js。
 */
import { BoatBadge } from "./parts.jsx";
import { CARD_BG, MUTED } from "./parts.js";
import { MIN_TEXT } from "./scene2Layout.js";
import {
  BARS,
  BODY_Y,
  BUTTON,
  LEFT,
  PAGE_BOTTOM,
  PAGE_TOP,
  RIGHT,
  TABLE,
  TITLE_Y,
  barsRow,
  statsRow,
  tableCol,
  tableRowY,
} from "./pageLayout.js";

const GOLD = "#e2b93b";
const TEXT = "#f3ead0";

function Panel({ title, sub }) {
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: LEFT - 20,
          top: PAGE_TOP - 20,
          width: RIGHT - LEFT + 40,
          height: PAGE_BOTTOM - PAGE_TOP + 20,
          background: CARD_BG,
          border: "2px solid rgba(255,255,255,0.12)",
          borderRadius: 28,
          boxSizing: "border-box",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: LEFT,
          top: TITLE_Y + 8,
          fontSize: 44,
          fontWeight: 800,
          color: "#ffffff",
          whiteSpace: "nowrap",
        }}
      >
        {title}
      </div>
      {sub && (
        <div
          style={{
            position: "absolute",
            left: LEFT,
            top: TITLE_Y + 68,
            fontSize: MIN_TEXT,
            color: MUTED,
            whiteSpace: "nowrap",
          }}
        >
          {sub}
        </div>
      )}
    </>
  );
}

/** 横棒（6行）＋目印（全国平均など）。rows: [{boat, label, value(0〜1), text, mark(0〜1)|null}] */
export function BarsPage({ title, sub, rows, max, markLabel }) {
  const xOf = (v) => BARS.barX + (v / max) * BARS.barW;
  return (
    <>
      <Panel title={title} sub={sub} />
      {rows.map((r, i) => {
        const box = barsRow(i);
        return (
          <div key={i}>
            <div
              style={{
                position: "absolute",
                left: box.x,
                top: box.y + 20,
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <BoatBadge b={r.boat} size={52} />
              <span
                style={{ fontSize: MIN_TEXT, color: TEXT, fontWeight: 700 }}
              >
                {r.label}
              </span>
            </div>
            <div
              style={{
                position: "absolute",
                left: BARS.barX,
                top: box.y + 22,
                width: Math.max(4, xOf(r.value) - BARS.barX),
                height: 56,
                background: "#b3a77a",
                borderRadius: "0 10px 10px 0",
              }}
            />
            {r.mark !== null && r.mark !== undefined && (
              <div
                style={{
                  position: "absolute",
                  left: xOf(r.mark) - 3,
                  top: box.y + 8,
                  width: 6,
                  height: 84,
                  background: "#2dd4bf",
                  borderRadius: 3,
                }}
              />
            )}
            <div
              style={{
                position: "absolute",
                left: BARS.valueX,
                top: box.y + 24,
                fontSize: 40,
                fontWeight: 800,
                color: "#ffffff",
              }}
            >
              {r.text}
            </div>
          </div>
        );
      })}
      {markLabel && (
        <div
          style={{
            position: "absolute",
            left: LEFT,
            top: barsRow(5).y + BARS.rowH + 10,
            fontSize: MIN_TEXT,
            color: "#2dd4bf",
            whiteSpace: "nowrap",
          }}
        >
          ┃ {markLabel}
        </div>
      )}
    </>
  );
}

/** 表（見出し＋6行）。cols: 見出しの文字（艇の列を除く）。rows: [{boat, cells: [文字]}]。button があれば見出しの右に置く */
export function TablePage({ title, sub, cols, rows, button, shown = 1 }) {
  const n = cols.length;
  return (
    <>
      <Panel title={title} sub={sub} />
      {button && (
        <div
          style={{
            position: "absolute",
            left: BUTTON.x,
            top: BUTTON.y,
            width: BUTTON.w,
            height: BUTTON.h,
            borderRadius: 42,
            border: `3px solid ${GOLD}`,
            color: GOLD,
            fontSize: MIN_TEXT,
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxSizing: "border-box",
          }}
        >
          {button}
        </div>
      )}
      <div style={{ opacity: shown }}>
        {cols.map((c, j) => {
          const col = tableCol(j + 1, n);
          return (
            <div
              key={j}
              style={{
                position: "absolute",
                left: col.x,
                top: BODY_Y + 16,
                width: col.w,
                textAlign: "center",
                fontSize: MIN_TEXT,
                color: MUTED,
                fontWeight: 700,
                whiteSpace: "nowrap",
              }}
            >
              {c}
            </div>
          );
        })}
        {rows.map((r, i) => (
          <div key={i}>
            <div
              style={{
                position: "absolute",
                left: LEFT,
                top: tableRowY(i),
                width: RIGHT - LEFT,
                height: TABLE.rowH,
                borderTop: "2px solid rgba(255,255,255,0.08)",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: tableCol(0, n).x + 20,
                top: tableRowY(i) + 18,
              }}
            >
              <BoatBadge b={r.boat} size={54} />
            </div>
            {r.cells.map((c, j) => {
              const col = tableCol(j + 1, n);
              return (
                <div
                  key={j}
                  style={{
                    position: "absolute",
                    left: col.x,
                    top: tableRowY(i) + 22,
                    width: col.w,
                    textAlign: "center",
                    fontSize: 40,
                    fontWeight: 700,
                    color: "#ffffff",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

/** 数値の欄（縦に並べる）。rows: [{label, value, note}] */
export function StatsPage({ title, sub, rows }) {
  return (
    <>
      <Panel title={title} sub={sub} />
      {rows.map((r, i) => {
        const box = statsRow(i);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: box.x,
              top: box.y,
              width: box.w,
              height: box.h,
              background: "#0c1a2c",
              borderRadius: 20,
              boxSizing: "border-box",
              padding: "20px 28px",
            }}
          >
            <div style={{ fontSize: MIN_TEXT, color: TEXT, fontWeight: 600 }}>
              {r.label}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
              <span style={{ fontSize: 60, fontWeight: 900, color: "#ffffff" }}>
                {r.value}
              </span>
              {r.note && (
                <span style={{ fontSize: MIN_TEXT, color: MUTED }}>
                  {r.note}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
