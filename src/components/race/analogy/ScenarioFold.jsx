/**
 * 展開シナリオの折りたたみ（承認モック mock-scenario-v1）。見出しの行は横幅いっぱい・高さ44px以上で、
 * 見出しの下に中身の予告を小さく出す（予告が無いと情報が消えたように見える。UI/UX レビュー）
 * @param {{title: string, preview?: string, children: React.ReactNode, testId?: string}} props
 */
export default function ScenarioFold({ title, preview, children, testId }) {
  return (
    <details className="af-scn-fold" data-testid={testId}>
      <summary>
        <span>
          {title}
          {preview && <small>{preview}</small>}
        </span>
      </summary>
      <div className="af-scn-fold-in">{children}</div>
    </details>
  );
}
