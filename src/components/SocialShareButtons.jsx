import React from 'react';
import {
  TwitterShareButton,
  FacebookShareButton,
  LineShareButton,
  XIcon,
  FacebookIcon,
  LineIcon
} from 'react-share';
import './SocialShareButtons.css';

export const SocialShareButtons = ({
  shareUrl = 'https://boat-ai.jp/',
  title,
  hashtags = ['競艇', 'ボートレース', 'AI予想', 'BoatAI'],
  size = 36,
  type = 'prediction' // 'prediction' or 'hit'
}) => {
  // LINEシェア用: テキストからURLを除去（LINEは自動的にURLを追加するため）
  const lineTitle = title
    .replace(/▼詳細を見る\nhttps:\/\/boat-ai\.jp\/\n?/g, '')
    .replace(/▼本日の予想を見る\nhttps:\/\/boat-ai\.jp\/\n?/g, '')
    .replace(/https:\/\/boat-ai\.jp\/\n?/g, '')
    .trim();

  return (
    <div className="social-share-buttons">
      <TwitterShareButton
        url={shareUrl}
        title={title}
        hashtags={hashtags}
        className="social-share-button"
      >
        <XIcon size={size} round />
      </TwitterShareButton>

      <FacebookShareButton
        url={shareUrl}
        quote={title}
        hashtag={`#${hashtags[0]}`}
        className="social-share-button"
      >
        <FacebookIcon size={size} round />
      </FacebookShareButton>

      <LineShareButton
        url={lineTitle ? `${lineTitle}\n${shareUrl}` : shareUrl}
        className="social-share-button"
      >
        <LineIcon size={size} round />
      </LineShareButton>
    </div>
  );
};
