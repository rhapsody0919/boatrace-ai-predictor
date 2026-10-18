/**
 * 送る前のリンク先の表示の確認（sns-pdca-loop tasks 10、spec A2、ADR 0091）で見る、画面ごとの印。
 * 素材 v1 の bundle.json の screen_key がこの表のキー。印は「未ログインで開いたとき実際に見える」要素の data-testid。
 *
 * 2026-10-13 に本番の /race/2026-10-13-04-12?tab=sonar を未認証の Chromium（390×844）で開いて決めた:
 * 龍神ソナーのタブが開き、最初に「差がつく材料」が出る。条件の切り替えの箱（analogy-controls）と条件のカード（analogy-fact-card）が見える。
 * 段の表示（analogy-stage-chip）は展示のデータが入ると切り替えのボタンに変わって消えるので、印にしない（2026-10-17、
 * 展示の後に送るレースの投稿が送る前の確認で止まるため）。箱は展示の前後どちらでも出る
 * 画面の data-testid を変えるときは、この表も変える（verify-sns-headless.js が表の形を確かめる）
 */
export const SCREEN_MARKERS = {
  // レース詳細の龍神ソナーのタブ（リンクは /race/{race_id}?tab=sonar）
  "race-sonar": [
    '[data-testid="analogy-controls"]',
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
