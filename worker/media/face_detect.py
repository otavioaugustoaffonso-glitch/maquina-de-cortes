#!/usr/bin/env python3
"""
Detecção de rostos para enquadramento automático (auto-reframe 9:16).

Uso: face_detect.py <video> <inicio_s> <fim_s> [amostras_por_segundo]
Saída (stdout, JSON):
  {"width": W, "height": H, "samples": [{"t": 12.3, "faces": [[cx, cy, w, h], ...]}, ...]}
Coordenadas normalizadas (0..1) em relação ao quadro. Tempos no vídeo de entrada.

Usa o classificador Haar que acompanha o OpenCV (sem download de modelos).
"""
import json
import sys

import cv2


def main() -> None:
    path = sys.argv[1]
    start = float(sys.argv[2])
    end = float(sys.argv[3])
    fps_sample = float(sys.argv[4]) if len(sys.argv) > 4 else 3.0

    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        print(json.dumps({"error": "não foi possível abrir o vídeo"}))
        sys.exit(1)

    width = cap.get(cv2.CAP_PROP_FRAME_WIDTH)
    height = cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, int(round(fps / fps_sample)))

    frontal = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    profile = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_profileface.xml")

    cap.set(cv2.CAP_PROP_POS_MSEC, start * 1000.0)
    samples = []
    i = 0
    while True:
        t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
        if t > end:
            break
        if i % step != 0:
            if not cap.grab():
                break
            i += 1
            continue
        ok, frame = cap.read()
        i += 1
        if not ok:
            break
        h, w = frame.shape[:2]
        scale = 480.0 / w if w > 480 else 1.0
        small = cv2.resize(frame, (int(w * scale), int(h * scale))) if scale != 1.0 else frame
        gray = cv2.equalizeHist(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY))
        min_side = max(24, int(gray.shape[0] * 0.07))
        faces = frontal.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6, minSize=(min_side, min_side))
        if len(faces) == 0:
            faces = profile.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6, minSize=(min_side, min_side))
        gw, gh = float(gray.shape[1]), float(gray.shape[0])
        norm = [
            [round((x + fw / 2) / gw, 4), round((y + fh / 2) / gh, 4), round(fw / gw, 4), round(fh / gh, 4)]
            for (x, y, fw, fh) in faces
        ]
        samples.append({"t": round(t, 3), "faces": norm})

    cap.release()
    print(json.dumps({"width": width, "height": height, "samples": samples}))


if __name__ == "__main__":
    main()
