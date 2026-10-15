import { Link } from "react-router-dom";

/**
 * 選手名を選手ページ（/racer/{登録番号}）へのリンクにする（BOA-879）。
 * 出走表（DataRaceTable）と同じく素の Link で同じタブに移る。登録番号が無い艇は文字だけ出す
 */
export default function RacerLink({ racerId, className, children }) {
  return racerId ? (
    <Link
      to={`/racer/${racerId}`}
      className={className}
      translate="no"
      data-testid="assist-racer-link"
    >
      {children}
    </Link>
  ) : (
    <span className={className} translate="no">
      {children}
    </span>
  );
}
