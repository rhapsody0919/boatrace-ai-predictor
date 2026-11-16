// 図1: 予想ができるまでの全体フロー（PoirotExplanation から分離）
import { FlowInputs, FlowFeatures, FlowHeads, FlowCalibration, FlowOutput } from "./FlowDiagramParts";

function FlowDiagram() {
  return (
    <>
      {/* ============================================================ */}
      {/* 図1: 予想ができるまでの全体フロー                              */}
      {/* ============================================================ */}
      <div className="explanation-diagram">
        <svg
          viewBox="0 0 700 330"
          width="100%"
          height="auto"
          aria-label="ポアロ予想の処理フロー図: 過去データから特徴量を作り、3つのAIヘッドで着順確率を推定し、校正とPlackett-Luce展開を経て買い目1点を出力する"
        >
          <FlowInputs />
          <FlowFeatures />
          <FlowHeads />
          <FlowCalibration />
          <FlowOutput />
        </svg>
      </div>
    </>
  );
}

export default FlowDiagram;
