#!/usr/bin/env python3
"""
Transcrição LOCAL e gratuita com faster-whisper (open source, licença MIT).
Nenhum dado sai da máquina e não há custo por minuto — só CPU/GPU.

Uso: local_whisper.py <audio> [idioma|auto]
Variáveis: LOCAL_WHISPER_MODEL (tiny|base|small|medium|large-v3|large-v3-turbo; padrão small),
           LOCAL_WHISPER_DEVICE (cpu|cuda|auto; padrão cpu), LOCAL_WHISPER_COMPUTE (int8 padrão),
           LOCAL_WHISPER_DIR (cache dos modelos; baixados do Hugging Face na 1ª execução).
Saída (stdout): JSON {text, language, duration, words:[{w,s,e}], segments:[{s,e,t}]}
"""
import json
import os
import sys


def main() -> None:
    from faster_whisper import WhisperModel

    audio = sys.argv[1]
    language = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] not in ("", "auto") else None
    model = WhisperModel(
        os.environ.get("LOCAL_WHISPER_MODEL", "small"),
        device=os.environ.get("LOCAL_WHISPER_DEVICE", "cpu"),
        compute_type=os.environ.get("LOCAL_WHISPER_COMPUTE", "int8"),
        download_root=os.environ.get("LOCAL_WHISPER_DIR") or None,
    )
    segments, info = model.transcribe(
        audio,
        language=language,
        word_timestamps=True,
        vad_filter=True,  # pula trechos sem fala (mais rápido)
        beam_size=int(os.environ.get("LOCAL_WHISPER_BEAM", "5")),
    )
    words, segs, texts = [], [], []
    for seg in segments:
        text = seg.text.strip()
        segs.append({"s": round(seg.start, 3), "e": round(seg.end, 3), "t": text})
        texts.append(text)
        for w in seg.words or []:
            token = w.word.strip()
            if token:
                words.append({"w": token, "s": round(w.start, 3), "e": round(max(w.end, w.start + 0.05), 3)})
        # progresso para logs do worker
        print(f"progress {seg.end:.1f}/{info.duration:.1f}", file=sys.stderr, flush=True)
    print(json.dumps({"text": " ".join(texts), "language": info.language, "duration": info.duration, "words": words, "segments": segs}, ensure_ascii=False))


if __name__ == "__main__":
    main()
