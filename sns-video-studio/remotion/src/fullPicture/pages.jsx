/**
 * 段（STEP）の頁の部品。中身は材料の build（scripts/full-picture/scenes/*.mjs）が決め、ここは決まった手順で描くだけ。
 * 見た目は龍神レーダーの暗いカード（ソナー・思考アシスト）に寄せる。配置は pageLayout.js。
 */
import { FONT } from "../fonts.js";
import { BoatBadge } from "./parts.jsx";
import { SANKEY, SONAR, sankeyLayout, sonarChipBox, sonarPoint, triRowBox } from "./sonarLayout.js";
import { CARD_BG, MUTED } from "./parts.js";
import { MIN_TEXT, W } from "./scene2Layout.js";
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
  tableColW,
  tableRowH,
  tableRowY,
  SLIT,
  DEEP,
  axisButtonBox,
  followerRow,
  slitFormBox,
  slitFormOn,
  summaryLayout,
  SUMMARY,
  statsBarRow,
  statsBarBox,
  STATS_BAR,
  slitX,
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
        // 艇番の無い行（進入の型など）は、名前を上の段、棒を下の段に分ける（名前が長くても棒に重ならない）
        const lab = !r.boat;
        const barLeft = lab ? LEFT : BARS.barX;
        const barEnd = (v) => (lab ? LEFT + (v / max) * (BARS.valueX - 30 - LEFT) : xOf(v));
        return (
          <div key={i}>
            <div
              style={{
                position: "absolute",
                left: box.x,
                top: lab ? box.y : box.y + 20,
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              {r.boat ? <BoatBadge b={r.boat} size={52} /> : null}
              <span
                style={{ fontSize: r.boat ? MIN_TEXT : 38, color: TEXT, fontWeight: 700, whiteSpace: "nowrap" }}
              >
                {r.label}
              </span>
            </div>
            <div
              style={{
                position: "absolute",
                left: barLeft,
                top: lab ? box.y + 54 : box.y + 22,
                width: Math.max(4, barEnd(r.value) - barLeft),
                height: lab ? 40 : 56,
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
                top: lab ? box.y + 44 : box.y + 24,
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

/**
 * 表（見出し＋行）。cols: 見出しの文字（左の列を除く）。rows: [{boat, label, cells: [文字]}]（boat があれば艇番の札、無ければ label の文字）。
 * button があれば見出しの右に置く。grow があれば、段の頭から grow フレームかけて行を上から順に出す（表を縦に伸ばす）
 */
export function TablePage({ title, sub, cols, rows, button, shown = 1, grow = 0, t = 0, firstW = null }) {
  const n = cols.length;
  const rowH = tableRowH(rows.length);
  const col = (j) => (firstW ? tableColW(j, n, firstW) : tableCol(j, n));
  const visible = grow ? Math.min(rows.length, Math.floor((t / grow) * rows.length) + 1) : rows.length;
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
          const cc = col(j + 1);
          return (
            <div key={j} style={{ position: "absolute", left: cc.x, top: BODY_Y + 16, width: cc.w, textAlign: "center", fontSize: MIN_TEXT, color: MUTED, fontWeight: 700, whiteSpace: "nowrap" }}>
              {c}
            </div>
          );
        })}
        {rows.slice(0, visible).map((r, i) => (
          <div key={i}>
            <div style={{ position: "absolute", left: LEFT, top: tableRowY(i, rowH), width: RIGHT - LEFT, height: rowH, borderTop: "2px solid rgba(255,255,255,0.08)" }} />
            {r.boat ? (
              <div style={{ position: "absolute", left: col(0).x + 20, top: tableRowY(i, rowH) + (rowH - 54) / 2 }}>
                <BoatBadge b={r.boat} size={54} />
              </div>
            ) : (
              <div style={{ position: "absolute", left: col(0).x + 10, top: tableRowY(i, rowH) + (rowH - 46) / 2, fontSize: 38, fontWeight: 800, color: TEXT, whiteSpace: "nowrap" }}>
                {r.label}
              </div>
            )}
            {r.cells.map((c, j) => {
              const cc = col(j + 1);
              return (
                <div key={j} style={{ position: "absolute", left: cc.x, top: tableRowY(i, rowH) + (rowH - 48) / 2, width: cc.w, textAlign: "center", fontSize: 40, fontWeight: 700, color: "#ffffff", whiteSpace: "nowrap" }}>
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

/** 数値の欄（縦に並べる）。rows: [{label, value, note, bar?}]。bar があれば棒つきの大きい欄（statsBarRow） */
export function StatsPage({ title, sub, rows }) {
  return (
    <>
      <Panel title={title} sub={sub} />
      {rows.map((r, i) => (r.bar ? <StatsBarRow key={i} r={r} i={i} /> : <StatsRow key={i} r={r} i={i} />))}
    </>
  );
}

const ROW_BG = { position: "absolute", background: "#0c1a2c", borderRadius: 20, boxSizing: "border-box", padding: "20px 28px" };

function StatsRow({ r, i }) {
  const box = statsRow(i);
  return (
    <div style={{ ...ROW_BG, left: box.x, top: box.y, width: box.w, height: box.h }}>
      <div style={{ fontSize: MIN_TEXT, color: TEXT, fontWeight: 600 }}>{r.label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
        <span style={{ fontSize: 60, fontWeight: 900, color: "#ffffff" }}>{r.value}</span>
        {r.note && <span style={{ fontSize: MIN_TEXT, color: MUTED }}>{r.note}</span>}
      </div>
    </div>
  );
}

/** 棒つきの欄: 見出し・値（棒の上）・棒（欄の幅いっぱい）・全国の目印とその値（棒の下） */
function StatsBarRow({ r, i }) {
  const box = statsBarRow(i);
  const bar = statsBarBox(i);
  const markX = r.bar.mark === null || r.bar.mark === undefined ? null : bar.x + Math.min(1, r.bar.mark) * bar.w;
  return (
    <>
      <div style={{ ...ROW_BG, left: box.x, top: box.y, width: box.w, height: box.h }}>
        <div style={{ fontSize: MIN_TEXT, color: TEXT, fontWeight: 600 }}>{r.label}</div>
        <div style={{ fontSize: 72, fontWeight: 900, color: "#ffffff", lineHeight: 1.2 }}>{r.value}</div>
      </div>
      <div style={{ position: "absolute", left: bar.x, top: bar.y, width: bar.w, height: bar.h, background: "rgba(255,255,255,0.08)", borderRadius: 10 }}>
        <div style={{ width: `${Math.min(100, r.bar.value * 100)}%`, height: "100%", background: "#e9cf86", borderRadius: 10 }} />
      </div>
      {markX !== null && (
        <>
          <div style={{ position: "absolute", left: markX - 3, top: bar.y - 12, width: 6, height: bar.h + 24, background: "#2dd4bf", borderRadius: 3 }} />
          {r.note && (
            <div style={{ position: "absolute", left: Math.min(Math.max(markX - 150, bar.x), bar.x + bar.w - 300), top: box.y + STATS_BAR.markLabelTop, width: 300, textAlign: "center", fontSize: MIN_TEXT, color: "#2dd4bf", fontWeight: 700, whiteSpace: "nowrap" }}>
              {r.note}
            </div>
          )}
        </>
      )}
    </>
  );
}

const FLOW = { 1: "#e5e1d6", 2: "#8b95a5", 3: "#ef5350", 4: "#42a5f5", 5: "#f0c419", 6: "#4caf50" };

/** 類似度の円（龍神ソナー）。winners: 似ている順の1着の艇。counts: 艇ごとの1着の件数 */
export function SonarPage({ title, sub, winners, counts }) {
  const n = winners.length;
  const rings = [0.25, 0.5, 0.75, 1].map((f) => SONAR.R * f);
  return (
    <>
      <Panel title={title} sub={sub} />
      <svg width={W} height={1920} style={{ position: "absolute", left: 0, top: 0 }}>
        {rings.map((r, i) => (
          <circle key={i} cx={SONAR.cx} cy={SONAR.cy} r={r} fill="none" stroke="rgba(201,162,39,0.22)" strokeWidth={2} />
        ))}
        {[1, 2, 3, 4, 5, 6].map((b) => {
          const a = ((-90 + (b - 1) * 60 - 30) * Math.PI) / 180;
          return <line key={b} x1={SONAR.cx} y1={SONAR.cy} x2={SONAR.cx + SONAR.R * Math.cos(a)} y2={SONAR.cy + SONAR.R * Math.sin(a)} stroke="rgba(201,162,39,0.18)" strokeWidth={2} />;
        })}
        {winners.map((b, i) => {
          if (!b) return null;
          const p = sonarPoint(b, i + 1, n);
          return <circle key={i} cx={p.x} cy={p.y} r={n > 300 ? 5 : 7} fill={FLOW[b]} stroke={b === 2 ? "#ffffff" : "none"} strokeWidth={1} opacity={0.9} />;
        })}
        <circle cx={SONAR.cx} cy={SONAR.cy} r={12} fill="#ffffff" />
      </svg>
      {[1, 2, 3, 4, 5, 6].map((b) => {
        const box = sonarChipBox(b);
        return (
          <div key={b} style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, borderRadius: 16, background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <BoatBadge b={b} size={48} />
            <span style={{ fontSize: MIN_TEXT, color: "#ffffff", fontWeight: 800 }}>{counts[b - 1]}</span>
          </div>
        );
      })}
    </>
  );
}

function SankeySvg({ links, n, opacity }) {
  const { nodes, bands } = sankeyLayout(links, n);
  const w = SANKEY.nodeW;
  return (
    <svg width={W} height={1920} style={{ position: "absolute", left: 0, top: 0, opacity }}>
      {bands.map((b, i) => {
        const x0 = SANKEY.cols[b.p] + w;
        const x1 = SANKEY.cols[b.p + 1];
        const mx = (x0 + x1) / 2;
        const d = `M${x0},${b.y0} C${mx},${b.y0} ${mx},${b.y1} ${x1},${b.y1} L${x1},${b.y1 + b.h} C${mx},${b.y1 + b.h} ${mx},${b.y0 + b.h} ${x0},${b.y0 + b.h} Z`;
        return <path key={i} d={d} fill={FLOW[b.p === 0 ? b.a : b.a]} opacity={0.55} />;
      })}
      {nodes.map((x, i) => (
        <g key={i}>
          <rect x={x.x} y={x.y} width={w} height={Math.max(2, x.h)} fill={FLOW[x.boat]} stroke={x.boat === 2 ? "#ffffff" : "none"} strokeWidth={2} />
          {x.h >= 40 && (
            <text x={x.x + w / 2} y={x.y + x.h / 2 + 13} textAnchor="middle" fontSize={MIN_TEXT} fontWeight={900} fill={x.boat === 1 || x.boat === 5 ? "#0d1b2e" : "#ffffff"} fontFamily={FONT}>
              {x.boat}
            </text>
          )}
          {x.h >= 44 && (
            <text x={x.x + w + 10} y={x.y + x.h / 2 + 13} fontSize={MIN_TEXT} fontWeight={700} fill="#f3ead0" fontFamily={FONT}>
              {x.count}件
            </text>
          )}
        </g>
      ))}
      {["1着", "2着", "3着"].map((s, i) => (
        <text key={s} x={SANKEY.cols[i] + w / 2} y={SANKEY.top - 20} textAnchor="middle" fontSize={MIN_TEXT} fontWeight={800} fill="#f3ead0" fontFamily={FONT}>
          {s}
        </text>
      ))}
    </svg>
  );
}

/** 着順の流れ。links（押す前）と linksAfter（押した後、1着の艇で絞る）。shown で入れ替える */
export function SankeyPage({ title, sub, links, n, linksAfter, nAfter, shown = 1 }) {
  return (
    <>
      <Panel title={title} sub={sub} />
      {linksAfter ? (
        <>
          <SankeySvg links={links} n={n} opacity={1 - shown} />
          <SankeySvg links={linksAfter} n={nAfter} opacity={shown} />
        </>
      ) : (
        <SankeySvg links={links} n={n} opacity={1} />
      )}
    </>
  );
}

/** よく出た3連単（上位）。rows: [{combo:[a,b,c], count, pct}] */
export function TrifectaPage({ title, sub, rows }) {
  return (
    <>
      <Panel title={title} sub={sub} />
      {rows.map((r, i) => {
        const box = triRowBox(i);
        return (
          <div key={i} style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, background: "#0c1a2c", borderRadius: 20, display: "flex", alignItems: "center", gap: 14, padding: "0 28px", boxSizing: "border-box" }}>
            <span style={{ fontSize: 40, color: "#e2b93b", fontWeight: 900, width: 60 }}>{i + 1}</span>
            {r.combo.map((b, k) => (
              <span key={k} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {k > 0 && <span style={{ fontSize: 40, color: "#a9b8cc" }}>-</span>}
                <BoatBadge b={b} size={62} />
              </span>
            ))}
            <span style={{ marginLeft: "auto", fontSize: 44, fontWeight: 900, color: "#ffffff" }}>{r.count}件</span>
            <span style={{ fontSize: MIN_TEXT, color: "#a9b8cc" }}>{r.pct}%</span>
          </div>
        );
      })}
    </>
  );
}

/**
 * スリット図（平均ST の位置までボートを走らせる）。st: コース順の平均ST（秒）、boats: コース順の艇番。
 * 段の頭で走らせ、押した後（shown）に ST の数字を出す。forms: [{name, on}]（今日の並びに当てはまる形は on）
 */
export function SlitPage({ title, sub, st, boats, button, forms, shown = 1, t = 0 }) {
  const run = Math.min(1, Math.max(0, (t + 18) / 18));
  const fastest = Math.min(...st.filter((v) => v !== null));
  return (
    <>
      <Panel title={title} sub={sub} />
      {button && (
        <div style={{ position: "absolute", left: BUTTON.x, top: BUTTON.y, width: BUTTON.w, height: BUTTON.h, borderRadius: 42, border: `3px solid ${GOLD}`, color: GOLD, fontSize: MIN_TEXT, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" }}>
          {button}
        </div>
      )}
      <div style={{ position: "absolute", left: SLIT.line, top: SLIT.top - 10, width: 4, height: SLIT.laneH * 6 + 20, background: "#ffffff", opacity: 0.8 }} />
      {st.map((v, i) => {
        const y = SLIT.top + i * SLIT.laneH;
        const x = v === null ? null : Math.max(LEFT + 120, slitX(v, fastest));
        return (
          <div key={i}>
            <div style={{ position: "absolute", left: LEFT, top: y + SLIT.laneH / 2 - 1, width: SLIT.line - LEFT, height: 2, background: "rgba(255,255,255,0.08)" }} />
            <div style={{ position: "absolute", left: LEFT, top: y + 12, fontSize: MIN_TEXT, color: MUTED, whiteSpace: "nowrap" }}>{i + 1}</div>
            {x !== null && (
              <div style={{ position: "absolute", left: LEFT + 60 + (x - LEFT - 60) * run - 54, top: y + (SLIT.laneH - 54) / 2 }}>
                <BoatBadge b={boats[i]} size={54} />
              </div>
            )}
            {x !== null && (
              <div style={{ position: "absolute", left: SLIT.line + 24, top: y + 12, fontSize: 40, fontWeight: 800, color: "#ffffff", opacity: shown, whiteSpace: "nowrap" }}>
                {v.toFixed(2)}
              </div>
            )}
          </div>
        );
      })}
      {forms.map((f0, i) => {
        const box = slitFormBox(i);
        const f = { ...f0, on: slitFormOn(f0.on, t) };
        return (
          <div key={i} style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, borderRadius: 16, boxSizing: "border-box", border: `3px solid ${f.on ? GOLD : "rgba(255,255,255,0.15)"}`, background: f.on ? "rgba(226,185,59,0.15)" : "transparent", color: f.on ? "#ffffff" : MUTED, fontSize: MIN_TEXT, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap" }}>
            {f.name}
          </div>
        );
      })}
    </>
  );
}

/** 軸の艇のボタン＋2着の棒。axis: 押した軸の艇、rows: [{boat, value(0〜1), text}] */
export function FollowersPage({ title, sub, axis, rows, max }) {
  return (
    <>
      <Panel title={title} sub={sub} />
      {[1, 2, 3, 4, 5, 6].map((b) => {
        const box = axisButtonBox(b);
        const on = b === axis;
        return (
          <div key={b} style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, borderRadius: 16, boxSizing: "border-box", border: `3px solid ${on ? GOLD : "rgba(255,255,255,0.15)"}`, background: on ? "rgba(226,185,59,0.18)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <BoatBadge b={b} size={50} />
            <span style={{ fontSize: MIN_TEXT, color: on ? "#ffffff" : MUTED, fontWeight: 800 }}>軸</span>
          </div>
        );
      })}
      {rows.map((r, i) => {
        const box = followerRow(i);
        return (
          <div key={r.boat}>
            <div style={{ position: "absolute", left: box.x, top: box.y + 22 }}>
              <BoatBadge b={r.boat} size={52} />
            </div>
            <div style={{ position: "absolute", left: BARS.barX - 80, top: box.y + 22, width: Math.max(4, (r.value / max) * (BARS.barW + 80)), height: 56, background: "#b3a77a", borderRadius: "0 10px 10px 0" }} />
            <div style={{ position: "absolute", left: BARS.valueX, top: box.y + 24, fontSize: 40, fontWeight: 800, color: "#ffffff", whiteSpace: "nowrap" }}>{r.text}</div>
          </div>
        );
      })}
    </>
  );
}

/** 思考アシストの深掘り: 差がつく材料の先頭カード＋札。card: {name, text, level}、chips: [文字] */
export function DeepPage({ title, sub, card, chips }) {
  return (
    <>
      <Panel title={title} sub={sub} />
      {card ? (
        <div style={{ position: "absolute", left: LEFT, top: DEEP.cardY, width: RIGHT - LEFT, height: DEEP.cardH, background: "#0c1a2c", borderRadius: 20, border: `3px solid ${GOLD}`, boxSizing: "border-box", padding: "26px 30px" }}>
          <div style={{ fontSize: 46, fontWeight: 900, color: "#ffffff" }}>{card.name}</div>
          <div style={{ fontSize: 40, fontWeight: 700, color: "#ffffff", marginTop: 18, lineHeight: 1.35 }}>{card.text}</div>
          {card.level && <div style={{ fontSize: MIN_TEXT, fontWeight: 800, color: GOLD, marginTop: 14 }}>{card.level}</div>}
        </div>
      ) : (
        <div style={{ position: "absolute", left: LEFT, top: DEEP.cardY + 20, fontSize: 40, color: MUTED }}>▲の付いた材料なし</div>
      )}
      <div style={{ position: "absolute", left: LEFT, top: DEEP.chipY, width: RIGHT - LEFT, display: "flex", flexWrap: "wrap", gap: 16 }}>
        {chips.map((c, i) => (
          <span key={i} style={{ height: DEEP.chipH, display: "inline-flex", alignItems: "center", padding: "0 26px", borderRadius: 40, background: "rgba(226,185,59,0.18)", border: `2px solid ${GOLD}`, color: "#ffffff", fontSize: 40, fontWeight: 800, boxSizing: "border-box", whiteSpace: "nowrap" }}>
            {c}
          </span>
        ))}
      </div>
    </>
  );
}

/**
 * 展示後に見るところのまとめカード（型: 場面8、オーナー 10/16・10/17）。群ごとに左の色の線と見出しの札（インが残る＝青、外が来る＝橙）、
 * 各行は見る所を太字、意味は「→」付きで小さく薄く。行の頭に関係する艇番（橙は鍵の艇、それ以外は白）。右下に「スクショで保存」
 */
export function SummaryPage({ groups, footer }) {
  const lay = summaryLayout(groups);
  const out = [];
  groups.forEach((g, gi) => {
    const L = lay.groups[gi];
    out.push(
      <div key={`h${gi}`} style={{ position: "absolute", left: LEFT, top: L.head, height: SUMMARY.headH - 8, padding: "0 22px", borderRadius: 30, background: g.color, color: "#0d1b2e", fontSize: 38, fontWeight: 900, display: "flex", alignItems: "center" }}>
        {g.title}
      </div>,
    );
    g.rows.forEach((r, ri) => {
      out.push(
        <div key={`r${gi}-${ri}`} style={{ position: "absolute", left: LEFT + 30, top: L.rows[ri], width: RIGHT - LEFT - 30, height: SUMMARY.rowH }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, height: 42 }}>
            {r.boats.map((b) => (
              <span key={b} style={{ minWidth: 40, height: 40, borderRadius: 8, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: MIN_TEXT, fontWeight: 900, background: r.keys.includes(b) ? "#ff8a1f" : "#ffffff", color: "#0d1b2e" }}>
                {b}
              </span>
            ))}
            <span style={{ fontSize: 38, lineHeight: "42px", fontWeight: 800, color: "#ffffff", whiteSpace: "nowrap" }}>{r.look}</span>
          </div>
          <div style={{ fontSize: MIN_TEXT, lineHeight: "40px", color: MUTED, whiteSpace: "nowrap" }}>→ {r.mean}</div>
        </div>,
      );
    });
    out.push(<div key={`l${gi}`} style={{ position: "absolute", left: LEFT, top: L.line.top, width: 8, height: L.line.h, borderRadius: 4, background: g.color }} />);
  });
  return (
    <>
      {out}
      <div style={{ position: "absolute", left: RIGHT - 300, top: lay.saveY, width: 300, textAlign: "right", fontSize: MIN_TEXT, color: MUTED }}>スクショで保存</div>
      <div style={{ position: "absolute", left: LEFT, top: lay.footerY, height: SUMMARY.footerH, fontSize: 38, lineHeight: `${SUMMARY.footerH}px`, fontWeight: 800, color: GOLD, whiteSpace: "nowrap" }}>{footer}</div>
    </>
  );
}
