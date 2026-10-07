import { useState } from "react";
import { importPreviewBundle } from "../../../services/snsHubService.js";
import "./BundleImportPanel.css";

export default function BundleImportPanel({ onImported }) {
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function handleImport(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const { data } = await importPreviewBundle(files);
      setResult(data);
      await onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sns-bundle-import-panel" aria-labelledby="sns-bundle-import-title">
      <h2 id="sns-bundle-import-title">展望素材の取り込み</h2>
      <p>v0素材をX・YouTubeの承認待ち下書きに登録します。正式公開の確認条件が決まるまで公開不可です。</p>
      <form onSubmit={handleImport}>
        <label htmlFor="sns-bundle-import-files">素材ファイル（複数選択）</label>
        <input id="sns-bundle-import-files" type="file" multiple accept=".json,.txt,.png,.mp4" disabled={busy}
          onChange={(event) => {
            setFiles(Array.from(event.target.files));
            setResult(null);
            setError(null);
          }} />
        <p>bundle.json・qa.json・integrity.jsonは必須です。動画・画像・台本・API原文とメタも一緒に選んでください。</p>
        <p>全体4 MiB以内、JSON各1.5 MiB・動画／画像各2 MiB・テキスト各64 KiB以内。</p>
        <button type="submit" className="draft-action-btn" disabled={busy || files.length === 0}>
          {busy ? "取り込み中…" : `${files.length}ファイルを取り込む`}
        </button>
      </form>
      {error && <p role="alert">取り込み不合格: {error}</p>}
      {result && <div role="status">
        <p><strong>公開不可</strong> — 取り込み結果</p>
        <ul>{result.drafts.map((draft) => <li key={draft.id}>
          {draft.platform === "x" ? "X" : "YouTube"}: {draft.result === "created" ? "承認待ちで登録" : "重複（登録済み）"}（{draft.id}）
        </li>)}</ul>
        <ul>{result.hold_reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      </div>}
    </section>
  );
}
