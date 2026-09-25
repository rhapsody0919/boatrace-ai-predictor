#!/usr/bin/env node
/**
 * verify-agent-definitions.js - サブエージェント定義（.claude/agents/）の整合を検証する。
 *
 * 背景: 2026-09-25、PR #829 でサブエージェント定義3本を新設し、その使い分けを
 * `.claude/CLAUDE.md`「サブエージェントの使い分け」に散文で書いた。しかし
 * ADR-0072 / ADR-0075 が実測で示したとおり、このプロジェクトでは散文ルールは守られない
 * （fixコミット169件のうち「防ぐ仕組みが無かった」が142件、CIで止まった例は0件）。
 * 同じPRで、同一概念が .claude/commands/ の3ファイルに複製されていて片方だけ直しかけた
 * 事故も起きている。散文で書いた約束のうち機械で判定できるものをここに落とす。
 *
 * 検証する4点:
 *   1. .claude/settings.json に CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS が再混入していないこと
 *      （teammateはworktree分離されないため、「新規タスクはworktreeで隔離」という
 *      Git安全策と両立しない。ADR外だが CLAUDE.md「サブエージェントの使い分け」に理由あり）
 *   2. .claude/agents/*.md のフロントマターが name / description を持ち、
 *      name がファイル名と一致し、ハイフン区切りであること
 *      （ハイフン必須の理由は AGENT_NAME_PATTERN のコメント参照）
 *   3. .claude/CLAUDE.md の「サブエージェントの使い分け」表と、実ファイルが一致すること
 *      （verify-registry.json と同じ台帳方式。定義を足して表に書き忘れる／
 *      表にあるが定義が無い、の双方を止める）
 *   4. ドキュメント中のエージェント参照が実在すること
 *      - `<name>` サブエージェント という書き方
 *      - .claude/agents/<name>.md というパス参照
 *
 * 既存の乖離は ALLOWED_* に理由付きで凍結し、新規だけを止める
 * （verify-migration-numbers.js の ALLOWED_DUPLICATES と同じ方式）。
 *
 * 使い方: node scripts/maintenance/verify-agent-definitions.js
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const AGENTS_DIR = path.join(ROOT, ".claude/agents");
const CLAUDE_MD = path.join(ROOT, ".claude/CLAUDE.md");
const SETTINGS_JSON = path.join(ROOT, ".claude/settings.json");
const TABLE_HEADING = "### サブエージェントの使い分け";

/**
 * 設定ファイルに置いてはいけない環境変数。
 * settings.local.json は gitignore 下の個人設定なので対象外（リポジトリの約束ではない）。
 */
const FORBIDDEN_ENV_KEYS = [
  {
    key: "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS",
    why: "teammateは自動でworktree分離されず、Agent tool呼び出しでisolationを渡すとteammateにならないため、「新規タスクはworktreeで隔離する」というGit安全策と両立しない。デスクトップアプリでは機能自体が非対応（.claude/CLAUDE.md「サブエージェントの使い分け」参照）",
  },
];

/**
 * 実在しないエージェント名を参照していても許す既存の記述。
 * 新しく足す場合は「なぜ定義化しないのか」を reason に書くこと。
 */
const ALLOWED_UNDEFINED_AGENTS = [
  // 例: { name: "foo-reviewer", reason: "..." }
];

/**
 * エージェント名に許す形。ハイフン区切りを必須にしている。
 * 検証4の参照検査は「`名前` サブエージェント」という書き方を正規表現で拾うが、
 * 単語1つの名前まで拾おうとすると「`grep` エージェント」のような普通の文に
 * 誤反応する。名前の側をハイフン必須に寄せることで、参照検査が全ての定義を
 * 漏れなく対象にできる（ハイフン無しの名前を許すと、その名前だけ参照切れを
 * 検知できない死角になる）。
 */
const AGENT_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;

