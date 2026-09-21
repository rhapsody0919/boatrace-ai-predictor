/**
 * 検証用の偽のSupabaseクライアント（メモリ上のテーブル。DB・ネットワークに接続しない）。
 * select().eq().gte().lte().order().limit().range()・upsert・update().eq().select() を扱う。
 * missing: 存在しない扱いのテーブル名、または "テーブル.列名"（未適用DDLの再現）。failUpsert: upsertを失敗させる。
 */
export function fakeClient(tables, { missing = new Set(), failUpsert = false } = {}) {
  const calls = { upserts: [], updates: [], selects: [] };
  const client = {
    calls,
    tables,
    from(table) {
      let filters = [];
      const ranges = [];
      let cols = null;
      let op = null;
      let payload = null;
      const chain = {
        select(c) {
          if (op === "update") return chain;
          cols = c;
          op = op ?? "select";
          return chain;
        },
        eq(col, val) {
          filters.push([col, val]);
          return chain;
        },
        gte(col, val) {
          ranges.push([col, ">=", val]);
          return chain;
        },
        lte(col, val) {
          ranges.push([col, "<=", val]);
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        async range(a, b) {
          return run(a, b);
        },
        upsert(rows, o) {
          op = "upsert";
          payload = { rows, o };
          return chain;
        },
        update(values) {
          op = "update";
          payload = values;
          return chain;
        },
        then(res, rej) {
          return run().then(res, rej);
        },
      };
      async function run(a = 0, b = 9999) {
        if (missing.has(table))
          return {
            data: null,
            error: { message: `relation "${table}" does not exist` },
          };
        const rows = tables[table] ?? (tables[table] = []);
        if (op === "select") {
          calls.selects.push({ table, cols, filters: [...filters] });
          if (
            cols &&
            cols.split(",").some((c) => missing.has(`${table}.${c.trim()}`))
          )
            return {
              data: null,
              error: { message: `column ${cols} does not exist` },
            };
          const list = rows.filter(
            (r) =>
              filters.every(([c, v]) => r[c] === v) &&
              ranges.every(([c, o, v]) => (o === ">=" ? r[c] >= v : r[c] <= v)),
          );
          return {
            data: list.slice(a, b + 1).map((r) => ({ ...r })),
            error: null,
          };
        }
        if (op === "upsert") {
          if (failUpsert) return { data: null, error: { message: "boom" } };
          calls.upserts.push({ table, n: payload.rows.length });
          const keys = payload.o.onConflict.split(",");
          for (const r of payload.rows) {
            const i = rows.findIndex((x) => keys.every((k) => x[k] === r[k]));
            if (i >= 0) rows[i] = { ...rows[i], ...r };
            else rows.push({ ...r });
          }
          return { data: null, error: null };
        }
        if (op === "update") {
          const targets = rows.filter((r) =>
            filters.every(([c, v]) => r[c] === v),
          );
          calls.updates.push({
            table,
            filters: [...filters],
            values: payload,
            matched: targets.length,
          });
          for (const r of targets) Object.assign(r, payload);
          return {
            data: targets.map((r) => ({ racer_id: r.racer_id })),
            error: null,
          };
        }
        return { data: null, error: { message: "unsupported" } };
      }
      return chain;
    },
  };
  return client;
}
