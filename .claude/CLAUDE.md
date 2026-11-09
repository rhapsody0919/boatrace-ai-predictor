# boatAI — Claude Code の入口

@../AGENTS.md

上が作り手の決まりの正本。ここには Claude に固有の物だけを書く。

- hook（`.claude/settings.json`）: SessionStart で枝と未コミットの変更を出す。master のメインの作業ツリーでの編集・鍵のファイルへの書き込み・条件を満たさない `gh pr merge`・Environments の承認と db-apply の起動・`claude/` 以外の push を止める。編集ごとの lint は無く、`npm run verify` で差分にまとめて掛ける
- 枝は `claude/` で始める。push・PR は作成の App（ryujin-maker）の名義で `node scripts/maintenance/ryujin-maker-token.js -- git push …`・`-- gh pr create …`。鍵が置かれた後は `--admin` を使わない
- 分野の決まりは `.claude/rules/`（`paths` に当たるファイルを触ったときだけ読まれる）。常時の rules は置かない
- skills: オーナーと対話するセッション（報告・確認・マージ・サブエージェントの選び方・セッションの始めの確認）は `owner-session`、オーケストレーターは `/orchestrate`、「議論して」は `discussion-panel`
- 権限: `.claude/settings.json` の allow・deny。使い捨ての作り手は起動の引数（`--allowedTools`・`--permission-mode`）で決める
- この入口は30行未満を保つ（`scripts/maintenance/verify-agents-entry.js` が見る）
