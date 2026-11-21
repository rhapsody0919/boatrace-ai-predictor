/** 値を取るオプション。次のトークンは値であって位置引数ではない。 */
const VALUE_OPTIONS = new Set([
  "-b",
  "--body",
  "-F",
  "--body-file",
  "-t",
  "--subject",
  "--match-head-commit",
  "--author-email",
  "-R",
  "--repo",
]);
/** 番号がシェルの展開で決まる印（変数・コマンド置換・xargs/find の置換文字列）。 */
const SHELL_EXPANSION = /[$`{}]/;
/** gh が位置引数として受け付けるブランチ名（`OWNER:BRANCH` を含む）。 */
const BRANCH_NAME = /^[\w./:-]+$/;
/** 引数を標準入力などから補って別のコマンドを起動するコマンド。 */
const ARG_FEEDERS = /(?:^|\s)(?:xargs|parallel)(?=\s|$)|\s-exec(?:dir)?(?=\s)/;
/** 作業ディレクトリやブランチを変えるコマンド。この後の番号なしの merge は、フックからは対象が分からない。 */
const CHANGES_CONTEXT = /\b(?:cd|pushd)\b|\bgit\s+(?:checkout|switch)\b/;

/** gh pr merge より前でループの本体が閉じずに続いているか（`for ...; do gh pr merge`）。 */
function insideLoop(before) {
  const count = (re) => (before.match(re) ?? []).length;
  return (
    /\b(?:for|while|until)\b/.test(before) &&
    count(/\bdo\b/g) > count(/\bdone\b/g)
  );
}

/**
 * 1つの `gh pr merge` の引数部分から、マージ対象を読む。
 *   { kind: "number", pr }   番号・PRのURL
 *   { kind: "branch", name } ブランチ名（gh でそのブランチのPRに解決する）
 *   { kind: "current" }      位置引数なし（現在のブランチのPR）
 *   { kind: "unresolved" }   番号がシェルの展開で決まる等、フックの時点では確定できない
 * --auto / --disable-auto があれば、上に auto: true が付く。
 *
 * gh は位置引数の位置を問わないので `gh pr merge --merge 123` も有効。先頭だけ見ると
 * 番号を取り逃がし、カレントブランチの別のPRのチェック結果で判定してしまう。
 */
function parseMergeArgs(args, currentUnknown) {
  // 引用符で囲まれた値は中に空白を含む（`-b "fix 42"`）。そのまま空白で割ると
  // 値の断片を位置引数と読んでしまうので、1トークンに潰してから割る。
  // ただし二重引用符の中の $ や ` は展開されるので、潰しても展開の印は残す（`"$PR"` を見逃さない）。
  const tokens = args
    .replace(/"([^"]*)"|'([^']*)'/g, (_, dq, sq) => {
      const value = dq ?? sq;
      // 空の値（-b ""）を消すと、次の番号が -b の値に読まれてしまう
      if (value && !/\s/.test(value)) return value;
      return dq !== undefined && SHELL_EXPANSION.test(value)
        ? "$__quoted__"
        : "__quoted__";
    })
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  // --auto（自動マージの予約）・--disable-auto（予約の取り消し）は、その場ではマージしない
  let auto = false;
  let target = null;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.startsWith("-")) {
      const [name] = token.split("=");
      if (name === "--auto" || name === "--disable-auto") auto = true;
      // `-b text` のように値が次のトークンに来る場合、その値を位置引数と読まない
      if (VALUE_OPTIONS.has(name) && !token.includes("=")) i += 1;
      continue;
    }
    // 位置引数は最初の1つだけ読む。後ろのオプション（--auto 等）は読み続ける
    if (target) continue;
    target = readPositional(token);
  }
  // 位置引数なしは「現在のブランチのPR」だが、ループの本体の中や cd・git switch の後では、
  // フックが見る現在のブランチと実際に merge が走るブランチが一致しない
  target ??= currentUnknown ? { kind: "unresolved" } : { kind: "current" };
  return auto ? { ...target, auto } : target;
}

/** 位置引数1つをマージ対象として読む（形は parseMergeArgs）。 */
function readPositional(token) {
  if (SHELL_EXPANSION.test(token)) return { kind: "unresolved" };
  const byNumber = token.match(/^(\d+)$/);
  if (byNumber) return { kind: "number", pr: byNumber[1] };
  const byUrl = token.match(/^https?:\/\/\S*?\/pull\/(\d+)\/?$/);
  if (byUrl) return { kind: "number", pr: byUrl[1] };
  if (BRANCH_NAME.test(token)) return { kind: "branch", name: token };
  return { kind: "unresolved" };
}

/** コマンド中のすべての `gh pr merge` について、マージ対象を読む（形は parseMergeArgs）。 */
export function extractMergeTargets(command) {
  const targets = [];
  for (const m of command.matchAll(/\bgh\s+pr\s+merge\b([^\n;&|]*)/g)) {
    const before = command.slice(0, m.index);
    // 同じ単純コマンドの中で gh より前にある部分（`echo 1 | xargs -n1 gh pr merge` の ` xargs -n1 `）。
    // xargs 等は位置引数を後から足すので、書かれた引数からは番号が分からない。
    const lead = before.slice(before.search(/[^\n;&|]*$/));
    targets.push(
      ARG_FEEDERS.test(lead)
        ? { kind: "unresolved" }
        : parseMergeArgs(
            m[1],
            insideLoop(before) || CHANGES_CONTEXT.test(before),
          ),
    );
  }
  return targets;
}

/** コマンドが worktree ごと消す形の `--delete-branch` / `-d` を含むか。 */
export function deletesBranch(command) {
  if (/--delete-branch\b/.test(command)) return true;
  // pflag はショートハンドの結合を許す（-md は -m -d と同じ）。`-d` 単独だけを見ると
  // 取りこぼし、worktree ごと消えるのを防げない。d を含むショートハンドは -d だけ。
  return /(?:^|\s)-[a-zA-Z]*d[a-zA-Z]*(?=\s|$)/.test(command);
}
