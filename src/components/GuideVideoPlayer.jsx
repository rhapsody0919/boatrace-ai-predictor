import { useRef, useState } from "react";
import "./GuideVideoPlayer.css";

export default function GuideVideoPlayer({ videoSrc, posterSrc }) {
  const videoRef = useRef(null);
  const [started, setStarted] = useState(false);

  const handlePlay = () => {
    setStarted(true);
    videoRef.current?.play();
  };

  return (
    <div className="guide-video-wrapper">
      <video
        ref={videoRef}
        className="guide-video"
        playsInline
        controls={started}
        preload="none"
        poster={posterSrc}
      >
        <source src={videoSrc} type="video/mp4" />
      </video>
      {!started && (
        <button
          type="button"
          className="guide-video-play-button"
          onClick={handlePlay}
          aria-label="動画を再生"
        >
          ▶
        </button>
      )}
    </div>
  );
}
