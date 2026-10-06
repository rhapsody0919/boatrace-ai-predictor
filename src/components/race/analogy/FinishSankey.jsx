import { useState } from "react";
import { useTranslation } from "react-i18next";
import NoteList from "./NoteList";
import { BOAT_COLORS } from "../../../utils/colors";
import { SCOPE_FLOW, SCOPE_SUBTEXT, SCOPE_TEXT } from "./analogyColors";
import { fmtCount } from "../../../utils/analogyFormat";
import { trifectaList } from "../../../utils/analogyAggregate";

const X = [44, 188, 332];
const W = 22;
const H = 340;
const TOP = 30;
const GAP = 8;

/**
 * 着順の流れ（1着→2着→3着のサンキー。spec B-8・C-5。承認版モックの renderFlow と同じ描き方）
 * 帯の太さ＝件数、少ない流れも薄く全部描く。帯・1着の四角は押せる（名前「1着 1号艇→2着 2号艇 3件」）。
 * 1着の四角を押すと、その艇が勝ったレースだけで描き直す（first・onFirst は親が持つ。棒・扇と共有するため）
 * 「すべて／1号艇以外が勝ったレース」（not1）も親が持つ（よく出た3連単を同じ条件で絞るため）
 * @param {{tri: Record<string, number>, first: number|null, onFirst: (b: number|null) => void, not1: boolean,
 *   onNot1: (v: boolean) => void}} props
 */
