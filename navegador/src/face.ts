/**
 * Detecção de rosto no navegador (face-api / TinyFaceDetector, MIT, modelo de ~190 KB)
 * para manter a pessoa principal centralizada no recorte vertical.
 * A biblioteca é carregada só quando necessária, a partir dos arquivos da própria página.
 */
import { buildFramingTrack, type FaceSample } from "@/lib/clips/framing";
import type { TimeRange } from "@/lib/clips/timing";
import type { Framing } from "@/lib/types";

type FaceApi = {
  nets: { tinyFaceDetector: { loadFromUri(uri: string): Promise<void>; isLoaded: boolean } };
  TinyFaceDetectorOptions: new (o: { inputSize: number; scoreThreshold: number }) => unknown;
  detectAllFaces(input: HTMLCanvasElement, options: unknown): Promise<{ score: number; box: { x: number; y: number; width: number; height: number } }[]>;
  tf: { setBackend(b: string): Promise<boolean>; ready(): Promise<void> };
};

let api: Promise<FaceApi> | null = null;

function loadApi(): Promise<FaceApi> {
  api ??= (async () => {
    const mod = (await import(/* @vite-ignore */ new URL("./face-api.esm.js", import.meta.url).href)) as FaceApi & { default?: FaceApi };
    const fa = (mod.nets ? mod : mod.default) as FaceApi;
    try {
      await fa.tf.setBackend("webgl");
    } catch {
      await fa.tf.setBackend("cpu");
    }
    await fa.tf.ready();
    await fa.nets.tinyFaceDetector.loadFromUri(new URL("./face/", import.meta.url).href);
    return fa;
  })();
  return api;
}

const seek = (v: HTMLVideoElement, t: number) =>
  new Promise<void>((r) => {
    v.addEventListener("seeked", () => r(), { once: true });
    v.currentTime = t;
  });

/** Amostra ~1 quadro por segundo do trecho e devolve a trilha de enquadramento. */
export async function detectFraming(video: HTMLVideoElement, segments: TimeRange[], onProgress?: (f: number) => void): Promise<Framing> {
  const center: Framing = { mode: "center", keyframes: [{ t: 0, x: 0.5 }] };
  try {
    const fa = await loadApi();
    const canvas = document.createElement("canvas");
    // 640 px de largura + entrada 608: encontra rostos pequenos (ex.: plano aberto de podcast)
    const scale = Math.min(1, 640 / Math.max(video.videoWidth, 1));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const options = new fa.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.3 });
    const start = segments[0].s;
    const end = segments[segments.length - 1].e;
    const step = Math.max(1, (end - start) / 90);
    const samples: FaceSample[] = [];
    for (let t = start; t < end; t += step) {
      await seek(video, t);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const all = await fa.detectAllFaces(canvas, options);
      // descarta falsos positivos: fica só com as detecções mais confiáveis
      const best = Math.max(0, ...all.map((d) => d.score));
      const dets = all.filter((d) => d.score >= best - 0.08);
      samples.push({
        t,
        faces: dets.map((d) => [
          (d.box.x + d.box.width / 2) / canvas.width,
          (d.box.y + d.box.height / 2) / canvas.height,
          d.box.width / canvas.width,
          d.box.height / canvas.height,
        ]),
      });
      onProgress?.((t - start) / (end - start));
    }
    return buildFramingTrack(samples, segments);
  } catch (e) {
    console.warn("Detecção de rosto indisponível; usando o centro.", e);
    return center;
  }
}
