import { errorMessageOf } from '../../../utils/errorMessage.js';
import { useState } from 'react';
import { getBlogPrPreview } from '../../../services/snsHubService';

export default function BlogPrReview({ draft, review, onReview }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function loadPreview() {
    setLoading(true);
    setError('');
    onReview(null);
    try {
      const result = await getBlogPrPreview(draft.id);
      onReview({ ...result, prUrl: draft.pr_url, confirmed: false });
    } catch (err) { setError(errorMessageOf(err)); }
    finally { setLoading(false); }
  }
  const current = review?.prUrl === draft.pr_url ? review : null;
  return <div className="draft-background-details">
    <button className="draft-action-btn" disabled={loading} onClick={loadPreview}>
      {loading ? '版を取得中…' : '承認するPRの版を取得'}
    </button>
    {error && <p role="alert">{error}</p>}
    {current && <>
      <p><a href={current.previewUrl} target="_blank" rel="noreferrer">この版の記事・画像を確認（{current.headSha.slice(0, 7)}）</a></p>
      <label><input type="checkbox" checked={current.confirmed}
        onChange={(event) => onReview({ ...current, confirmed: event.target.checked })} />
        リンク先の版を確認しました
      </label>
    </>}
  </div>;
}
