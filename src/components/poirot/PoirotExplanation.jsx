// ポアロ予想の「仕組みを知る」セクション（BOA-104）
// Holmes ページの explanations と同じ構成・スタイルを踏襲する
import "../holmes/explanations/ExplanationSection.css";
import FlowDiagram from "./explanation/FlowDiagram";
import KeyPoints from "./explanation/KeyPoints";
import LearningDiagram from "./explanation/LearningDiagram";
import DetailsBlock from "./explanation/DetailsBlock";

function PoirotExplanation() {
  return (
    <section className="explanation-section">
      <h3>仕組みを知る</h3>

      <p className="explanation-summary">
        ポアロ予想は、2025年12月以降の全レースの実戦データから学習した
        <strong>機械学習モデル</strong>
        です（毎週データを足して学び直しています）。人間がルールを書くのではなく、
        「どんな条件の艇が何着に来たか」をAIが自分で見つけ出します。
        6艇それぞれの「1着になる確率・2着になる確率・3着になる確率」を計算し、
        3連単120通りの中から最も起こりやすい並びを1点だけ提示します。
        学習アルゴリズムの異なる V1（ランダムフォレスト）と
        V2（LightGBM）の2機を並走させ、タブで比較できます。
      </p>

      <FlowDiagram />

      <KeyPoints />

      <LearningDiagram />

      <DetailsBlock />
    </section>
  );
}

export default PoirotExplanation;
