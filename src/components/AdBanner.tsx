import { useState, useRef, useEffect } from "react";
import { useSettings } from "../context/SettingsContext";
import { openExternalLink } from "../utils";

export function AdBanner({ index }: { index?: number }) {
  const { settings } = useSettings();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(360);

  useEffect(() => {
    if (!containerRef.current) return;
    const updateSize = () => {
      if (containerRef.current) {
        const w = containerRef.current.clientWidth;
        if (w > 0) setContainerWidth(w);
      }
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  if (!settings.adEnabled) return null;

  const hasCode = Boolean(settings.adCode?.trim());
  const hasImage = Boolean(settings.adImage?.trim());
  if (!hasCode && !hasImage) return null;

  const scale = containerWidth / 300;
  const scaledHeight = Math.round(250 * scale);

  const adIframeDoc = hasCode
    ? `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
      background: #ffffff;
      overflow: hidden;
    }
    iframe {
      width: 300px !important;
      height: 250px !important;
      border: 0 !important;
      display: block !important;
    }
  </style>
</head>
<body>
  ${settings.adCode}
</body>
</html>`
    : "";

  return (
    <div
      ref={containerRef}
      className="my-1 w-full overflow-hidden bg-white"
      style={{
        height: `${scaledHeight}px`,
      }}
    >
      {hasCode ? (
        <div
          style={{
            width: "300px",
            height: "250px",
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <iframe
            title={`banner-frame-${index ?? 0}`}
            srcDoc={adIframeDoc}
            width="300"
            height="250"
            className="border-0 overflow-hidden bg-white block"
            scrolling="no"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => settings.adLink && openExternalLink(settings.adLink)}
          className="w-full h-full block"
        >
          <img
            src={settings.adImage}
            alt=""
            className="w-full h-full object-cover block"
            loading="lazy"
          />
        </button>
      )}
    </div>
  );
}
