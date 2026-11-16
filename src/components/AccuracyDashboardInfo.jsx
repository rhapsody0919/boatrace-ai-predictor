export default function AccuracyDashboardInfo() {
  return (
    <div className="accuracy-info">
      <h4>💡 展開予測の的中率について</h4>
      <div className="info-section">
        <p>
          展開予測は、1マーク（最初のターン）の攻防でどの艇が1着になるかを予想する機能です。上位パターンのいずれかの艇が実際に1着になれば「的中」としてカウントしています（艇番で判定。前付けで進入コースが変わっても、その艇が勝てば的中）。
        </p>
      </div>
      <div className="info-section">
        <p>
          複勝予想（AIの本命が2着以内に入るかの予想）の実測精度は、算出方法の見直しのため一時的に非表示にしています。
        </p>
      </div>
      <div className="info-section">
        <p>
          <strong>データ更新:</strong>{" "}
          レース終了後、自動的に的中率が再計算されます
        </p>
      </div>
    </div>
  );
}
