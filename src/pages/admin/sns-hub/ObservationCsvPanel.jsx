import { useState } from "react";
import { downloadObservationCsv } from "../../../services/snsHubService.js";

export default function ObservationCsvPanel() {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [platform, setPlatform] = useState("all");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function download(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await downloadObservationCsv({ start, end, platform });
      setMessage("CSVのダウンロードを開始しました。");
    } catch {
      setMessage(
        "CSVを取得できませんでした。公開日・通信状態を確認して再試行してください。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={download}>
      <h3>週次観測CSV</h3>
      <p>
        公開日（JST・両端を含む）で選び、48hと7dを出力します。欠測は空欄と理由、指標ごとの来歴を残します。
      </p>
      <label>
        公開開始日{" "}
        <input
          type="date"
          required
          value={start}
          onChange={(e) => setStart(e.target.value)}
          disabled={busy}
        />
      </label>{" "}
      <label>
        公開終了日{" "}
        <input
          type="date"
          required
          min={start || undefined}
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          disabled={busy}
        />
      </label>{" "}
      <label>
        チャネル{" "}
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          disabled={busy}
        >
          <option value="all">X・YouTube</option>
          <option value="x">X</option>
          <option value="youtube">YouTube</option>
        </select>
      </label>{" "}
      <button disabled={busy} type="submit">
        {busy ? "CSVを取得中…" : "CSVをダウンロード"}
      </button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