/**
 * .claude/agents/ に置いてよい、エージェント定義ではないファイル。
 * 定義として扱うとフロントマター必須の検査に引っかかる。
 */
const NON_DEFINITION_FILES = new Set(["README.md"]);

/** ドキュメント中の参照を探す対象。サブディレクトリも辿る */
const SCAN_DIRS = [path.join(ROOT, ".claude"), path.join(ROOT, "docs")];
/** 走査から外すディレクトリ名（worktreeは他セッションの作業ツリー、archiveは歴史的記録） */
const SKIP_DIRS = new Set(["worktrees", "archive", "node_modules"]);

const problems = [];
const notes = [];

/** .md を再帰的に集める */
async function collectMarkdown(dir) {
  const found = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      found.push(...(await collectMarkdown(path.join(dir, e.name))));
    } else if (e.isFile() && e.name.endsWith(".md")) {
      found.push(path.join(dir, e.name));
    }
  }
  return found;
}

/** --- で挟まれたYAMLフロントマターから key: value を素朴に拾う */
function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  const body = text.slice(4, end + 1);
  const fields = {};
  for (const line of body.split("\n")) {
    // ネストしたYAML（hooks: 等）はここでは扱わない。先頭カラムの key: value のみ
    const m = /^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (m) fields[m[1]] = m[2].trim();
  }
  return fields;
}

// ---- 1. 禁止された環境変数 ----
let settingsRaw = "";
try {
  settingsRaw = await fs.readFile(SETTINGS_JSON, "utf8");
  JSON.parse(settingsRaw); // 構文が壊れていたらここで落とす
} catch (err) {
  problems.push(`.claude/settings.json を読めません: ${err.message}`);
}
for (const { key, why } of FORBIDDEN_ENV_KEYS) {
  if (settingsRaw.includes(key)) {
    problems.push(
      `.claude/settings.json に ${key} があります。この設定は置かない約束です。理由: ${why}`,
    );
  }
}

// ---- 2. 定義ファイルのフロントマター ----
let agentFiles = [];
try {
  agentFiles = (await fs.readdir(AGENTS_DIR))
    .filter((f) => f.endsWith(".md") && !NON_DEFINITION_FILES.has(f))
    .sort();
} catch {
  problems.push(
    `.claude/agents/ がありません。サブエージェント定義の置き場です（.claude/CLAUDE.md「サブエージェントの使い分け」参照）`,
  );
}

const definedNames = new Set();
for (const file of agentFiles) {
  const text = await fs.readFile(path.join(AGENTS_DIR, file), "utf8");
  const fm = parseFrontmatter(text);
  if (!fm) {
    problems.push(
      `.claude/agents/${file}: 先頭が --- で始まるYAMLフロントマターになっていません`,
    );
    continue;
  }
  const expected = file.replace(/\.md$/, "");
  if (!fm.name) {
    problems.push(`.claude/agents/${file}: フロントマターに name がありません`);
  } else if (fm.name !== expected) {
    problems.push(
      `.claude/agents/${file}: name="${fm.name}" がファイル名（${expected}）と一致しません。Agent toolはファイル名ではなく name で解決するため、食い違うと呼び出せません`,
    );
  } else if (!AGENT_NAME_PATTERN.test(fm.name)) {
    problems.push(
      `.claude/agents/${file}: name="${fm.name}" はハイフン区切りの小文字（例: code-reviewer）にしてください。ハイフンの無い名前は、このスクリプトの参照切れ検査（検証4）の対象外になり、削除・改名しても気づけなくなります`,
    );
  } else {
    definedNames.add(fm.name);
  }
  if (!fm.description) {
    problems.push(
      `.claude/agents/${file}: フロントマターに description がありません。description は「いつこのエージェントに委譲するか」の判断に使われる必須フィールドです`,
    );
  }
}

