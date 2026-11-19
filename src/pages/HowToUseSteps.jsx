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
            <strong>AI予想</strong>: 展開予測とイン崩れ注意度（ステップ5）
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
        <strong>「AI予想」</strong>
        を開くと、AIによる2種類の分析結果が確認できます。
      </p>
      <div className="step-detail">
        <h4>💡 展開予測</h4>
        <ul>
          <li>
            1マーク（最初のターン）の攻防で
            <strong>どの艇がどの決まり手で1着になりそうか</strong>
            を、確率付きの上位パターンとして提示します
          </li>
          <li>
            実測的中率は
            <strong>約8割</strong>
            （上位パターンのいずれかが実際の1着コースと一致すれば的中）。会場によって的中率に差があり、実績は「成績」ページで確認できます
          </li>
        </ul>
      </div>
      <div className="step-detail">
        <h4>💡 イン崩れ指数</h4>
        <ul>
          <li>
            1号艇（インコース）が
            <strong>崩れやすいかどうか</strong>
            を、過去90日・同会場のレースと比較した相対的な指数（パーセンタイル）で示します
          </li>
          <li>
            「イン崩れ注意（高）」ラベルのレースは、実際にどの程度崩れているかの実測値も確認できます
          </li>
        </ul>
      </div>
      <div className="example-box">
        <p className="example-title">📌 例</p>
        <p>
          展開予測で「1コース 逃げ 39%」「3コース まくり
          10%」と出ていれば、1コースを軸にしつつ3コースも警戒する、といった読み方ができます
        </p>
      </div>
    </>
  );
}

function HowToStepResultsCheckContent() {
  return (
    <>
      <p>レース終了後、AIの分析が的中だったかを確認できます。</p>
      <div className="step-detail">
        <h4>💡 実績の確認方法</h4>
        <ul>
          <li>
            <strong>各レースの「AI予想」タブ</strong>:
            そのレースの展開予測が的中したかを表示（結果が確定したレースを開くと出ます）
          </li>
          <li>
            <strong>「的中」タブ</strong>（/hit-races）:
            過去14日間で展開予測が的中したレース一覧を会場別に表示
          </li>
          <li>
            <strong>「成績」タブ</strong>（/accuracy）:
            展開予測の実測的中率を、全体・会場別で公開
          </li>
        </ul>
      </div>
      <div className="tip-box">
        <h4>📊 実績の見方</h4>
        <p>
          展開予測の実測的中率は
          <strong>会場によって差があります</strong>
          （例:
          ある会場は9割超、別の会場は7割弱）。よく使う会場の実績を「成績」ページで確認してから活用すると、精度への理解が深まります。
        </p>
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
