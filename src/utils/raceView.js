/**
 * レース詳細と思考アシストの上部の切り替え（BOA-430 PR6、spec D-22・D-36 (6)）。
 * 選んだ方をこの端末に残し、次にレース詳細を開いたときに使う。保存は boatai-user: の接頭辞
 * （キャッシュの全削除で消えないユーザー保存の名前空間）。localStorage が使えない環境では保存しない
 */
export const RACE_VIEW_KEY = "boatai-user:race-view";

/** 思考アシストの公開日（YYYY-MM-DD）。「新」の札はこの日から30日だけ出す。公開前（null）は出す */
export const THINKING_ASSIST_PUBLISHED_ON = null;
const NEW_DAYS = 30;

/** @returns {"race"|"assist"|null} */
export function readRaceView() {
  try {
    const v = localStorage.getItem(RACE_VIEW_KEY);
    return v === "race" || v === "assist" ? v : null;
  } catch {
    return null;
  }
}

export function writeRaceView(view) {
  try {
    localStorage.setItem(RACE_VIEW_KEY, view);
  } catch {
    // 保存できない環境では、その場の切り替えだけ行う
  }
}

/**
 * レース詳細を開いたときに思考アシストへ移るか。ja で、URL に tab・boat の指定が無く、
 * 思考アシストを選んでいるときだけ（D-36 (6)）
 * @param {{saved: string|null, search: string, lang: string|undefined, enabled: boolean}} args
 */
export function shouldOpenAssist({ saved, search, lang, enabled }) {
  if (!enabled || lang !== "ja" || saved !== "assist") return false;
  return !hasViewQuery(search);
}

/** URL に tab・boat の指定があるか（あれば切り替えを出さず、移りもしない） */
export function hasViewQuery(search) {
  const q = new URLSearchParams(search);
  return q.has("tab") || q.has("boat");
}

/**
 * 「新」の札を出すか。まだどちらも選んでいない端末で、公開から30日以内（公開前は出す）
 * @param {{saved: string|null, today: string, publishedOn?: string|null}} args today は YYYY-MM-DD（JST）
 */
export function showNewBadge({
  saved,
  today,
  publishedOn = THINKING_ASSIST_PUBLISHED_ON,
}) {
  if (saved) return false;
  if (!publishedOn) return true;
  const days = (Date.parse(today) - Date.parse(publishedOn)) / 86400000;
  return days >= 0 && days < NEW_DAYS;
}
