/**
 * 送る前のリンク先の表示の確認（sns-pdca-loop tasks 10、spec A2、ADR 0091）で見る、画面ごとの印。
 * 素材 v1 の bundle.json の screen_key がこの表のキー。印は「未ログインで開いたとき実際に見える」要素の data-testid。
 *
 * 2026-10-13 に本番の /race/2026-10-13-04-12?tab=sonar を未認証の Chromium（390×844）で開いて決めた:
 * 龍神ソナーのタブが開き、最初に「差がつく材料」が出る。段の表示（analogy-stage-chip）と条件のカード（analogy-fact-card）が見える。
 * 画面の data-testid を変えるときは、この表も変える（verify-sns-headless.js が表の形を確かめる）
 */
export const SCREEN_MARKERS = {
  // レース詳細の龍神ソナーのタブ（リンクは /race/{race_id}?tab=sonar）
  "race-sonar": [
    '[data-testid="analogy-stage-chip"]',
    '[data-testid="analogy-fact-card"]',
  ],
  // 本日のデータ一覧（リンクは /today）。見出しと、一覧が公開されたときだけ出る用語の節（未公開の日は出ない）
  today: [
    '[data-testid="morning-digest-title"]',
    '[data-testid="morning-digest-notes"]',
  ],
};

// リンク先の URL に付けてよいタブ（?tab=）。UTM 以外で許すクエリはこれだけ
export const SCREEN_TABS = ["sonar"];
