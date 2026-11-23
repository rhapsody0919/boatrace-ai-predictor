/**
 * マージした PR に紐づく Linear の票を閉じてよいかの判定（純関数、BOA-1711、hq 閉鎖 R7）。
 * 非公開の hq の linear-close-merged.py・maker-merge の判定を写した。書く口は scripts/linear/close-merged-ticket.js。
 *
 * 閉じる票は PR の枝の BOA-N 1枚、枝に無ければ題の先頭の BOA-N 1枚だけ（題の途中の BOA-N は親・参照なので閉じない）。
 * 迷う物は閉じない（部分実装らしい・子の票が開いている・同じ票の開いた PR がある・票が多すぎる）。
 */

const BRANCH_TICKET_RE = /boa-(\d+)/i;
// 先頭の記号・空白だけを読み飛ばす（字と数字は飛ばさない。JS の \W は日本語の字も含むので使わない）
const TITLE_HEAD_TICKET_RE = /^[^\p{L}\p{N}]*BOA-(\d+)/iu;
// 題・本文にこの語があれば、その PR は票の一部だけかもしれないので閉じない（hq の PARTIAL_RE と同じ）
export const PARTIAL_RE =
  /続き|続く|残りは|前半|後半|第\s*[0-9一二三四五]+\s*[段弾回]|[0-9一二三]\s*本目|part\s*\d|phase\s*\d|follow-?up|\bWIP\b|暫定|次の\s*PR|別の\s*PR|(?<![\d/])[1-9]\/[2-9](?![\d/])/i;
// 1本の PR の題・枝に票がこれより多ければ閉じない（目安・根拠なし。hq と同じ）
export const MANY = 3;

/** この PR が閉じてよい票（0か1枚） */
export function ticketsFor(title, ref) {
  const m = BRANCH_TICKET_RE.exec(ref ?? "") ?? TITLE_HEAD_TICKET_RE.exec(title ?? "");
  return m ? [`BOA-${m[1]}`] : [];
}

/** 題と枝に出る票の数（MANY の判定用） */
export function countTickets(title, ref) {
  const all = `${title ?? ""} ${ref ?? ""}`.match(/boa-\d+/gi) ?? [];
  return new Set(all.map((s) => s.toUpperCase())).size;
}

const closed = (state) => ["completed", "canceled"].includes(state?.type);

/**
 * 判定。返す: { action: "close" | "archive" | "skip" | "keep", reason }
 *   archive: もう閉じている（Linear の GitHub 連携が先に Done にした等）がアーカイブされていない。skip: 閉じてアーカイブ済み。keep: 閉じない（理由をログと票のコメントに残す側の判断は呼び手）
 * @param {string} ident 票の番号（BOA-N）
 * @param {{state?: {type?: string}, archivedAt?: string|null, children?: {nodes?: Array<{identifier: string, state?: {type?: string}}>}}} issue
 * @param {Array<{number: number, title?: string, head?: {ref?: string}}>} openPrs 今開いている PR
 * @param {{title?: string, body?: string, head?: {ref?: string}}} pr マージした PR
 */
export function decide(ident, issue, openPrs, pr) {
  if (closed(issue?.state))
    return issue?.archivedAt
      ? { action: "skip", reason: "票はもう閉じてアーカイブ済み" }
      : { action: "archive", reason: "票は閉じているがアーカイブされていない" };
  const kids = (issue?.children?.nodes ?? []).filter((k) => !closed(k.state));
  if (kids.length > 0)
    return {
      action: "keep",
      reason: `開いた子の票がある（${kids.map((k) => k.identifier).join(", ")}）`,
    };
  const mine = openPrs.filter((p) =>
    ticketsFor(p.title, p.head?.ref).includes(ident),
  );
  if (mine.length > 0)
    return {
      action: "keep",
      reason: `同じ票の開いた PR がある（#${mine.map((p) => p.number).join(", #")}）`,
    };
  const m = PARTIAL_RE.exec(`${pr?.title ?? ""}\n${pr?.body ?? ""}`);
  if (m)
    return {
      action: "keep",
      reason: `題・本文に続きを示す語「${m[0]}」がある`,
    };
  const n = countTickets(pr?.title, pr?.head?.ref);
  if (n > MANY)
    return { action: "keep", reason: `題・枝に票が ${n} 件ある` };
  return { action: "close", reason: "条件を満たす" };
}
