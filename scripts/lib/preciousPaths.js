/**
 * gitに入らない「取り直しが高くつくデータ」の置き場所。
 *
 * これらは .gitignore 対象なので、ディレクトリごと消えるとgitからは復元できない。
 * 2026-09-25に `gh pr merge --delete-branch` が worktree ディレクトリごと削除し、
 * 公式サイトから数夜かけて取得した K/B ファイル約2,730日分を実際に失っている。
 * gh は「ローカルとリモートのブランチを削除する」としか説明せず、worktree を消すことは
 * ヘルプにも書かれていない（gh 2.99.0で確認）。しかも worktree の中から実行した場合は
 * 「消せないので手動で」と止まり、外から実行した場合だけ消えるという直感に反する挙動。
 *
 * 追加・変更したら .gitignore 側にも同じパスが要る。ズレは
 * scripts/maintenance/verify-precious-paths.js が検査する。
 */

/** 取り直しに実時間（外部サイトへの再取得・再学習）がかかるデータ。 */
export const PRECIOUS_PATHS = [
  "data/kb-archive",
  "data/fan-archive",
  "data/monthly-schedule-archive",
  "data/motor-pretest-archive",
  "data/racelist-backfill-archive",
  "data/ml",
  "sns-video-studio/archive",
]

/**
 * リポジトリ外の退避先。worktree が消えても残る場所に同じものを持つ。
 * 絶対パスを持たせたくないので、ホームからの相対で表す。
 */
export const BACKUP_DIR_FROM_HOME = "boatrace-archive-backup"
