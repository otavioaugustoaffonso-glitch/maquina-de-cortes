import type { CaptionStyle, Word } from "../types";
import { groupCaptionLines } from "./grouping";

/** Converte #RRGGBB + opacidade (0..1) para o formato ASS &HAABBGGRR. */
export function assColor(hex: string, opacity = 1): string {
  const h = hex.replace("#", "");
  const r = h.slice(0, 2), g = h.slice(2, 4), b = h.slice(4, 6);
  const alpha = Math.round((1 - Math.min(1, Math.max(0, opacity))) * 255)
    .toString(16)
    .padStart(2, "0");
  return `&H${alpha}${b}${g}${r}`.toUpperCase();
}

/** Formato de tempo ASS: H:MM:SS.cc */
export function assTime(t: number): string {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

export function escapeAss(text: string): string {
  return text.replace(/\\/g, "/").replace(/[{}]/g, "").replace(/\r?\n/g, " ");
}

export type AssOptions = {
  /** Palavras já no timeline do vídeo de saída. */
  words: Word[];
  style: CaptionStyle;
  width: number;
  height: number;
  duration: number;
  keywords?: string[];
  /** Título exibido no topo nos primeiros segundos (opcional). */
  title?: string | null;
  titleSeconds?: number;
};

/** Margem vertical em px (no espaço do vídeo de saída) para cada posição. */
export function captionMarginV(position: CaptionStyle["position"], height: number, hasTitle: boolean): number {
  if (position === "bottom") return Math.round(height * 0.2);
  if (position === "top") return Math.round(height * (hasTitle ? 0.24 : 0.14));
  return 0;
}

/**
 * Gera um arquivo .ass (Advanced SubStation Alpha) com as legendas animadas.
 * Renderizado pelo filtro `ass` (libass) do FFmpeg, queimando a legenda no vídeo.
 */
export function buildAss(opts: AssOptions): string {
  const { words, style, width, height, duration, keywords = [], title, titleSeconds = 4.5 } = opts;
  const scale = width / 1080;
  const fontSize = Math.round(style.fontSize * scale);
  const alignment = style.position === "top" ? 8 : style.position === "middle" ? 5 : 2;
  const hasTitle = Boolean(title && title.trim());
  const marginV = captionMarginV(style.position, height, hasTitle);
  const marginH = Math.round(70 * scale);

  let borderStyle = 1;
  let outline = Math.max(2, Math.round(fontSize * 0.045));
  let shadow = 0;
  let outlineColour = assColor("#000000", 1);
  let backColour = assColor("#000000", 0.6);
  if (style.background === "shadow") {
    outline = Math.max(3, Math.round(fontSize * 0.07));
    shadow = Math.max(2, Math.round(fontSize * 0.05));
    outlineColour = assColor(style.backgroundColor, style.backgroundOpacity);
    backColour = assColor(style.backgroundColor, style.backgroundOpacity * 0.6);
  } else if (style.background === "box") {
    borderStyle = 3;
    outline = Math.max(8, Math.round(fontSize * 0.22)); // padding da caixa
    outlineColour = assColor(style.backgroundColor, style.backgroundOpacity);
    backColour = assColor(style.backgroundColor, style.backgroundOpacity);
  }

  const primary = assColor(style.color);
  const highlight = assColor(style.highlightColor);
  const bold = style.bold ? -1 : 0;
  const titleSize = Math.round(58 * scale);

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,${style.font},${fontSize},${primary},${highlight},${outlineColour},${backColour},${bold},0,0,0,100,100,0,0,${borderStyle},${outline},${shadow},${alignment},${marginH},${marginH},${marginV},1`,
    `Style: Title,Montserrat,${titleSize},${assColor("#0B0B0F")},${assColor("#0B0B0F")},${assColor("#FFFFFF", 0.96)},${assColor("#000000", 0.3)},-1,0,0,0,100,100,0,0,3,${Math.round(18 * scale)},0,8,${Math.round(90 * scale)},${Math.round(90 * scale)},${Math.round(height * 0.08)},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const events: string[] = [];
  if (hasTitle) {
    const end = Math.min(duration, titleSeconds);
    events.push(`Dialogue: 1,${assTime(0)},${assTime(end)},Title,,0,0,0,,{\\fad(150,250)}${escapeAss(title!.trim())}`);
  }

  if (style.enabled) {
    const lines = groupCaptionLines(words, style, style.highlightKeywords ? keywords : []);
    const fmt = (w: string) => escapeAss(style.uppercase ? w.toLocaleUpperCase("pt-BR") : w);
    const intro = (first: boolean) => {
      if (!first) return "";
      if (style.animation === "pop") return "{\\fscx82\\fscy82\\t(0,90,\\fscx100\\fscy100)}";
      if (style.animation === "fade") return "{\\fad(120,0)}";
      return "";
    };
    const render = (line: (typeof lines)[number], current: number) =>
      line.words
        .map((w, j) => {
          const text = fmt(w.w);
          if (style.highlightMode === "word" && j === current) {
            return `{\\c${highlight}\\fscx108\\fscy108}${text}{\\c${primary}\\fscx100\\fscy100}`;
          }
          if (w.keyword && (style.highlightMode === "keywords" || style.highlightKeywords)) {
            return `{\\c${highlight}}${text}{\\c${primary}}`;
          }
          return text;
        })
        .join(" ");

    for (const line of lines) {
      if (style.highlightMode === "word") {
        // Um evento por palavra: a linha inteira fica na tela e a palavra falada acende.
        for (let j = 0; j < line.words.length; j++) {
          const s = j === 0 ? line.start : line.words[j].s;
          const e = j + 1 < line.words.length ? line.words[j + 1].s : line.end;
          if (e - s < 0.01) continue;
          events.push(`Dialogue: 0,${assTime(s)},${assTime(e)},Caption,,0,0,0,,${intro(j === 0)}${render(line, j)}`);
        }
      } else {
        events.push(`Dialogue: 0,${assTime(line.start)},${assTime(line.end)},Caption,,0,0,0,,${intro(true)}${render(line, -1)}`);
      }
    }
  }

  return [...header, ...events, ""].join("\n");
}
