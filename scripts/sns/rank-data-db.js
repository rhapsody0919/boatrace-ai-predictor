/**
 * 龍神ボート番付の元データ（rank-data.js）が DB を読むときの入口。読むだけ。
 *
 * 画面と同じ匿名の公開キー（VITE_SUPABASE_ANON_KEY）で読む。書き込みの権限は無い。
 * 鍵は .env.local を `node --env-file=.env.local` で渡す（このファイルは .env を読まない）。
 * 1000行の上限で黙って切れないよう、ページは画面と同じ fetchAllPages で読み切る。
 */
import { createClient } from "@supabase/supabase-js";
import {
  fetchAllPages,
  fetchAllInChunks,
} from "../../src/services/fetchAllPages.js";

let client = null;

/** 画面と同じ匿名のクライアント。失敗は .throwOnError() で例外にする */
export function db() {
  if (client) return client;
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase の URL・匿名キーが無い（node --env-file=.env.local で VITE_SUPABASE_URL・VITE_SUPABASE_ANON_KEY を渡す）",
    );
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

/**
 * 1つのクエリを、並び（order の列）を付けてページで読み切る。
 * @param {string} table
 * @param {string} select
 * @param {string[]} orderKeys 一意な並び（主キー）
 * @param {(q: any) => any} [filter]
 */
export function readAll(table, select, orderKeys, filter = (q) => q) {
  return fetchAllPages((from, to) => {
    let q = filter(db().from(table).select(select));
    for (const key of orderKeys) q = q.order(key);
    return q.range(from, to).throwOnError();
  });
}

/**
 * in() の値を分けて読む（画面の fetchAllByIn と同じ、1回300件）
 * @param {string} table
 * @param {string} select
 * @param {string} column
 * @param {Array<string|number>} values
 * @param {string[]} orderKeys
 * @param {(q: any) => any} [filter]
 */
export function readAllIn(
  table,
  select,
  column,
  values,
  orderKeys,
  filter = (q) => q,
) {
  return fetchAllInChunks(values, 300, (chunk, from, to) => {
    let q = filter(db().from(table).select(select).in(column, chunk));
    for (const key of orderKeys) q = q.order(key);
    return q.range(from, to).throwOnError();
  });
}

/** 期間を月ごとに分け、並行で読む（1回の要求を短くする） */
export function monthSlices(from, to) {
  const out = [];
  let cur = from;
  while (cur <= to) {
    const [y, m] = cur.slice(0, 7).split("-").map(Number);
    const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.parse(`${next}T00:00:00Z`) - 86400000)
      .toISOString()
      .slice(0, 10);
    out.push({ from: cur, to: end < to ? end : to });
    cur = next;
  }
  return out;
}