export default function FinishSankey({ tri, first, onFirst, not1, onNot1 }) {
  const { t } = useTranslation();
  const [picked, setSel] = useState(null);
  const k = "aiPredictionTab.analogy.flow";
  const rows = trifectaList(tri, { first, not1 });
  const tot = rows.reduce((s, [, c]) => s + c, 0);
  const col = [0, 1, 2].map((p) => {
    const m = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    rows.forEach(([x, c]) => {
      m[x[p]] += c;
    });
    return m;
  });
  const scale = tot ? (H - GAP * 5) / tot : 0;
  const pos = col.map((m) => {
    let y = TOP;
    const o = {};
    for (let b = 1; b <= 6; b++) {
      o[b] = { y, h: Math.max(m[b] * scale, m[b] ? 1.5 : 0) };
      y += o[b].h + GAP;
    }
    return o;
  });
  const outY = pos.map((o) =>
    Object.fromEntries(Object.entries(o).map(([b, v]) => [b, v.y])),
  );
  const inY = pos.map((o) =>
    Object.fromEntries(Object.entries(o).map(([b, v]) => [b, v.y])),
  );
  const links = [0, 1].flatMap((p) => {
    const m = {};
    rows.forEach(([x, c]) => {
      const key = `${x[p]}-${x[p + 1]}`;
      m[key] = (m[key] ?? 0) + c;
    });
    return Object.entries(m)
      .map(([key, c]) => [p, ...key.split("-").map(Number), c])
      .sort((u, v) => u[0] - v[0] || u[1] - v[1] || u[2] - v[2]);
  });
  // 選んだ帯が、条件を変えた後の流れに無ければ選んでいないことにする（全部の帯が薄くなるのを防ぐ）
  const hit = picked
    ? links.find(
        ([p, a, b]) => p === picked.p && a === picked.a && b === picked.b,
      )
    : null;
  const sel = hit ? { p: hit[0], a: hit[1], b: hit[2], c: hit[3] } : null;
  const name = (p, a, b, c) =>
    t(`${k}.link`, { from: p + 1, a, to: p + 2, b, n: fmtCount(c) });
  const paths = links.map(([p, a, b, c]) => {
    const w = Math.max(c * scale, 1);
    const y0 = outY[p][a] + w / 2;
    const y1 = inY[p + 1][b] + w / 2;
    outY[p][a] += c * scale;
    inY[p + 1][b] += c * scale;
    const x0 = X[p] + W;
    const x1 = X[p + 1];
    const mx = (x0 + x1) / 2;
    const isSel = sel && sel.p === p && sel.a === a && sel.b === b;
    const op = isSel
      ? 0.95
      : sel
        ? 0.12
        : 0.25 + 0.6 * Math.min(1, c / (tot * 0.08 || 1));
    const label = name(p, a, b, c);
    const toggle = () => setSel(isSel ? null : { p, a, b, c });
    return (
      <path
        key={`${p}-${a}-${b}`}
        d={`M${x0},${y0}C${mx},${y0} ${mx},${y1} ${x1},${y1}`}
        stroke={SCOPE_FLOW[a]}
        strokeWidth={w}
        fill="none"
        strokeOpacity={op}
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-pressed={Boolean(isSel)}
        style={{ cursor: "pointer" }}
        onClick={toggle}
        onKeyDown={(e) =>
          (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle())
        }
      />
    );
  });
  return (
    <div className="af-flow">
      <div className="af-seg" role="group" aria-label={t(`${k}.filter`)}>
        {[
          [false, "all"],
          [true, "not1"],
        ].map(([v, key]) => (
          <button
            key={key}
            type="button"
            aria-pressed={not1 === v}
            onClick={() => {
              onNot1(v);
              setSel(null);
            }}
          >
            {t(`${k}.${key}`)}
          </button>
        ))}
      </div>
      <div className="af-dark af-dark-flat">
        <svg viewBox="0 0 400 400" role="img" aria-label={t(`${k}.aria`)}>
          {paths}
          {pos.map((o, p) =>
            [1, 2, 3, 4, 5, 6].map((b) => {
              if (!o[b].h) return null;
              const on = p === 0 && first === b;
              const c = BOAT_COLORS[b];
              const rect = (
                <rect
                  x={X[p]}
                  y={o[b].y}
                  width={W}
                  height={o[b].h}
                  fill={c.bg}
                  stroke={on ? "#fff" : "#94a3b8"}
                  strokeWidth={on ? 2 : 0.8}
                />
              );
              return (
                <g key={`${p}-${b}`}>
                  {p === 0 ? (
                    <g
                      role="button"
                      tabIndex={0}
                      aria-label={t(`${k}.first`, {
                        b,
                        n: fmtCount(col[0][b]),
                      })}
                      aria-pressed={on}
                      style={{ cursor: "pointer" }}
                      onClick={() => {
                        onFirst(first === b ? null : b);
                        setSel(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
                        e.preventDefault();
                        onFirst(first === b ? null : b);
                      }}
                    >
                      {rect}
                    </g>
                  ) : (
                    rect
                  )}
                  {o[b].h >= 11 && (
                    <text
                      x={X[p] + W / 2}
                      y={o[b].y + o[b].h / 2 + 4}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight="700"
                      fill={c.text}
                      pointerEvents="none"
                    >
                      {b}
                    </text>
                  )}
                  {col[p][b] > 0 && (
                    <text
                      x={
                        p === 2
                          ? X[p] + W + 6
                          : p === 0
                            ? X[p] - 6
                            : X[p] + W + 4
                      }
                      y={o[b].y + o[b].h / 2 + 4}
                      textAnchor={p === 0 ? "end" : "start"}
                      fontSize="12"
                      fill={SCOPE_SUBTEXT}
                      stroke="#060d18"
                      strokeWidth="3"
                      paintOrder="stroke"
                      pointerEvents="none"
                    >
                      {t("aiPredictionTab.analogy.count", {
                        n: fmtCount(col[p][b]),
                      })}
                    </text>
                  )}
                </g>
              );
            }),
          )}
          {[0, 1, 2].map((p) => (
            <text
              key={p}
              x={X[p] + W / 2}
              y="18"
              textAnchor="middle"
              fontSize="14"
              fontWeight="700"
              fill={SCOPE_TEXT}
            >
              {t(`${k}.rank`, { n: p + 1 })}
            </text>
          ))}
        </svg>
      </div>
      <p className="af-sub">
        {sel
          ? t(`${k}.selected`, {
              label: name(sel.p, sel.a, sel.b, sel.c),
              total: fmtCount(tot),
            })
          : first
            ? t(`${k}.firstNote`, { b: first, n: fmtCount(col[0][first]) })
            : t(`${k}.hint`)}
      </p>
      {!first && <NoteList texts={[t(`${k}.note`)]} />}
    </div>
  );
}
