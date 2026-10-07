import type { CaptionFont, CaptionPresetId, CaptionStyle } from "../types";

export const CAPTION_FONTS: CaptionFont[] = ["Inter", "Montserrat", "Poppins", "Anton", "Bebas Neue"];

export const CAPTION_PRESETS: Record<CaptionPresetId, { label: string; description: string; style: CaptionStyle }> = {
  minimal: {
    label: "Minimalista",
    description: "Texto branco discreto com sombra suave.",
    style: {
      enabled: true,
      preset: "minimal",
      font: "Inter",
      fontSize: 62,
      bold: true,
      position: "bottom",
      color: "#FFFFFF",
      highlightColor: "#FFFFFF",
      background: "shadow",
      backgroundColor: "#000000",
      backgroundOpacity: 0.6,
      animation: "none",
      highlightMode: "none",
      highlightKeywords: false,
      uppercase: false,
      wordsPerLine: 5,
    },
  },
  highlight: {
    label: "Destaque de palavras",
    description: "A palavra falada acende em amarelo, estilo karaokê.",
    style: {
      enabled: true,
      preset: "highlight",
      font: "Montserrat",
      fontSize: 76,
      bold: true,
      position: "bottom",
      color: "#FFFFFF",
      highlightColor: "#FACC15",
      background: "shadow",
      backgroundColor: "#000000",
      backgroundOpacity: 0.85,
      animation: "pop",
      highlightMode: "word",
      highlightKeywords: true,
      uppercase: false,
      wordsPerLine: 3,
    },
  },
  viral: {
    label: "Viral",
    description: "Caixa alta, fonte condensada, poucas palavras por vez.",
    style: {
      enabled: true,
      preset: "viral",
      font: "Anton",
      fontSize: 104,
      bold: false,
      position: "middle",
      color: "#FFFFFF",
      highlightColor: "#22C55E",
      background: "shadow",
      backgroundColor: "#000000",
      backgroundOpacity: 1,
      animation: "pop",
      highlightMode: "word",
      highlightKeywords: true,
      uppercase: true,
      wordsPerLine: 2,
    },
  },
  podcast: {
    label: "Podcast",
    description: "Legenda em caixa escura, ideal para entrevistas.",
    style: {
      enabled: true,
      preset: "podcast",
      font: "Poppins",
      fontSize: 60,
      bold: true,
      position: "bottom",
      color: "#FFFFFF",
      highlightColor: "#38BDF8",
      background: "box",
      backgroundColor: "#0B0B0F",
      backgroundOpacity: 0.78,
      animation: "fade",
      highlightMode: "keywords",
      highlightKeywords: true,
      uppercase: false,
      wordsPerLine: 6,
    },
  },
  clean: {
    label: "Clean",
    description: "Tipografia limpa, sem distrações.",
    style: {
      enabled: true,
      preset: "clean",
      font: "Inter",
      fontSize: 56,
      bold: false,
      position: "bottom",
      color: "#F8FAFC",
      highlightColor: "#A78BFA",
      background: "none",
      backgroundColor: "#000000",
      backgroundOpacity: 0.5,
      animation: "fade",
      highlightMode: "none",
      highlightKeywords: false,
      uppercase: false,
      wordsPerLine: 6,
    },
  },
};

export const DEFAULT_CAPTION_STYLE: CaptionStyle = CAPTION_PRESETS.highlight.style;

const HEX = /^#[0-9a-fA-F]{6}$/;
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

/** Mescla e valida um estilo vindo do banco/cliente. Nunca confia em entrada externa. */
export function resolveCaptionStyle(input: unknown): CaptionStyle {
  const raw = (input && typeof input === "object" ? input : {}) as Partial<CaptionStyle>;
  const presetId = pick(raw.preset, Object.keys(CAPTION_PRESETS) as CaptionPresetId[], DEFAULT_CAPTION_STYLE.preset);
  const base = CAPTION_PRESETS[presetId].style;
  const num = (v: unknown, min: number, max: number, fb: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fb;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : base.enabled,
    preset: presetId,
    font: pick(raw.font, CAPTION_FONTS, base.font),
    fontSize: Math.round(num(raw.fontSize, 28, 160, base.fontSize)),
    bold: typeof raw.bold === "boolean" ? raw.bold : base.bold,
    position: pick(raw.position, ["top", "middle", "bottom"] as const, base.position),
    color: typeof raw.color === "string" && HEX.test(raw.color) ? raw.color.toUpperCase() : base.color,
    highlightColor:
      typeof raw.highlightColor === "string" && HEX.test(raw.highlightColor) ? raw.highlightColor.toUpperCase() : base.highlightColor,
    background: pick(raw.background, ["none", "shadow", "box"] as const, base.background),
    backgroundColor:
      typeof raw.backgroundColor === "string" && HEX.test(raw.backgroundColor) ? raw.backgroundColor.toUpperCase() : base.backgroundColor,
    backgroundOpacity: num(raw.backgroundOpacity, 0, 1, base.backgroundOpacity),
    animation: pick(raw.animation, ["none", "pop", "fade"] as const, base.animation),
    highlightMode: pick(raw.highlightMode, ["word", "keywords", "none"] as const, base.highlightMode),
    highlightKeywords: typeof raw.highlightKeywords === "boolean" ? raw.highlightKeywords : base.highlightKeywords,
    uppercase: typeof raw.uppercase === "boolean" ? raw.uppercase : base.uppercase,
    wordsPerLine: Math.round(num(raw.wordsPerLine, 1, 10, base.wordsPerLine)),
  };
}
