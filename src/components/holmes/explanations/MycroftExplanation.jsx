import "./ExplanationSection.css";
import mycroftModel from "../../../../data/mycroft/model.json";
import MycroftDiagram from "./MycroftDiagram";

const MAX_HISTORY = mycroftModel.max_history ?? 32;

function MycroftSummary() {
  return (
    <p className="explanation-summary">
      各選手の過去{MAX_HISTORY}走を時系列としてTransformerに入力し、
      Self-attentionでフォームの変化・節間の調子・相手文脈を捕捉します。
      さらに6艇の「フォーム」同士を相互作用させ、
      誰が誰に沈められるかというレース展開まで含めて順位を予測します。
    </p>
  );
}

function MycroftKeyPoints() {
  return (
    <ul className="explanation-key-points">
      <li>
        <span style={{ color: "var(--brand-accent-secondary)" }}>
          Self-attention
        </span>{" "}
        により、
        「3節前から調子が落ちている」「特定のコースで強い」という時系列パターンを自動発見
      </li>
      <li>
        集約統計（平均着順など）では失われる「最近の変化」と「流れ」を学習
      </li>
      <li>
        6艇のフォームに{" "}
        <span style={{ color: "var(--brand-accent-secondary)" }}>
          set-attention
        </span>{" "}
        をかけ、「強い選手が誰に沈められるか」というレース内の相互作用を捉える
      </li>
      <li>
        attention の重みから
        <strong>「どの過去走を根拠にしたか」</strong>
        を取り出せる（タブの「マイクロフトの記憶」）
      </li>
    </ul>
  );
}

function MycroftDetailsBasics() {
  return (
    <>
      <div className="explanation-detail-block">
        <h4>Transformer とは</h4>
        <p>
          2017年に提案された Self-attention
          機構を中心とするニューラルネットアーキテクチャです。
          元々は自然言語処理のために開発されましたが、
          「系列データの長距離依存関係を捕捉する」能力から時系列データにも広く適用されています。
          LSTMやGRUと異なり、系列全体を並列に処理できるため学習が高速です。
        </p>
      </div>

      <div className="explanation-detail-block">
        <h4>Self-attention の仕組み</h4>
        <p>
          各レース記録 (Query) が過去の全レース記録 (Key)
          との関連度を計算し、 重み付き和 (Value)
          としてコンテキスト情報を集約します。
        </p>
        <code className="explanation-formula">
          Attention(Q, K, V) = softmax(Q·Kᵀ / √d_k) · V
        </code>
        <p>
          例えば「2週前の節で大崩れした戦」に注目すれば、
          「現在の調子が一時的に落ちているパターン」を学習できます。
        </p>
      </div>

      <div className="explanation-detail-block">
        <h4>Position Encoding</h4>
        <p>
          Self-attention は本来、順序を考慮しません。
          そこで各レース記録に「何戦前か」を示す位置情報を加算することで、
          時間的な前後関係を保持します。
          サイン・コサイン関数を使う固定エンコーディングや、
          学習可能な埋め込み (Learnable PE) を使用します。
        </p>
      </div>

      <div className="explanation-detail-block">
        <h4>選手 Embedding</h4>
        <p>
          各選手に固有のベクトル (Embedding) を割り当て、
          「この選手はイン艇でのスタートが得意」「向かい風で成績が落ちやすい」という
          選手固有の傾向をパラメータとして学習します。
          レース記録のエンコードに加算することで、過去戦の文脈と選手特性を統合します。
        </p>
      </div>

      <div className="explanation-detail-block">
        <h4>具体的なウォークスルー</h4>
        <p>
          選手Aの直近{MAX_HISTORY}走をTransformerに入力すると： 1)
          各走を「着順・進入コース・会場・本番ST・展示順位・相手の強さ・
          何日前か・同じ節か」を束ねた1トークンに変換。 2)
          Self-attentionが「直近数走で着順が上向き」「この会場では毎回好走」
          といったパターンを検出。 3) attention pooling
          で1本の「フォーム埋め込み」に集約（このときの重みが
          「マイクロフトの記憶」として表示される根拠）。 4)
          6艇ぶんのフォームを相互作用させ、レース全体の順位スコアを出力。
        </p>
      </div>
    </>
  );
}

function MycroftDetailsEvaluation() {
  return (
    <>
      <div className="explanation-detail-block">
        <h4>リーク（未来の情報の混入）を防ぐ工夫</h4>
        <p>
          系列モデルは過去参照の実装を誤ると簡単に未来の情報が漏れ、
          検証成績だけが良く見える状態になります。マイクロフトでは
          <strong>対象レースより厳密に過去の日付</strong>
          の走のみをトークンにし（同日レースは
          race_idの並び順が時刻順でないため除外）、
          選手IDが不明な走は「他人の履歴」が混ざらないよう履歴なしとして扱います。
          これらは学習のたびに自動検証しています。
        </p>
      </div>

      <div className="explanation-detail-block">
        <h4>強み・弱み</h4>
        <div className="explanation-pros-cons">
          <div className="explanation-pros">
            <h5>強み</h5>
            <ul>
              <li>時系列の流れ・フォームを捕捉</li>
              <li>長距離依存関係を学習可能</li>
              <li>並列処理で学習高速</li>
              <li>大規模データで真価を発揮</li>
            </ul>
          </div>
          <div className="explanation-cons">
            <h5>弱み</h5>
            <ul>
              <li>十分な履歴データが必要</li>
              <li>過学習リスクが高い</li>
              <li>単独精度がGBDTを超えるとは限らない</li>
              <li>履歴の薄い新人選手に弱い</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="explanation-detail-block">
        <h4>なぜ最後に実装したか</h4>
        <p>
          Transformerは大量のデータがあるほど真価を発揮するため、
          当初は「データ蓄積待ち」として見送っていました。公式アーカイブの
          過去データを取り込んだ結果、直近に出走している選手の履歴が
          中央値で500走を超え、系列{MAX_HISTORY}走はほぼ全選手で
          埋まる状態になったため着手しています。
        </p>
      </div>

      <div className="explanation-detail-block">
        <h4>価値の測り方（正直な指標）</h4>
        <p>
          マイクロフトが読むのは「履歴の並び」という
          <strong>他のモデルが見ていない情報</strong>
          です。したがって単独の的中率がワトソンを上回るかよりも、
          <strong>ワトソンと併用したときに改善するか</strong>
          （アンサンブル増分）のほうが本質的な検定になります。
          単独精度が同等でも、両者を組み合わせて予測が良くなるなら、
          系列は本当に新しい情報を持っていたことになります。
          タブ上部にはこの増分を実測値として表示しています。
        </p>
      </div>
    </>
  );
}

function MycroftExplanation() {
  return (
    <section className="holmes-section explanation-section">
      <h3>仕組みを知る</h3>

      <MycroftSummary />

      <MycroftDiagram />

      <MycroftKeyPoints />

      <details className="explanation-details">
        <summary>詳しい仕組みを見る</summary>
        <div className="explanation-detail-body">
          <MycroftDetailsBasics />

          <MycroftDetailsEvaluation />
        </div>
      </details>
    </section>
  );
}

export default MycroftExplanation;
