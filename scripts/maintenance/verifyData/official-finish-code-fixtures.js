/**
 * verify-official-finish-code.js の入力（日・レース・偽クライアント）。大きさの関所のため、本文を字のまま移した。verify ではない。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
export const K_TEXT = fs.readFileSync(
  path.join(ROOT, "scripts/lib/__fixtures__/kbfile/k260315.txt"),
  "utf8",
);

export const DATE = "2026-03-15";
export const S1_RACE = "2026-03-15-18-12";

export const show = (v) => JSON.stringify(v);

/** race_start_timings の select（gte・lt・order・range）と upsert だけの偽クライアント。1回の range は最大1000行 */
export function fakeClient(rows, { missingColumn = false } = {}) {
  const upserts = [];
  return {
    upserts,
    from: () => {
      const q = {
        select: () => q,
        gte: () => q,
        lt: () => q,
        order: () => q,
        range: async (from, to) =>
          missingColumn
            ? {
                data: null,
                error: {
                  code: "42703",
                  message:
                    "column race_start_timings.official_finish_code does not exist",
                },
              }
            : {
                data: rows
                  .slice(from, Math.min(to + 1, from + 1000))
                  .map((r) => ({ ...r })),
                error: null,
              },
        upsert: async (batch, opts) => {
          upserts.push({ batch, opts });
          return { error: null };
        },
      };
      return q;
    },
  };
}
