#!/usr/bin/env node
/**
 * 24会場の水質・干満差が BOAT RACE 公式の場データと一致することを固定する。DB・ネットワーク接続は不要。
 *
 * 正本: https://www.boatrace.jp/owpc/pc/data/stadium?jcd=01〜24 の「水質」「干満差」
 * （各ページ「2026/06/30現在」、2026-10-12 に24ページを取得して照合した表を下の OFFICIAL に固定）。
 *
 * 守るもの:
 * 1. src/data/venueWaterProfiles.js（画面の水質・潮の表示の元）が OFFICIAL と一致する
 * 2. 画面が venues.water_type（初期データが7会場で公式と食い違っていた）を表示に使わない。
 *    干満差を「海水か汽水なら潮がある」と水質から推定しない（蒲郡・常滑・津で外れる）
 * 3. 英語・繁体字・韓国語の会場ガイドの facts.water が公式の水質の語を含み、別の水質の語を含まない
 * 4. DB の初期データ（docs/db-migration/001_schema.sql）も公式と一致する
 *
 * 公式が変わったら、OFFICIAL・venueWaterProfiles.js・ガイド・初期データをまとめて直す。
 */
import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VENUE_WATER_PROFILES } from "../../src/data/venueWaterProfiles.js";
import { VENUE_GUIDES_EN } from "../../src/data/venueGuidesEn.js";
import { VENUE_GUIDES_ZH_TW } from "../../src/data/venueGuidesZhTw.js";
import { VENUE_GUIDES_KO } from "../../src/data/venueGuidesKo.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const read = (p) => readFileSync(path.join(root, p), "utf8");

// 公式の場データ（水質・干満差）。2026-10-12 確認
const OFFICIAL = {
  1: ["桐生", "淡水", "なし"],
  2: ["戸田", "淡水", "なし"],
  3: ["江戸川", "汽水", "あり"],
  4: ["平和島", "海水", "あり"],
  5: ["多摩川", "淡水", "なし"],
  6: ["浜名湖", "汽水", "あり"],
  7: ["蒲郡", "汽水", "なし"],
  8: ["常滑", "海水", "なし"],
  9: ["津", "汽水", "なし"],
  10: ["三国", "淡水", "なし"],
  11: ["びわこ", "淡水", "なし"],
  12: ["住之江", "淡水", "なし"],
  13: ["尼崎", "淡水", "なし"],
  14: ["鳴門", "海水", "あり"],
  15: ["丸亀", "海水", "あり"],
  16: ["児島", "海水", "あり"],
  17: ["宮島", "海水", "あり"],
  18: ["徳山", "海水", "あり"],
  19: ["下関", "海水", "あり"],
  20: ["若松", "海水", "あり"],
  21: ["芦屋", "淡水", "なし"],
  22: ["福岡", "汽水", "あり"],
  23: ["唐津", "淡水", "なし"],
  24: ["大村", "海水", "あり"],
};
const TYPE_KEY = { 淡水: "fresh", 汽水: "brackish", 海水: "sea" };

// 言語ごとの水質の語。「鹹淡水」は汽水の言い換え
const WORDS = {
  en: { fresh: /fresh ?water/i, brackish: /brackish/i, sea: /sea ?water/i },
  "zh-TW": { fresh: /淡水/, brackish: /汽水|鹹淡水/, sea: /海水/ },
  ko: { fresh: /담수/, brackish: /기수/, sea: /해수/ },
};
// 汽水の説明（「海水と淡水の混合」）は別の水質の語として数えない
const MIX = {
  en: /mix of sea and fresh ?water|seawater and freshwater/gi,
  "zh-TW": /鹹淡水|海水與淡水混合/g,
  ko: /바닷물과 민물 혼합/g,
};

const errors = [];

// 1. 表示の元の定数
for (let code = 1; code <= 24; code++) {
  const [name, type, tide] = OFFICIAL[code];
  const got = VENUE_WATER_PROFILES[code];
  const want = { waterType: TYPE_KEY[type], tidal: tide === "あり" };
  if (!got || got.waterType !== want.waterType || got.tidal !== want.tidal) {
    errors.push(
      `venueWaterProfiles.js ${code} ${name}: 期待 ${JSON.stringify(want)}／実際 ${JSON.stringify(got)}`,
    );
  }
}
if (Object.keys(VENUE_WATER_PROFILES).length !== 24) {
  errors.push(
    `venueWaterProfiles.js の会場数が24でない: ${Object.keys(VENUE_WATER_PROFILES).length}`,
  );
}

