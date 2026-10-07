"use client";

import { Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/components/ui";
import type { CaptionLine } from "@/lib/captions/grouping";
import { remapTime, type TimeRange } from "@/lib/clips/timing";
import { OUTPUT_SIZES } from "@/lib/constants";
import { formatTimestamp } from "@/lib/format";
import type { CaptionStyle, ClipFormat, Framing } from "@/lib/types";
import { CaptionOverlay } from "./caption-overlay";

export type PlayerController = { seek: (sourceTime: number) => void; play: () => void; pause: () => void };

function framingXAt(framing: Framing | null, t: number): number {
  const ks = framing?.keyframes?.length ? framing.keyframes : [{ t: 0, x: 0.5 }];
  let x = ks[0].x;
  for (const k of ks) if (k.t <= t) x = k.x;
  return x;
}

/**
 * Pré-visualização ao vivo: toca o vídeo original (proxy) entre início e fim,
 * pula as pausas que serão removidas, simula o enquadramento 9:16 e desenha as
 * legendas com o estilo atual — sem precisar renderizar.
 */
export function PreviewPlayer({
  src,
  start,
  end,
  segments,
  format,
  framing,
  source,
  lines,
  style,
  title,
  showTitle,
  controllerRef,
  onTime,
}: {
  src: string | null;
  start: number;
  end: number;
  segments: TimeRange[];
  format: ClipFormat;
  framing: Framing | null;
  source: { width: number; height: number };
  lines: CaptionLine[];
  style: CaptionStyle;
  title: string;
  showTitle: boolean;
  controllerRef?: React.RefObject<PlayerController | null>;
  onTime?: (sourceTime: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const bgRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [time, setTime] = useState(start); // tempo no original
  const [frameW, setFrameW] = useState(320);
  const lastRef = useRef(start);

  const size = OUTPUT_SIZES[format.aspect];
  const outTime = remapTime(time, segments);
  const outDuration = segments.reduce((a, s) => a + s.e - s.s, 0);
  const line = useMemo(() => lines.find((l) => outTime >= l.start && outTime < l.end) ?? null, [lines, outTime]);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFrameW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
    if (bgRef.current) bgRef.current.currentTime = t;
    setTime(t);
  }, []);

  useEffect(() => {
    if (controllerRef) {
      controllerRef.current = {
        seek,
        play: () => void videoRef.current?.play(),
        pause: () => videoRef.current?.pause(),
      };
    }
  }, [controllerRef, seek]);

  // Ao mudar o intervalo, volta para o início
  useEffect(() => {
    const v = videoRef.current;
    if (v && (v.currentTime < start - 0.5 || v.currentTime > end)) seek(start);
  }, [start, end, seek]);

  // Loop de animação: sincroniza legenda, pula pausas removidas e respeita o fim
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) {
        let t = v.currentTime;
        if (!v.paused) {
          const inSeg = segments.find((s) => t >= s.s - 0.02 && t < s.e);
          if (!inSeg) {
            const next = segments.find((s) => s.s > t);
            if (next && t >= start) {
              v.currentTime = next.s;
              t = next.s;
            } else if (t >= end || !next) {
              v.pause();
              v.currentTime = start;
              t = start;
            }
          }
          const bg = bgRef.current;
          if (bg && Math.abs(bg.currentTime - t) > 0.3) bg.currentTime = t;
        }
        if (Math.abs(t - lastRef.current) > 0.04) {
          lastRef.current = t;
          setTime(t);
          onTime?.(t);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [segments, start, end, onTime]);

  const targetAR = size.width / size.height;
  const srcAR = source.width / source.height;
  const fill = format.layout === "fill";
  let objectPosition = "50% 50%";
  if (fill && srcAR > targetAR) {
    const cropW = source.height * targetAR;
    const x = framingXAt(framing, outTime);
    const left = Math.min(source.width - cropW, Math.max(0, x * source.width - cropW / 2));
    objectPosition = `${(left / Math.max(1, source.width - cropW)) * 100}% 50%`;
  } else if (fill && srcAR < targetAR) {
    objectPosition = "50% 40%";
  }

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < start || v.currentTime >= end) seek(start);
      void v.play();
      void bgRef.current?.play().catch(() => {});
    } else {
      v.pause();
      bgRef.current?.pause();
    }
  };

  const maxW = format.aspect === "16:9" ? 640 : format.aspect === "1:1" ? 420 : format.aspect === "4:5" ? 380 : 340;

  return (
    <div className="flex flex-col items-center">
      <div
        ref={frameRef}
        className="relative w-full overflow-hidden rounded-2xl bg-black shadow-2xl shadow-black/50 ring-1 ring-line"
        style={{ aspectRatio: `${size.width} / ${size.height}`, maxWidth: maxW }}
        onClick={toggle}
      >
        {src ? (
          <>
            {!fill && (
              <video
                ref={bgRef}
                src={src}
                muted
                playsInline
                preload="auto"
                className="absolute inset-0 size-full scale-110 object-cover opacity-70 blur-2xl brightness-90"
              />
            )}
            <video
              ref={videoRef}
              src={src}
              muted={muted}
              playsInline
              preload="auto"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onLoadedMetadata={() => seek(start)}
              className={cx("absolute inset-0 size-full", fill ? "object-cover" : "object-contain")}
              style={{ objectPosition }}
            />
          </>
        ) : (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted">Pré-visualização indisponível.</div>
        )}
        <CaptionOverlay
          line={line}
          time={outTime}
          style={style}
          scale={frameW / 1080}
          title={title}
          showTitle={showTitle}
          hasTitle={showTitle && Boolean(title)}
        />
        {!playing && src && (
          <div className="absolute inset-0 grid place-items-center bg-black/20">
            <div className="grid size-14 place-items-center rounded-full bg-white/15 backdrop-blur">
              <Play className="ml-1 size-6 text-white" />
            </div>
          </div>
        )}
      </div>
      <div className="mt-3 flex w-full items-center gap-3" style={{ maxWidth: maxW }}>
        <button onClick={toggle} className="grid size-9 place-items-center rounded-full bg-white/10 hover:bg-white/15" aria-label={playing ? "Pausar" : "Reproduzir"}>
          {playing ? <Pause className="size-4" /> : <Play className="ml-0.5 size-4" />}
        </button>
        <button onClick={() => seek(start)} className="text-muted hover:text-fg" aria-label="Voltar ao início">
          <RotateCcw className="size-4" />
        </button>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full bg-brand" style={{ width: `${outDuration ? (outTime / outDuration) * 100 : 0}%` }} />
        </div>
        <span className="text-xs tabular-nums text-muted">
          {formatTimestamp(outTime)} / {formatTimestamp(outDuration)}
        </span>
        <button onClick={() => setMuted((m) => !m)} className="text-muted hover:text-fg" aria-label="Som">
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </button>
      </div>
    </div>
  );
}
