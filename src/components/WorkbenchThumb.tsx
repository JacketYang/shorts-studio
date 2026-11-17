import React, { useEffect, useRef, useState } from 'react';
import { drawStill } from '../workbench/engine/preview';
import type { VideoSpec as WorkbenchSpec } from '../workbench/engine/types';
import { buildScene, themeOf } from '../workbench/scenes';

const thumbCache = new Map<string, string>();
let renderChain: Promise<void> = Promise.resolve();

interface WorkbenchThumbProps {
  spec: WorkbenchSpec;
  onOpen: () => void;
}

export const WorkbenchThumb: React.FC<WorkbenchThumbProps> = ({ spec, onOpen }) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const theme = themeOf(spec);
  const cacheKey = `${spec.id}|${spec.theme}|${spec.hook}|${JSON.stringify(spec.params)}`;
  const [src, setSrc] = useState<string | undefined>(() => thumbCache.get(cacheKey));

  useEffect(() => {
    const cached = thumbCache.get(cacheKey);
    if (cached) {
      setSrc(cached);
      return;
    }
    setSrc(undefined);
    const el = buttonRef.current;
    if (!el) return;

    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        observer.disconnect();
        renderChain = renderChain.then(
          () =>
            new Promise<void>((resolve) => {
              requestAnimationFrame(() => {
                if (!cancelled) {
                  try {
                    const scene = buildScene(spec);
                    const cv = document.createElement('canvas');
                    cv.width = 270;
                    cv.height = 480;
                    drawStill(cv, scene, themeOf(spec), spec.hook, scene.duration * 0.55);
                    const url = cv.toDataURL('image/jpeg', 0.84);
                    thumbCache.set(cacheKey, url);
                    setSrc(url);
                  } catch {
                    // Leave fallback placeholder if canvas fails
                  }
                }
                setTimeout(resolve, 8);
              });
            })
        );
      },
      { rootMargin: '320px' }
    );
    observer.observe(el);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [spec, cacheKey]);

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onOpen}
      aria-label={`${spec.title} 预览 / 试听`}
      className={`group relative block aspect-[9/16] w-full overflow-hidden rounded-md border border-slate-200 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${
        theme.isLight ? 'bg-stone-100' : 'bg-slate-950'
      }`}
    >
      {src ? (
        <img
          src={src}
          alt={spec.title}
          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
        />
      ) : (
        <div
          className={`flex h-full w-full items-center justify-center text-xs ${
            theme.isLight ? 'text-slate-500' : 'text-slate-400'
          }`}
        >
          渲染缩略图…
        </div>
      )}
      <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity group-hover:bg-black/35 group-hover:opacity-100">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-white/20 bg-slate-950/85 px-3 py-1.5 text-xs font-medium text-white">
          ▶ 预览 / 试听
        </span>
      </div>
    </button>
  );
};
