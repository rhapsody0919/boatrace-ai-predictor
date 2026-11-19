// verify-no-undef.js の許可リストの形の確かめと、違反との突き合わせ（越えの単位を分けるため移した。verify ではない）

/** 違反を「規則\tファイル」ごとにまとめる（出た順を保つ） */
function groupViolations(violations) {
  const groups = new Map();
  for (const v of violations) {
    const k = `${v.rule}\t${v.file}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(v);
  }
  return groups;
}

/** 1つの規則・ファイルの違反が許可を超えたら added の1件、超えなければ null */
function addedOf(rule, file, items, entry) {
  if (rule === "no-undef") {
    const names = new Set(entry?.names ?? []);
    const extra = items.filter((v) => !names.has(v.name));
    if (extra.length === 0) return null;
    return { rule, file, detail: "許可リストに無い名前", items: extra };
  }
  if (items.length <= (entry?.count ?? 0)) return null;
  return {
    rule,
    file,
    detail: `${items.length} 件（許可 ${entry?.count ?? 0} 件）`,
    items,
  };
}

/** 許可リストの1行が、実際の違反より多ければ stale の1件、そうでなければ null */
function staleOf(rule, file, entry, items) {
  if (rule === "no-undef") {
    const present = new Set(items.map((v) => v.name));
    const gone = entry.names.filter((n) => !present.has(n));
    if (gone.length === 0) return null;
    return { rule, file, detail: `出なくなった名前 ${gone.join(", ")}` };
  }
  if (items.length >= entry.count) return null;
  return {
    rule,
    file,
    detail: `実際 ${items.length} 件（許可 ${entry.count} 件）`,
  };
}

/**
 * 違反と許可リストを突き合わせる。検査中の規則（rules）だけを見る。
 * no-undef: { ファイル: { names, reason } }。載っていない名前が出たら added、出なくなった名前は stale
 * 他の規則: { ファイル: { count, reason } }。件数を超えたら added、満たなければ stale
 */
export function compareWithAllowlist(violations, allowRules, rules) {
  const groups = groupViolations(violations);
  const added = [];
  for (const [k, items] of groups) {
    const [rule, file] = k.split("\t");
    const a = addedOf(rule, file, items, allowRules[rule]?.[file]);
    if (a) added.push(a);
  }
  const stale = [];
  for (const rule of rules) {
    for (const [file, entry] of Object.entries(allowRules[rule] ?? {})) {
      const s = staleOf(
        rule,
        file,
        entry,
        groups.get(`${rule}\t${file}`) ?? [],
      );
      if (s) stale.push(s);
    }
  }
  return { added, stale };
}

/** 許可リストの1行の形が正しいか（reason は必須、no-undef は names の配列、他は count（1以上の整数）） */
function entryShapeOk(rule, e) {
  const reasonOk = typeof e?.reason === "string" && e.reason.trim() !== "";
  const valueOk =
    rule === "no-undef"
      ? Array.isArray(e?.names) &&
        e.names.length > 0 &&
        e.names.every((n) => typeof n === "string" && n !== "")
      : Number.isInteger(e?.count) && e.count >= 1;
  return reasonOk && valueOk;
}

/** 許可リストの形を確かめる。不正なら投げる。knownRules は --rules= で選べる規則 */
export function validateAllowlist(json, knownRules) {
  const rules = json?.rules;
  if (rules === null || typeof rules !== "object" || Array.isArray(rules)) {
    throw new Error("rules オブジェクトがありません");
  }
  for (const [rule, files] of Object.entries(rules)) {
    if (!knownRules.includes(rule)) {
      throw new Error(
        `知らない規則です: ${rule}（使えるのは ${knownRules.join(",")}）`,
      );
    }
    for (const [file, e] of Object.entries(files)) {
      if (!entryShapeOk(rule, e)) {
        throw new Error(
          `形式が不正です（no-undef は names の配列、他は count（1以上の整数）、どちらも reason が必要）: ${rule} ${file} ${JSON.stringify(e)}`,
        );
      }
    }
  }
  return rules;
}
