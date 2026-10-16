/**
 * BOA-635 の端末内保存（docs/design/past-rate-check/spec.md FR-5）。純粋関数（storage は引数で受ける）。
 *
 * キーは boatai-user: 接頭辞（データキャッシュの boatai: と分ける）。1レース×1型につき最新1件、入力時刻から
 * 30日で消す、上限1,000件、締切以降は保存しない。localStorage が使えない・中身が壊れているときは、
 * 保存と振り返りだけをしない（判定と表示は止めない）。エラーは console に出し、画面には出さない。
 */
import { SLIT_FORMS } from "../analogyScenario.js";
import { TENKAI_TECHNIQUES, TYPES } from "./count.js";

export const STORAGE_KEY = "boatai-user:past-rate-check:v1";
const KEEP_DAYS = 30;
const MAX_ENTRIES = 1000;
const DAY_MS = 86400000;

const defaultStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // アクセス自体が投げる環境（プライベートモード等）
  }
};

const isBoat = (v) => Number.isInteger(v) && v >= 1 && v <= 6;
const isBoats = (v) => Array.isArray(v) && v.length > 0 && v.every(isBoat);

const INPUT_OK = {
  order: (i) =>
    isBoat(i.first) &&
    isBoats(i.second) &&
    isBoats(i.third) &&
    typeof i.nagashi === "boolean",
  boat1: (i) => ["win", "top3", "out"].includes(i.outcome),
  tenkai: (i) => isBoat(i.boat) && TENKAI_TECHNIQUES.includes(i.technique),
  slit: (i) =>
    i.mode === "custom"
      ? Array.isArray(i.courses) &&
        i.courses.length === 6 &&
        i.courses.every((c) => [-1, 0, 1].includes(c))
      : i.mode === "pattern" &&
        Array.isArray(i.patterns) &&
        i.patterns.length >= 1 &&
        i.patterns.length <= 2 &&
        i.patterns.every((p) => SLIT_FORMS.includes(p)) &&
        [1, 2].includes(i.level),
  entry: (i) =>
    Number.isInteger(i.boat) &&
    i.boat >= 3 &&
    i.boat <= 6 &&
    ["within3", "within4", "waku"].includes(i.target),
  payout: (i) => ["low", "mid", "high"].includes(i.band),
};

/** Entry の形が spec FR-5 の表どおりか */
export function isValidEntry(e) {
  return (
    e !== null &&
    typeof e === "object" &&
    typeof e.raceId === "string" &&
    TYPES.includes(e.type) &&
    e.input !== null &&
    typeof e.input === "object" &&
    INPUT_OK[e.type](e.input) &&
    typeof e.savedAt === "string" &&
    !Number.isNaN(Date.parse(e.savedAt)) &&
    typeof e.snapshot?.runId === "string" &&
    typeof e.snapshot.layerKey === "string" &&
    typeof e.result?.truncated === "boolean" &&
    Number.isInteger(e.result.n) &&
    Number.isInteger(e.result.count) &&
    Array.isArray(e.result.excluded)
  );
}

const fresh = (now) => (e) =>
  now.getTime() - Date.parse(e.savedAt) <= KEEP_DAYS * DAY_MS;

function write(storage, entries) {
  storage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, entries }));
}

/**
 * 読んで、形の違う Entry と30日を過ぎた Entry を取り除く。壊れた値や取り除いたものがあれば書き直す。
 * 例外は呼び出し側で吸収する
 */
function read(storage, now) {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return [];
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (parsed === null || parsed.v !== 1 || !Array.isArray(parsed.entries)) {
    console.error("[past-rate] 保存の中身が壊れているので作り直す");
    write(storage, []);
    return [];
  }
  const kept = parsed.entries.filter(isValidEntry).filter(fresh(now));
  if (kept.length !== parsed.entries.length) write(storage, kept);
  return kept;
}

/** 保存している Entry（読み込み時に30日を過ぎたものを消す）。使えないときは空 */
export function loadEntries({
  storage = defaultStorage(),
  now = new Date(),
} = {}) {
  if (!storage) return [];
  try {
    return read(storage, now);
  } catch (e) {
    console.error("[past-rate] 保存を読めない:", e);
    return [];
  }
}

/**
 * 結果を出したときに保存する。締切以降、または締切が分からず確定済みのレースは保存しない。
 * 書く直前に読み直してから、同じレース・同じ型を置き換える
 * @returns {boolean} 保存したか
 */
export function saveEntry(
  entry,
  { deadline, finished, now = new Date(), storage = defaultStorage() },
) {
  if (deadline && now >= deadline) return false;
  if (!deadline && finished) return false;
  if (!storage || !isValidEntry(entry)) return false;
  try {
    const kept = read(storage, now).filter(
      (e) => !(e.raceId === entry.raceId && e.type === entry.type),
    );
    const next = [...kept, entry]
      .sort((a, b) => Date.parse(a.savedAt) - Date.parse(b.savedAt))
      .slice(-MAX_ENTRIES);
    write(storage, next);
    return true;
  } catch (e) {
    console.error("[past-rate] 保存に失敗:", e);
    return false;
  }
}

/** 結果タブの振り返り: そのレースの、締切前に入れた Entry を型の順に */
export function entriesForRace(
  raceId,
  { deadline, storage = defaultStorage(), now = new Date() } = {},
) {
  return loadEntries({ storage, now })
    .filter((e) => e.raceId === raceId)
    .filter((e) => !deadline || Date.parse(e.savedAt) < deadline.getTime())
    .sort((a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type));
}

/**
 * 入力したときの比べる相手と今の layer の中身が違うか（どれか1つでも違えば）。印は layerKey（layer.js）。
 * run_id では比べない（締切前の作り直しで、行が同じでも変わる。T0-3）
 */
export const layerChanged = (entries, key) =>
  entries.some((e) => e.snapshot.layerKey !== key);
