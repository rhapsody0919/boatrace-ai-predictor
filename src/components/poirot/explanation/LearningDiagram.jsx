// 図2: V1 と V2 の学習方法の違い（PoirotExplanation から分離）
import { LearningDefs, LearningV1Trees, LearningV1V2Mid, LearningV2Sum } from "./LearningDiagramParts";

function LearningDiagram() {
  return (
    <>
      {/* ============================================================ */}
      {/* 図2: V1 と V2 の学習方法の違い                                */}
      {/* ============================================================ */}
      <div className="explanation-diagram">
        <svg
          viewBox="0 0 700 285"
          width="100%"
          height="auto"
          aria-label="V1ランダムフォレストとV2 LightGBMの違い: V1は多数の決定木の平均、V2は誤差を順番に補正する木の合計"
        >
          <LearningDefs />
          <LearningV1Trees />
          <LearningV1V2Mid />
          <LearningV2Sum />
        </svg>
      </div>
    </>
  );
}

export default LearningDiagram;
