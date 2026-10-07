import { spawn } from "node:child_process";
import { env } from "../env";
import { log } from "../log";

export type RunOptions = {
  /** Duração esperada da saída (s) para calcular progresso 0..1. */
  expectedDuration?: number;
  onProgress?: (fraction: number) => void;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Mantém todo o stderr (ex.: saída do silencedetect). Por padrão guarda só o final. */
  fullStderr?: boolean;
};

/** Executa um binário (ffmpeg/ffprobe/python) sem shell — sem risco de injeção. */
export function run(bin: string, args: string[], opts: RunOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], signal: opts.signal });
    let stdout = "";
    let stderr = "";
    let lastReport = 0;
    const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : null;

    child.stdout.on("data", (d: Buffer) => {
      const chunk = d.toString();
      if (opts.onProgress && opts.expectedDuration) {
        // saída de `-progress pipe:1`: linhas "out_time_us=123456"
        const m = chunk.match(/out_time_us=(\d+)/g);
        if (m) {
          const us = Number(m[m.length - 1].split("=")[1]);
          const frac = Math.min(1, us / 1e6 / opts.expectedDuration);
          if (frac - lastReport >= 0.02) {
            lastReport = frac;
            opts.onProgress(frac);
          }
        }
      } else {
        stdout += chunk;
      }
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (!opts.fullStderr && stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else {
        const tail = stderr.split("\n").slice(-25).join("\n");
        log.debug("processo falhou", { bin, args: args.join(" ").slice(0, 2000), tail });
        reject(new Error(`${bin} saiu com código ${code}: ${tail.slice(-1500)}`));
      }
    });
  });
}

export function ffmpeg(args: string[], opts: RunOptions = {}) {
  const base = ["-hide_banner", "-nostdin", "-y", "-loglevel", "error"];
  const progress = opts.onProgress ? ["-progress", "pipe:1", "-nostats"] : [];
  return run(env.ffmpegBin, [...base, ...progress, ...args], opts);
}

export type ProbeResult = {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  hasVideo: boolean;
  videoCodec?: string;
  formatName?: string;
};

type FfprobeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  tags?: Record<string, string>;
  side_data_list?: { rotation?: number }[];
  duration?: string;
};

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await run(env.ffprobeBin, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  const data = JSON.parse(stdout) as { streams?: FfprobeStream[]; format?: { duration?: string; format_name?: string } };
  const streams = data.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video" && s.codec_name !== "mjpeg" && s.codec_name !== "png");
  const a = streams.find((s) => s.codec_type === "audio");
  const rate = (r?: string) => {
    if (!r) return 0;
    const [n, d] = r.split("/").map(Number);
    return d ? n / d : n;
  };
  let width = v?.width ?? 0;
  let height = v?.height ?? 0;
  const rotation = Math.abs(Number(v?.tags?.rotate ?? v?.side_data_list?.find((s) => s.rotation != null)?.rotation ?? 0)) % 180;
  if (rotation === 90) [width, height] = [height, width]; // ffmpeg aplica a rotação automaticamente
  const duration = Number(data.format?.duration ?? v?.duration ?? 0);
  return {
    duration: Number.isFinite(duration) ? duration : 0,
    width,
    height,
    fps: Math.round((rate(v?.avg_frame_rate) || rate(v?.r_frame_rate)) * 1000) / 1000,
    hasAudio: Boolean(a),
    hasVideo: Boolean(v),
    videoCodec: v?.codec_name,
    formatName: data.format?.format_name,
  };
}
