"use client";

import { cx, Label } from "@/components/ui";
import { CAPTION_FONTS, CAPTION_PRESETS } from "@/lib/captions/styles";
import type { CaptionPresetId, CaptionStyle } from "@/lib/types";
import { FONT_VARS } from "./caption-overlay";

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-xl border border-line bg-surface-2 p-0.5 text-xs">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cx("flex-1 rounded-lg px-2 py-1.5 transition", value === v ? "bg-white/10 text-fg" : "text-muted hover:text-fg")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface-2 px-2">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} className="size-6 cursor-pointer rounded border-0 bg-transparent" />
        <span className="font-mono text-xs uppercase text-muted">{value}</span>
      </label>
    </div>
  );
}

export function StylePanel({ style, onChange }: { style: CaptionStyle; onChange: (s: CaptionStyle) => void }) {
  const set = <K extends keyof CaptionStyle>(k: K, v: CaptionStyle[K]) => onChange({ ...style, [k]: v });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Legendas automáticas</span>
        <button
          type="button"
          onClick={() => set("enabled", !style.enabled)}
          className={cx("relative h-6 w-11 rounded-full transition", style.enabled ? "bg-brand" : "bg-white/15")}
          aria-pressed={style.enabled}
        >
          <span className={cx("absolute top-0.5 size-5 rounded-full bg-white transition", style.enabled ? "left-[22px]" : "left-0.5")} />
        </button>
      </div>

      <div>
        <Label>Estilo</Label>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(CAPTION_PRESETS) as CaptionPresetId[]).map((p) => {
            const preset = CAPTION_PRESETS[p].style;
            return (
              <button
                key={p}
                type="button"
                onClick={() => onChange({ ...preset, enabled: style.enabled })}
                className={cx(
                  "rounded-xl border px-3 py-2.5 text-left transition",
                  style.preset === p ? "border-brand/60 bg-brand/10" : "border-line bg-surface-2 hover:border-line-strong",
                )}
              >
                <span
                  className="block truncate text-sm"
                  style={{ fontFamily: FONT_VARS[preset.font], fontWeight: preset.bold ? 800 : 500, textTransform: preset.uppercase ? "uppercase" : undefined }}
                >
                  {CAPTION_PRESETS[p].label.split(" ")[0]} <span style={{ color: preset.highlightColor }}>Aa</span>
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-subtle">{CAPTION_PRESETS[p].description}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Fonte</Label>
          <select
            value={style.font}
            onChange={(e) => set("font", e.target.value as CaptionStyle["font"])}
            className="h-10 w-full rounded-xl border border-line bg-surface-2 px-3 text-sm outline-none"
          >
            {CAPTION_FONTS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label hint={`${style.fontSize}px`}>Tamanho</Label>
          <input type="range" min={36} max={140} value={style.fontSize} onChange={(e) => set("fontSize", Number(e.target.value))} className="mt-3 w-full" />
        </div>
      </div>

      <div>
        <Label>Posição</Label>
        <Segmented value={style.position} onChange={(v) => set("position", v)} options={[["top", "Topo"], ["middle", "Meio"], ["bottom", "Base"]]} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ColorField label="Cor do texto" value={style.color} onChange={(v) => set("color", v)} />
        <ColorField label="Cor de destaque" value={style.highlightColor} onChange={(v) => set("highlightColor", v)} />
      </div>

      <div>
        <Label>Fundo</Label>
        <Segmented value={style.background} onChange={(v) => set("background", v)} options={[["none", "Nenhum"], ["shadow", "Contorno"], ["box", "Caixa"]]} />
      </div>
      {style.background !== "none" && (
        <div className="grid grid-cols-2 gap-3">
          <ColorField label="Cor do fundo" value={style.backgroundColor} onChange={(v) => set("backgroundColor", v)} />
          <div>
            <Label hint={`${Math.round(style.backgroundOpacity * 100)}%`}>Opacidade</Label>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(style.backgroundOpacity * 100)}
              onChange={(e) => set("backgroundOpacity", Number(e.target.value) / 100)}
              className="mt-3 w-full"
            />
          </div>
        </div>
      )}

      <div>
        <Label>Destaque</Label>
        <Segmented
          value={style.highlightMode}
          onChange={(v) => set("highlightMode", v)}
          options={[["word", "Palavra falada"], ["keywords", "Palavras-chave"], ["none", "Nenhum"]]}
        />
      </div>

      <div>
        <Label>Animação</Label>
        <Segmented value={style.animation} onChange={(v) => set("animation", v)} options={[["none", "Nenhuma"], ["pop", "Pop"], ["fade", "Fade"]]} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label hint={style.wordsPerLine}>Palavras por vez</Label>
          <input type="range" min={1} max={8} value={style.wordsPerLine} onChange={(e) => set("wordsPerLine", Number(e.target.value))} className="mt-3 w-full" />
        </div>
        <div className="space-y-2 pt-6 text-sm">
          <label className="flex items-center gap-2 text-muted">
            <input type="checkbox" checked={style.uppercase} onChange={(e) => set("uppercase", e.target.checked)} /> CAIXA ALTA
          </label>
          <label className="flex items-center gap-2 text-muted">
            <input type="checkbox" checked={style.bold} onChange={(e) => set("bold", e.target.checked)} /> Negrito
          </label>
          <label className="flex items-center gap-2 text-muted">
            <input type="checkbox" checked={style.highlightKeywords} onChange={(e) => set("highlightKeywords", e.target.checked)} /> Destacar palavras-chave
          </label>
        </div>
      </div>
    </div>
  );
}
