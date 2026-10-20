/**
 * verify-registry.json の entries を script の名前の順に保つ（BOA-938）。
 *
 * 末尾に足す運用だと、並行する PR が同じ末尾を書き換えて衝突する（2026-10-20 だけで7回超）。
 * 名前の順に挿せば、足す位置が散らばり、離れた位置への追加は git が自動で合わせる。
 * 同じ隙間（名前が隣り合う2本）への追加だけは、今後も衝突しうる。
 *
 * 順はコードポイントの比較（ロケールに依存させない）。
 */

const byScript = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** 名前の順と重複の問題を返す（空なら問題なし） */
export function registryOrderProblems(entries) {
  const problems = [];
  const seen = new Set();
  entries.forEach((e, i) => {
    if (seen.has(e.script)) problems.push(`重複: ${e.script} が2回ある`);
    seen.add(e.script);
    const prev = entries[i - 1]?.script;
    if (prev !== undefined && byScript(prev, e.script) > 0)
      problems.push(
        `順序: ${e.script} は ${prev} より前に置く（entries は script の名前の順。\`node scripts/maintenance/run-verify-registry.js --sort\` で並べ直せる）`,
      );
  });
  return problems;
}

/**
 * ファイルの文字列のまま entries を名前の順に並べ替える（各項目の書き方は変えない）。
 * 項目は「    {」の行から「    }」か「    },」の行まで（prettier の形）。
 * 並べた結果を読み直し、名前の順に並べた entries と中身が一致しなければ例外にする
 */
export function sortRegistryText(text) {
  const lines = text.split("\n");
  const start = lines.indexOf('  "entries": [');
  const end = lines.indexOf("  ]", start);
  if (start < 0 || end < 0)
    throw new Error(
      '"entries": [ と ] の行が見つからない（prettier の形でない）',
    );
  const blocks = [];
  let current = null;
  for (const line of lines.slice(start + 1, end)) {
    if (line === "    {") current = [line];
    else if (current && (line === "    }" || line === "    },")) {
      current.push("    }");
      blocks.push(current.join("\n"));
      current = null;
    } else if (current) current.push(line);
    else throw new Error(`entries の項目の外に行がある: ${line}`);
  }
  if (current) throw new Error("entries の最後の項目が閉じていない");
  const keyed = blocks.map((b) => ({ b, script: JSON.parse(b).script }));
  const sortedBlocks = [...keyed]
    .sort((x, y) => byScript(x.script, y.script))
    .map((x) => x.b);
  const out = [
    ...lines.slice(0, start + 1),
    sortedBlocks.join(",\n"),
    ...lines.slice(end),
  ].join("\n");
  const expected = [...JSON.parse(text).entries].sort((x, y) =>
    byScript(x.script, y.script),
  );
  if (JSON.stringify(JSON.parse(out).entries) !== JSON.stringify(expected))
    throw new Error("並べ替えの結果が、名前の順に並べた entries と一致しない");
  return out;
}
