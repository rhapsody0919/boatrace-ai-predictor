// 「詳しい仕組みを見る」の折りたたみ（PoirotExplanation から分離）
import { DetailsPartA, DetailsPartB } from "./DetailsBlockParts";

function DetailsBlock() {
  return (
    <>
      <details className="explanation-details">
        <summary>詳しい仕組みを見る</summary>
        <div className="explanation-detail-body">
          <DetailsPartA />
          <DetailsPartB />
        </div>
      </details>
    </>
  );
}

export default DetailsBlock;
