import type { Framing, FramingKeyframe } from "../types";
import { remapTime, type TimeRange } from "./timing";

export type FaceSample = { t: number; faces: [number, number, number, number][] };

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Converte detecções em uma trilha de enquadramento estável:
 * - escolhe o rosto principal (maior, com continuidade em relação ao anterior);
 * - suaviza com mediana móvel;
 * - só move a câmera quando o rosto sai de uma "zona morta" (evita tremedeira);
 * - tempos convertidos para o timeline de saída (após remover pausas).
 * `x` é o centro horizontal normalizado (0..1) do recorte.
 */
export function buildFramingTrack(
  samples: FaceSample[],
  segments: TimeRange[],
  opts: { deadZone?: number; minHold?: number; maxKeyframes?: number } = {},
): Framing {
  const { deadZone = 0.07, minHold = 1.2, maxKeyframes = 60 } = opts;
  const withFaces = samples.filter((s) => s.faces.length > 0);
  if (samples.length === 0 || withFaces.length / samples.length < 0.25) return { mode: "center", keyframes: [{ t: 0, x: 0.5 }] };

  // 1. rosto principal por amostra
  let prev: number | null = null;
  const raw: { t: number; x: number | null }[] = samples.map((s) => {
    if (!s.faces.length) return { t: s.t, x: null };
    const maxArea = Math.max(...s.faces.map((f) => f[2] * f[3]));
    const big = s.faces.filter((f) => f[2] * f[3] >= maxArea * 0.6);
    const chosen = prev == null ? big.sort((a, b) => b[2] * b[3] - a[2] * a[3])[0] : big.sort((a, b) => Math.abs(a[0] - prev!) - Math.abs(b[0] - prev!))[0];
    prev = chosen[0];
    return { t: s.t, x: chosen[0] };
  });

  // 2. preenche lacunas (mantém última posição conhecida) e suaviza
  let last = raw.find((r) => r.x != null)!.x!;
  const filled = raw.map((r) => {
    if (r.x != null) last = r.x;
    return { t: r.t, x: last };
  });
  const smooth = filled.map((r, i) => ({ t: r.t, x: median(filled.slice(Math.max(0, i - 3), i + 4).map((f) => f.x)) }));

  // 3. zona morta + tempo mínimo entre movimentos
  const keys: FramingKeyframe[] = [{ t: 0, x: smooth[0].x }];
  for (const p of smooth) {
    const cur = keys[keys.length - 1];
    const out = remapTime(p.t, segments);
    if (Math.abs(p.x - cur.x) > deadZone && out - cur.t >= minHold) keys.push({ t: out, x: p.x });
  }
  const trimmed = keys.length > maxKeyframes ? keys.filter((_, i) => i % Math.ceil(keys.length / maxKeyframes) === 0) : keys;
  return {
    mode: "face",
    keyframes: trimmed.map((k) => ({ t: Math.round(k.t * 100) / 100, x: Math.round(k.x * 1000) / 1000 })),
  };
}

/** Centro horizontal (0..1) do recorte no instante `t`, com transição suave entre keyframes. */
export function framingXAt(framing: Framing, t: number, transition = 0.35): number {
  const ks = framing.keyframes.length ? framing.keyframes : [{ t: 0, x: 0.5 }];
  let x = ks[0].x;
  for (let i = 1; i < ks.length; i++) {
    const k = ks[i];
    if (t < k.t) break;
    const prev = ks[i - 1].x;
    x = t < k.t + transition ? prev + (k.x - prev) * ((t - k.t) / transition) : k.x;
  }
  return x;
}