// ---- 3. CLAUDE.md の使い分け表と実ファイルの突き合わせ ----
let claudeMd = "";
try {
  claudeMd = await fs.readFile(CLAUDE_MD, "utf8");
} catch (err) {
  problems.push(`.claude/CLAUDE.md を読めません: ${err.message}`);
}

const tableNames = new Set();
const headingIndex = claudeMd.indexOf(TABLE_HEADING);
if (headingIndex === -1) {
  problems.push(
    `.claude/CLAUDE.md に「${TABLE_HEADING}」の節がありません。サブエージェントの台帳はこの節の表です`,
  );
} else {
  // 次の見出し（## または ---）までを節の範囲とする
  const rest = claudeMd.slice(headingIndex + TABLE_HEADING.length);
  const endMatch = /\n(?:#{2,3} |---\n)/.exec(rest);
  const section = endMatch ? rest.slice(0, endMatch.index) : rest;
  for (const line of section.split("\n")) {
    const m = /^\|\s*`([a-z][a-z0-9-]*)`\s*\|/.exec(line);
    if (m) tableNames.add(m[1]);
  }
  if (tableNames.size === 0) {
    problems.push(
      `.claude/CLAUDE.md「${TABLE_HEADING}」の表からエージェント名を1件も読み取れません。各行を「| \`name\` | 用途 | 呼ぶタイミング |」の形式で書いてください`,
    );
  }
  for (const name of definedNames) {
    if (!tableNames.has(name)) {
      problems.push(
        `.claude/agents/${name}.md が「${TABLE_HEADING}」の表にありません。定義だけ増えて使い分けが書かれないと、誰も呼ばないエージェントになります`,
      );
    }
  }
  for (const name of tableNames) {
    if (definedNames.has(name)) continue;
    // ファイルはあるが name が食い違っている場合、「ファイルが無い」と言うと
    // 探しに行った人が混乱する。すでに上で name 不一致を報告済みなので触れない
    if (agentFiles.includes(`${name}.md`)) continue;
    problems.push(
      `「${TABLE_HEADING}」の表にある \`${name}\` の定義ファイル（.claude/agents/${name}.md）がありません`,
    );
  }
}

// ---- 4. ドキュメント中の参照が実在するか ----
const allowedUndefined = new Map(
  ALLOWED_UNDEFINED_AGENTS.map((a) => [a.name, a.reason]),
);
const NAME_REF = /`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`\s*(?:サブ)?エージェント/g;
const PATH_REF = /\.claude\/agents\/([a-z0-9-]+)\.md/g;

let refCount = 0;
for (const dir of SCAN_DIRS) {
  for (const file of await collectMarkdown(dir)) {
    const rel = path.relative(ROOT, file);
    const lines = (await fs.readFile(file, "utf8")).split("\n");
    lines.forEach((line, i) => {
      for (const re of [NAME_REF, PATH_REF]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line)) !== null) {
          const name = m[1];
          refCount += 1;
          if (definedNames.has(name)) continue;
          if (allowedUndefined.has(name)) {
            notes.push(
              `${rel}:${i + 1} の \`${name}\` は定義がありませんが凍結済み: ${allowedUndefined.get(name)}`,
            );
            continue;
          }
          problems.push(
            `${rel}:${i + 1} が存在しないエージェント \`${name}\` を参照しています。定義を作るか、参照を消すか、意図的なら ALLOWED_UNDEFINED_AGENTS に理由付きで登録してください`,
          );
        }
      }
    });
  }
}

// ---- 結果 ----
if (problems.length > 0) {
  console.error(
    `NG: サブエージェント定義の整合に問題が${problems.length}件あります\n`,
  );
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "\n詳細: .claude/CLAUDE.md「サブエージェントの使い分け」/ .claude/agents/",
  );
  process.exit(1);
}

for (const n of notes) console.log(`WARN: ${n}`);
console.log(
  `OK: サブエージェント定義${definedNames.size}件が台帳と一致し、参照${refCount}件がすべて実在します（${[...definedNames].sort().join(", ")}）`,
);
