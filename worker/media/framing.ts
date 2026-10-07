import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFramingTrack, type FaceSample } from "@/lib/clips/framing";
import type { TimeRange } from "@/lib/clips/timing";
import type { Framing } from "@/lib/types";
import { env } from "../env";
import { log } from "../log";
import { run } from "./ffmpeg";

export { buildFramingTrack };

const here = path.dirname(fileURLToPath(import.meta.url));


/** Roda o detector de rostos (Python/OpenCV) no trecho do vídeo. */
export async function detectFaces(video: string, start: number, end: number, samplesPerSecond = 3): Promise<FaceSample[]> {
  const { stdout } = await run(env.pythonBin, [path.join(here, "face_detect.py"), video, String(start), String(end), String(samplesPerSecond)], {
    timeoutMs: 10 * 60 * 1000,
  });
  const data = JSON.parse(stdout) as { samples?: FaceSample[]; error?: string };
  if (data.error) throw new Error(data.error);
  return data.samples ?? [];
}

/**
 * Expressão FFmpeg para o `x` do filtro crop, com transições suaves (pan de 0.35s)
 * entre keyframes. `srcW` = largura do quadro, `cropW` = largura do recorte.
 */
export function cropXExpression(framing: Framing, srcW: number, cropW: number, transition = 0.35): string {
  const maxX = Math.max(0, srcW - cropW);
  const px = (x: number) => Math.round(Math.min(maxX, Math.max(0, x * srcW - cropW / 2)));
  const ks = framing.keyframes.length ? framing.keyframes : [{ t: 0, x: 0.5 }];
  let expr = String(px(ks[ks.length - 1].x));
  for (let i = ks.length - 2; i >= 0; i--) {
    const a = px(ks[i].x);
    const b = px(ks[i + 1].x);
    const t1 = ks[i + 1].t.toFixed(2);
    const t2 = (ks[i + 1].t + transition).toFixed(2);
    expr = `if(lt(t,${t1}),${a},if(lt(t,${t2}),${a}+(${b - a})*(t-${t1})/${transition},${expr}))`;
  }
  return expr;
}

export async function computeFraming(
  video: string,
  start: number,
  end: number,
  segments: TimeRange[],
): Promise<Framing> {
  if (!env.faceTracking) return { mode: "center", keyframes: [{ t: 0, x: 0.5 }] };
  try {
    const samples = await detectFaces(video, start, end);
    return buildFramingTrack(samples, segments);
  } catch (e) {
    log.warn("detecção de rosto indisponível, usando enquadramento central", { error: String(e) });
    return { mode: "center", keyframes: [{ t: 0, x: 0.5 }] };
  }
}
