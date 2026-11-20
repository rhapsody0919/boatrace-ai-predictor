/**
 * supabase-read-fake.js - @supabase/supabase-js の createClient の偽（verify の部品。shadow-check-reads.js が import を差し替えて渡す）。
 * 返す client は、呼ばれた method（表・名・引数）を globalThis の記録へ積み、どの問い合わせにも記録の rows[表]（既定は空）を返す。
 * 本物の Supabase には繋がない。
 */
const record = () => globalThis[Symbol.for("verify.supabaseReads")];

function query(table) {
  const rec = record();
  const q = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "then") {
          return (ok) => ok({ data: rec.rows[table] ?? [], error: null });
        }
        return (...args) => {
          rec.calls.push({ table, method: String(prop), args });
          return q;
        };
      },
    },
  );
  return q;
}

export function createClient(url, key) {
  const rec = record();
  rec.clients.push({ url, key });
  return new Proxy(
    {},
    {
      get(_, prop) {
        return (...args) => {
          rec.calls.push({ table: null, method: String(prop), args });
          return query(prop === "from" ? args[0] : null);
        };
      },
    },
  );
}
