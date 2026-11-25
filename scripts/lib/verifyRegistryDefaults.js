/**
 * verify-registry.json に行の無い verify-*（scripts/maintenance/ 直下）を、既定で tier=ci の項目として足す純関数
 * （ADR-0072 の 2026-11-25 の追記、設計 docs/design/harness-migration/dev-friction-2026-11-25.md §1b）。
 *
 * 新しい verify のたびに名前の順の台帳へ5行足すと、名前の近い verify を並走で足した PR が隣の行で衝突し、作り直しが出ていた（#3410）。
 * 既定を ci にするのは厳しい側（分類が漏れても CI で回る）。manual・args・timeoutSec・runner が要る物だけ台帳に行を足す。
 * manual へ下げる道は台帳の行だけなので、guard_weakening・pr-lane の見張りは今のまま効く。
 * guards（何を守るか）は、ファイルの頭の注釈の最初の文の行を使う。注釈が無ければ問題に出す。
 */

const SKIP = /^(?:#!|\/\*\*?\s*$|\*\/|"use strict")/;

/**
 * ファイルの本文の頭の注釈から、最初の文の行（無ければ null）
 * @param {string} text
 */
export function headGuards(text) {
  for (const raw of text.split("\n").slice(0, 30)) {
    const line = raw.trim();
    if (line === "" || SKIP.test(line)) continue;
    const m = /^(?:\/\/+|\*|#)\s*(.*)$/.exec(line);
    if (!m) return null; // 注釈の前にコードが来た
    const body = m[1].trim();
    if (body !== "") return body;
  }
  return null;
}

/**
 * 台帳の項目に、行の無い verify を既定の ci の項目として足す。
 * @param {{script: string}[]} entries 台帳の entries
 * @param {string[]} files scripts/maintenance/ 直下の verify-*（.js・.mjs・.cjs・.sh）
 * @param {(file: string) => string} readText ファイルの本文を読む口
 * @returns {{entries: object[], implicit: string[], problems: string[]}}
 */
export function withDefaultEntries(entries, files, readText) {
  const registered = new Set(entries.map((e) => e.script));
  const implicit = files.filter((f) => !registered.has(f));
  const problems = [];
  const added = implicit.flatMap((script) => {
    const guards = headGuards(readText(script));
    if (!guards) {
      problems.push(
        `頭の注釈なし: ${script} は台帳に行が無いので既定で tier=ci として回すが、何を守るかの注釈（ファイルの頭の1行目）が無い。注釈を書くか、台帳に行を足す`,
      );
      return [];
    }
    return [{ script, tier: "ci", guards, implicit: true }];
  });
  return { entries: [...entries, ...added], implicit, problems };
}
