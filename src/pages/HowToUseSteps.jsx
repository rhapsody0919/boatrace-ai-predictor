function HowToStepTabDeepDiveContent() {
  return (
    <>
      <p>
        データ出走表の上にタブが並んでいます。見たい切り口に合わせて切り替えてください。発走前は
        <strong>7つ</strong>、レースが確定すると「結果」が加わって
        <strong>8つ</strong>
        になります。スマホでは4つほどしか画面に入らないため、
        <strong>タブの並びを横にスワイプ</strong>
        すると残りが出てきます（右端の「›」でも送れます）。
      </p>
      <div className="step-detail">
        <h4>💡 タブの内容（左から順）</h4>
        <p className="step-note">
          前半の4つは<strong>6艇をまとめて見る</strong>
          タブ、後半は<strong>艇を1つ選んで掘る</strong>タブです。
        </p>
        <ul>
          <li>
            <strong>基本情報</strong>:
            選手ごとの勝率・2連対率・3連対率・平均STを、会場（全国/当地）・グレード（全レース/一般戦/SG・G1）・期間（今期/直近3ヶ月/直近1ヶ月）で切り替えて比較。走数（n）も併記
          </li>
          <li>
            <strong>イン崩れ</strong>: イン崩れ注意度・出現パターン・過去に発生した割合（ステップ5）
          </li>
          <li>
            <strong>今節</strong>:
            出走6選手の今節の得点率・節内順位・準優の目安までの必要得点。
            <strong>勝負駆け</strong>がかかっているのが誰かを読む場所です
          </li>
          <li>
            <strong>直前情報</strong>: 展示タイム・気象・ピットレポート
          </li>
          <li>
            <strong>枠別情報</strong>: 本日入る想定コースでの成績に加え、
            <strong>ST考察</strong>
            （安定率・抜出・出遅率を同じコース・同じ級別の平均との差つきで表示）と
            <strong>逃げシミュレーション</strong>
            （1コースが逃げたとき2着に来たコースの割合と2連単の出現率）
          </li>
          <li>
            <strong>モータ情報</strong>: この会場のモーターの成績・調子
          </li>
          <li>
            <strong>オッズ一覧</strong>: 発売中のオッズ
          </li>
          <li>
            <strong>結果</strong>:
            レース確定後の着順と配当。確定するまでこのタブは出ません
          </li>
        </ul>
      </div>
      <div className="tip-box">
        <h4>📝 見方のコツ</h4>
        <p>
          レース確定後に開くと
          <strong>「結果」タブが最初に選ばれます</strong>
          。発走前は「基本情報」から始まります。まず基本情報で6艇の力関係を掴み、節の後半なら「今節」で勝負駆けを確認、締切が近ければ「直前情報」で展示タイムを見る、という順番がおすすめです。
        </p>
      </div>
    </>
  );
}

function HowToStepTenkaiInKuzureContent() {
  return (
    <>
      <p>
        タブの
        <strong>「イン崩れ」</strong>
        を開くと、1号艇が1着を逃しやすいレースかどうかを確認できます。
      </p>
      <div className="step-detail">
        <h4>💡 イン崩れ注意度</h4>
        <ul>
          <li>
            1号艇の全国勝率と、他の艇で一番高い全国勝率の差（勝率差）が
            <strong>同じくらいの全国の過去レース</strong>
            で、1号艇が1着を逃した割合です（準優勝戦・優勝戦は分けて数えます）
          </li>
          <li>
            割合で3段に分けます: <strong>崩れやすい</strong>（55%以上）・
            <strong>中くらい</strong>（35〜54%）・<strong>堅め</strong>
            （35%未満）。そのレースの確率ではなく、過去の実績の割合です
          </li>
        </ul>
      </div>
      <div className="step-detail">
        <h4>💡 出現パターンと過去に発生した割合</h4>
        <ul>
          <li>
            同じタブで、1号艇が1着になったときの出現パターンと、自分の見立て（着順・展開など）が過去にどれくらい起きたかを確認できます
          </li>
        </ul>
      </div>
      <div className="example-box">
        <p className="example-title">📌 例</p>
        <p>
          「崩れやすい 65%」と出ていれば、勝率差が同じくらいの過去のレースでは、1号艇が1着を逃したのが約3回に2回だった、という意味です
        </p>
      </div>
    </>
  );
}

function HowToStepResultsCheckContent() {
  return (
    <>
      <p>注意度の段ごとに、実際に1号艇が1着を逃した割合を確認できます。</p>
      <div className="step-detail">
        <h4>💡 実績の確認方法</h4>
        <ul>
          <li>
            <strong>「成績」ページ</strong>（/accuracy）:
            崩れやすい・中くらい・堅めの段ごとに、実際に1号艇が1着を逃した割合・件数・ぶれ幅を表示。公開後の実績と、公開前の検証（2025年6月〜2026年10月）を切り替えられます
          </li>
        </ul>
      </div>
      <div className="step-detail">
        <h4>⚠️ 重要な注意事項</h4>
        <div className="warning-box">
          <p>
            <strong>龍神レーダーは分析情報のみを提供しています</strong>
          </p>
          <p>
            舟券の購入は
            <a
              href="https://www.boatrace.jp/"
              target="_blank"
              rel="noopener noreferrer"
            >
              公式サイト
            </a>
            でご確認ください。分析データは参考情報としてご活用ください。
          </p>
        </div>
      </div>
    </>
  );
}

export {
  HowToStepTabDeepDiveContent,
  HowToStepTenkaiInKuzureContent,
  HowToStepResultsCheckContent,
};