// 2. 画面が DB の water_type と水質からの潮の推定を使わない
// ---- サービス層を偽の supabase クライアントの上で呼ぶ土台（BOA-1675。本文の正規表現から置き換え） ----
// src/ の .js は vite の書き方（拡張子の無い import・import.meta.env）なので、renderJsx の module hooks で読む。
// その上に、src/services/supabaseClient.js を偽のクライアントを返すだけの物へ差し替える hook を重ねる
const FAKE_KEY = "__verifyVenueWaterProfilesSupabase";
const SWAP_CLIENT = `
export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  if (resolved.url.endsWith("/src/services/supabaseClient.js")) {
    return {
      url: "data:text/javascript," + encodeURIComponent("export const supabase = globalThis.${FAKE_KEY};"),
      shortCircuit: true,
    };
  }
  return resolved;
}
`;
register(new URL("../lib/renderJsx.js", import.meta.url));
register(`data:text/javascript,${encodeURIComponent(SWAP_CLIENT)}`);

/**
 * 偽の supabase クライアント（メモリ上の表）。select・eq・gt・gte・lt・lte・in・like・order（ascending）・limit・range・
 * maybeSingle と await を扱い、呼ばれた問い合わせを calls に残す。failTables（表 → 例外へ足す項目）の表は例外で失敗する
 */
function makeFakeSupabase(tables, { failTables = new Map() } = {}) {
  const calls = [];
  const likeToRe = (pat) =>
    new RegExp(
      `^${pat
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/_/g, ".")
        .replace(/%/g, ".*")}$`,
    );
  const client = {
    calls,
    from(table) {
      const q = {
        table,
        select: null,
        filters: [],
        orders: [],
        desc: new Set(),
        range: null,
        limit: null,
      };
      calls.push(q);
      const run = (single = false) => {
        // 本物のクライアントは throwOnError を既定で付ける（supabaseClient.js）ので、失敗は例外で来る
        if (failTables.has(table))
          return Promise.reject(
            Object.assign(
              new Error(`fake failure: ${table}`),
              failTables.get(table),
            ),
          );
        let rows = (tables[table] ?? []).filter((row) =>
          q.filters.every(([op, col, val]) => {
            const v = row[col];
            if (op === "eq") return v === val;
            if (op === "gt") return v > val;
            if (op === "gte") return v >= val;
            if (op === "lt") return v < val;
            if (op === "lte") return v <= val;
            if (op === "in") return val.includes(v);
            if (op === "like") return likeToRe(val).test(v);
            throw new Error(`偽のクライアントに無い絞り: ${op}`);
          }),
        );
        if (q.orders.length > 0)
          rows = [...rows].sort((a, b) => {
            for (const col of q.orders) {
              const dir = q.desc.has(col) ? -1 : 1;
              if (a[col] < b[col]) return -dir;
              if (a[col] > b[col]) return dir;
            }
            return 0;
          });
        if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
        if (q.limit !== null) rows = rows.slice(0, q.limit);
        const copy = rows.map((r) => ({ ...r }));
        return Promise.resolve({
          data: single ? (copy[0] ?? null) : copy,
          error: null,
        });
      };
      const filter = (op) => (col, val) => {
        q.filters.push([op, col, val]);
        return chain;
      };
      const chain = {
        select(cols) {
          q.select = cols;
          return chain;
        },
        eq: filter("eq"),
        gt: filter("gt"),
        gte: filter("gte"),
        lt: filter("lt"),
        lte: filter("lte"),
        in: filter("in"),
        like: filter("like"),
        order(col, { ascending = true } = {}) {
          q.orders.push(col);
          if (!ascending) q.desc.add(col);
          return chain;
        },
        limit(n) {
          q.limit = n;
          return chain;
        },
        range(a, b) {
          q.range = [a, b];
          return chain;
        },
        maybeSingle: () => run(true),
        then(res, rej) {
          return run().then(res, rej);
        },
      };
      return chain;
    },
  };
  return client;
}
// サービス層のキャッシュは localStorage にも書く。Node には無いので、何も残さない物を置く（メモリのキャッシュは clearCache で消す）
globalThis.localStorage ??= {
  getItem: () => null,
  setItem() {},
  removeItem() {},
  key: () => null,
  length: 0,
};

