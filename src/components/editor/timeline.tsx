"use client";

import { useRef } from "react";
import { formatTimestamp } from "@/lib/format";
import type { Word } from "@/lib/types";

/**
 * Linha do tempo simples: mostra a fala (marcas das palavras), o trecho selecionado
 * com alças arrastáveis de início/fim e a posição atual.
 */
export function Timeline({
  windowStart,
  windowEnd,
  start,
  end,
  time,
  words,
  onChange,
  onSeek,
}: {
  windowStart: number;
  windowEnd: number;
  start: number;
  end: number;
  time: number;
  words: Word[];
  onChange: (start: number, end: number) => void;
  onSeek: (t: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const span = Math.max(1, windowEnd - windowStart);
  const pct = (t: number) => ((t - windowStart) / span) * 100;
  const toTime = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return windowStart + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * span;
  };

  const drag = (which: "start" | "end") => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const t = Math.round(toTime(ev.clientX) * 10) / 10;
      if (which === "start") onChange(Math.min(t, end - 3), end);
      else onChange(start, Math.max(t, start + 3));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div>
      <div
        ref={ref}
        className="relative h-16 cursor-pointer select-none overflow-hidden rounded-xl border border-line bg-surface-2"
        onClick={(e) => onSeek(toTime(e.clientX))}
      >
        {/* marcas de fala */}
        {words.map((w, i) => (
          <div
            key={i}
            className="absolute top-1/2 h-5 -translate-y-1/2 rounded-sm bg-white/15"
            style={{ left: `${pct(w.s)}%`, width: `${Math.max(0.15, pct(w.e) - pct(w.s))}%` }}
          />
        ))}
        {/* trecho selecionado */}
        <div className="absolute inset-y-0 border-y-2 border-brand bg-brand/15" style={{ left: `${pct(start)}%`, width: `${pct(end) - pct(start)}%` }} />
        {(["start", "end"] as const).map((h) => (
          <div
            key={h}
            onPointerDown={drag(h)}
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-y-0 z-10 flex w-3 -translate-x-1/2 cursor-ew-resize items-center justify-center rounded bg-brand"
            style={{ left: `${pct(h === "start" ? start : end)}%` }}
            title={h === "start" ? "Arraste para ajustar o início" : "Arraste para ajustar o fim"}
          >
            <div className="h-6 w-0.5 rounded bg-white/70" />
          </div>
        ))}
        {/* posição atual */}
        <div className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-white" style={{ left: `${pct(time)}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-subtle">
        <span>{formatTimestamp(windowStart)}</span>
        <span>{formatTimestamp(windowEnd)}</span>
      </div>
    </div>
  );
}
