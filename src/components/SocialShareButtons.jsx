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
        url={shareUrl}
        title={title}
        className="social-share-button"
      >
        <LineIcon size={size} round />
      </LineShareButton>
    </div>
  );
};
