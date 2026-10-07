"use client";

import { Fragment, type CSSProperties } from "react";
import type { CaptionLine } from "@/lib/captions/grouping";
import type { CaptionFont, CaptionStyle } from "@/lib/types";

export const FONT_VARS: Record<CaptionFont, string> = {
  Inter: "var(--font-inter)",
  Montserrat: "var(--font-montserrat)",
  Poppins: "var(--font-poppins)",
  Anton: "var(--font-anton)",
  "Bebas Neue": "var(--font-bebas)",
};

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * Renderiza a legenda no navegador com as MESMAS regras do renderizador ASS
 * (agrupamento, destaque, posição, fonte). Escala = largura do preview / 1080.
 */
export function CaptionOverlay({
  line,
  time,
  style,
  scale,
  title,
  showTitle,
  hasTitle,
}: {
  line: CaptionLine | null;
  time: number;
  style: CaptionStyle;
  scale: number;
  title?: string | null;
  showTitle: boolean;
  hasTitle: boolean;
}) {
  const fontSize = style.fontSize * scale;
  const position: CSSProperties =
    style.position === "bottom"
      ? { bottom: "20%" }
      : style.position === "top"
        ? { top: hasTitle ? "24%" : "14%" }
        : { top: "50%", transform: "translateY(-50%)" };

  const textShadow =
    style.background === "shadow"
      ? `0 0 ${fontSize * 0.08}px ${rgba(style.backgroundColor, style.backgroundOpacity)}, ${fontSize * 0.05}px ${fontSize * 0.05}px 0 ${rgba(style.backgroundColor, style.backgroundOpacity * 0.7)}`
      : "none";
  const stroke =
    style.background === "box" ? undefined : `${Math.max(1, fontSize * (style.background === "shadow" ? 0.07 : 0.045))}px ${style.background === "shadow" ? rgba(style.backgroundColor, style.backgroundOpacity) : "#000"}`;

  const current = line ? line.words.findIndex((w, j) => time >= (j === 0 ? line.start : w.s) && (j + 1 < line.words.length ? time < line.words[j + 1].s : time < line.end)) : -1;
  const fresh = line ? time - line.start < 0.12 : false;

  return (
    <>
      {showTitle && title && time < 4.5 && (
        <div className="pointer-events-none absolute inset-x-0 flex justify-center px-[8%]" style={{ top: "8%" }}>
          <span
            className="rounded-[0.3em] text-center leading-tight"
            style={{
              fontFamily: FONT_VARS.Montserrat,
              fontWeight: 800,
              fontSize: 58 * scale,
              color: "#0B0B0F",
              background: "rgba(255,255,255,0.96)",
              padding: `${10 * scale}px ${18 * scale}px`,
            }}
          >
            {title}
          </span>
        </div>
      )}
      {style.enabled && line && (
        <div className="pointer-events-none absolute inset-x-0 flex justify-center text-center" style={{ ...position, paddingInline: `${70 * scale}px` }}>
          <span
            style={{
              fontFamily: FONT_VARS[style.font],
              fontWeight: style.bold ? 800 : 500,
              fontSize,
              lineHeight: 1.15,
              color: style.color,
              textShadow,
              WebkitTextStroke: stroke,
              paintOrder: "stroke fill",
              background: style.background === "box" ? rgba(style.backgroundColor, style.backgroundOpacity) : undefined,
              padding: style.background === "box" ? `${fontSize * 0.12}px ${fontSize * 0.25}px` : undefined,
              borderRadius: style.background === "box" ? fontSize * 0.12 : undefined,
              textTransform: style.uppercase ? "uppercase" : undefined,
              transform: style.animation === "pop" && fresh ? "scale(0.85)" : "scale(1)",
              opacity: style.animation === "fade" && fresh ? 0.4 : 1,
              transition: "transform 90ms ease-out, opacity 120ms ease-out",
              display: "inline-block",
            }}
          >
            {line.words.map((w, j) => {
              const active = style.highlightMode === "word" && j === current;
              const kw = w.keyword && (style.highlightMode === "keywords" || style.highlightKeywords);
              return (
                <Fragment key={j}>
                  <span style={{ color: active || kw ? style.highlightColor : undefined, display: "inline-block", transform: active ? "scale(1.08)" : undefined }}>
                    {w.w}
                  </span>
                  {j < line.words.length - 1 ? " " : null}
                </Fragment>
              );
            })}
          </span>
        </div>
      )}
    </>
  );
}
