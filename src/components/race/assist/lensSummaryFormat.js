export const pct = (k, n) => (n ? (k / n) * 100 : 0);

export const p0 = (k, n) => Math.round(pct(k, n));

export const p1 = (k, n) => pct(k, n).toFixed(1);

export const comma = (n) => n.toLocaleString("ja-JP");

export const f2 = (v) => (v == null ? "—" : v.toFixed(2));

export const st2 = (v, fly) =>
  v == null
    ? "—"
    : `${fly ? "F" : ""}.${String(Math.round(Math.abs(v) * 100)).padStart(2, "0")}`;
