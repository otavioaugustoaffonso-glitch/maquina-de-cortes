/**
 * Extração do áudio (16 kHz mono) sem carregar o vídeo inteiro na memória.
 *
 * O caminho antigo (file.arrayBuffer + decodeAudioData) precisa do arquivo inteiro
 * mais o áudio decodificado na taxa original ao mesmo tempo: num vídeo de celular de
 * algumas centenas de MB isso passa do limite de memória da aba e o navegador a fecha.
 *
 * Aqui o mp4box.js lê só o índice do MP4/MOV (moov); os quadros de áudio são lidos do
 * arquivo em janelas de 4 MB, decodificados pelo WebCodecs (AudioDecoder) e já reduzidos
 * para 16 kHz mono. Pico de memória: ~1 janela + o áudio final (~3,8 MB por minuto).
 */
// @ts-expect-error mp4box 0.5 não publica tipos
import MP4Box from "mp4box";

const SR = 16000;
const WINDOW = 4 * 1024 * 1024;

type Mp4Sample = { offset: number; size: number; cts: number; duration: number; timescale: number };
type Mp4Track = { id: number; codec: string; audio?: { sample_rate: number; channel_count: number } };
type Mp4Trak = {
  samples: Mp4Sample[];
  mdia: { minf: { stbl: { stsd: { entries: { esds?: { esd: { descs: { descs: { data: Uint8Array }[] }[] } } }[] } } } };
};

export const canStreamAudio = (file: File) =>
  typeof AudioDecoder === "function" &&
  (/\.(mp4|m4v|mov)$/i.test(file.name) || /^video\/(mp4|quicktime|x-m4v)$/.test(file.type));

/** Buffer que cresce sob demanda. */
class PcmSink {
  buf: Float32Array;
  len = 0;
  constructor(initial: number) {
    this.buf = new Float32Array(Math.max(SR, initial));
  }
  push(v: number) {
    if (this.len === this.buf.length) {
      const next = new Float32Array(Math.ceil(this.buf.length * 1.25));
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.len++] = v;
  }
}

/** Lê só o índice do arquivo (pula os dados de mídia) e devolve a trilha de áudio. */
async function readIndex(file: File) {
  const mp4 = MP4Box.createFile(false); // false = não guardar os dados de mídia
  let info: { audioTracks: Mp4Track[] } | null = null;
  let error: string | null = null;
  mp4.onReady = (i: typeof info) => (info = i);
  mp4.onError = (e: string) => (error = e);
  let offset = 0;
  while (!info && !error && offset < file.size) {
    const buf = (await file.slice(offset, offset + WINDOW).arrayBuffer()) as ArrayBuffer & { fileStart: number };
    buf.fileStart = offset;
    const next: unknown = mp4.appendBuffer(buf);
    // o mp4box indica onde continuar (ex.: pula o mdat para chegar ao moov no fim do arquivo)
    offset = typeof next === "number" && next > offset ? next : offset + buf.byteLength;
  }
  if (!info) throw new Error(error ?? "índice do vídeo não encontrado");
  const track = (info as { audioTracks: Mp4Track[] }).audioTracks[0];
  if (!track?.audio) throw new Error("Este vídeo não tem áudio.");
  const trak: Mp4Trak = mp4.getTrackById(track.id);
  return { track, audio: track.audio, trak };
}

export async function streamAudio(file: File, duration: number, onProgress: (p: number) => void): Promise<Float32Array> {
  const { track, audio, trak } = await readIndex(file);
  const config: AudioDecoderConfig = { codec: track.codec, sampleRate: audio.sample_rate, numberOfChannels: audio.channel_count };
  const desc = trak.mdia.minf.stbl.stsd.entries[0]?.esds?.esd.descs[0]?.descs[0]?.data;
  if (desc) config.description = desc;
  if (!(await AudioDecoder.isConfigSupported(config)).supported) throw new Error(`codec de áudio não suportado (${track.codec})`);

  const sink = new PcmSink(Math.ceil((duration || 60) * SR) + SR);
  let failure: unknown = null;
  // reamostragem por média em janela (passa-baixa simples, suficiente para fala)
  let ratio = 0;
  let acc = 0;
  let n = 0;
  let pos = 0;
  let tmp = new Float32Array(0);
  let mono = new Float32Array(0);

  const decoder = new AudioDecoder({
    output: (data) => {
      try {
        const frames = data.numberOfFrames;
        const ch = data.numberOfChannels;
        ratio ||= data.sampleRate / SR;
        if (tmp.length < frames) {
          tmp = new Float32Array(frames);
          mono = new Float32Array(frames);
        }
        mono.fill(0, 0, frames);
        for (let c = 0; c < ch; c++) {
          data.copyTo(tmp, { planeIndex: c, format: "f32-planar" });
          for (let i = 0; i < frames; i++) mono[i] += tmp[i] / ch;
        }
        for (let i = 0; i < frames; i++) {
          acc += mono[i];
          n++;
          if (++pos >= ratio) {
            pos -= ratio;
            sink.push(acc / n);
            acc = 0;
            n = 0;
          }
        }
      } catch (e) {
        failure ??= e;
      } finally {
        data.close();
      }
    },
    error: (e) => (failure ??= e),
  });
  decoder.configure(config);

  const samples = trak.samples;
  let i = 0;
  while (i < samples.length) {
    // janela contínua do arquivo cobrindo vários quadros de áudio consecutivos
    const start = samples[i].offset;
    let j = i;
    while (j < samples.length && samples[j].offset >= start && samples[j].offset + samples[j].size - start <= WINDOW) j++;
    if (j === i) j = i + 1; // quadro maior que a janela (não acontece na prática)
    const end = Math.max(...samples.slice(i, j).map((s) => s.offset + s.size));
    const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
    for (let k = i; k < j; k++) {
      const s = samples[k];
      decoder.decode(
        new EncodedAudioChunk({
          type: "key",
          timestamp: (s.cts * 1e6) / s.timescale,
          duration: (s.duration * 1e6) / s.timescale,
          data: bytes.subarray(s.offset - start, s.offset - start + s.size),
        }),
      );
    }
    i = j;
    if (failure) break;
    onProgress(i / samples.length);
    while (decoder.decodeQueueSize > 200) await new Promise((r) => setTimeout(r, 5));
  }
  if (!failure) await decoder.flush();
  decoder.close();
  if (failure) throw failure instanceof Error ? failure : new Error(String(failure));
  return sink.buf.subarray(0, sink.len);
}