// 2. 画面（getVenueCharacteristics）が DB の water_type でなく公式の場データを返す。
//    DB の water_type はわざと全会場で公式と違う値にしておく
const fakeTables = {};
globalThis[FAKE_KEY] = makeFakeSupabase(fakeTables);
const { clearCache } = await import("../../src/services/core.js");
const { getVenueCharacteristics } =
  await import("../../src/services/venueQueries.js");
const WRONG = { fresh: "sea", brackish: "fresh", sea: "brackish" };
fakeTables.venues = [
  ...Array.from({ length: 24 }, (_, i) => ({
    code: i + 1,
    cluster: `cluster-${i + 1}`,
    water_type: WRONG[TYPE_KEY[OFFICIAL[i + 1][1]]],
  })),
  { code: 99, cluster: "cluster-99", water_type: "sea" }, // 公式の表に無い会場
];
clearCache();
for (let code = 1; code <= 24; code++) {
  const [name, type, tide] = OFFICIAL[code];
  const got = await getVenueCharacteristics(code);
  const want = {
    waterType: TYPE_KEY[type],
    tidal: tide === "あり",
    cluster: `cluster-${code}`,
  };
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    errors.push(
      `getVenueCharacteristics(${code}) ${name}: 期待 ${JSON.stringify(want)}／実際 ${JSON.stringify(got)}（venues.water_type は公式と食い違うので使わない）`,
    );
  }
}
{
  const got = await getVenueCharacteristics(99);
  if (
    JSON.stringify(got) !==
    JSON.stringify({ waterType: null, tidal: null, cluster: "cluster-99" })
  ) {
    errors.push(
      `公式の表に無い会場は水質・干満差を null で返す: 実際 ${JSON.stringify(got)}`,
    );
  }
  const none = await getVenueCharacteristics(50);
  if (none !== null)
    errors.push(`venues に行が無い会場は null: 実際 ${JSON.stringify(none)}`);
}

const tideGuess =
  /waterType\s*===\s*["']sea["']\s*\|\|\s*\w*\s*===?\s*["']brackish["']|water\s*===\s*["']sea["']\s*\|\|\s*water\s*===\s*["']brackish["']/;
for (const p of [
  "src/components/race/assist/VenueSheet.jsx",
  "src/components/race/assist/AssistHeader.jsx",
]) {
  if (tideGuess.test(read(p))) {
    errors.push(
      `${p}: 潮の有無を水質（海水・汽水）から推定している。干満差は公式の tidal を使う`,
    );
  }
}

// 3. 会場ガイド3言語の facts.water
const guides = {
  en: VENUE_GUIDES_EN,
  "zh-TW": VENUE_GUIDES_ZH_TW,
  ko: VENUE_GUIDES_KO,
};
for (const [lang, list] of Object.entries(guides)) {
  for (const g of list) {
    const [name, type] = OFFICIAL[g.code];
    const key = TYPE_KEY[type];
    const water = g.facts?.water ?? "";
    if (!WORDS[lang][key].test(water)) {
      errors.push(
        `ガイド ${lang} ${g.code} ${name}: facts.water に公式の水質（${type}）の語が無い: "${water}"`,
      );
    }
    const rest = water.replace(MIX[lang], "");
    for (const [other, re] of Object.entries(WORDS[lang])) {
      if (other !== key && re.test(rest)) {
        errors.push(
          `ガイド ${lang} ${g.code} ${name}: facts.water に別の水質（${other}）の語がある: "${water}"`,
        );
      }
    }
  }
}

// 4. DB の初期データ
const seed = read("docs/db-migration/001_schema.sql");
for (let code = 1; code <= 24; code++) {
  const [name, type] = OFFICIAL[code];
  const m = seed.match(new RegExp(`\\(${code}, '${name}', '(\\w+)'\\)`));
  if (!m || m[1] !== TYPE_KEY[type]) {
    errors.push(
      `001_schema.sql 初期データ ${code} ${name}: 期待 ${TYPE_KEY[type]}／実際 ${m?.[1] ?? "見つからない"}`,
    );
  }
}

if (errors.length > 0) {
  console.error(
    `❌ 会場の水質・干満差が公式の場データと食い違う（${errors.length}件）`,
  );
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  "✅ 24会場の水質・干満差（表示の元・画面の潮の判定・ガイド3言語・DB初期データ）が公式の場データと一致",
);
