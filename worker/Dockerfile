# Worker de processamento (FFmpeg + OpenCV + Node). Build a partir da RAIZ do repositório:
#   docker build -f worker/Dockerfile -t maquina-de-cortes-worker .
#   docker run --env-file .env maquina-de-cortes-worker
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg python3 python3-venv libglib2.0-0 fontconfig fonts-inter curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY worker/requirements.txt worker/requirements.txt
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r worker/requirements.txt
ENV PYTHON_BIN=/opt/venv/bin/python

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY tsconfig.json ./
COPY src/lib ./src/lib
COPY worker ./worker
RUN bash worker/fonts/download.sh && fc-cache -f

ENV NODE_ENV=production \
    WORKER_FONTS_DIR=/app/worker/fonts \
    WORKER_TMP_DIR=/tmp/maquina-de-cortes \
    LOCAL_WHISPER_DIR=/models
# Os modelos do faster-whisper são baixados na 1ª execução; monte um volume em /models para reaproveitar.
VOLUME /models

# Encerramento gracioso: o worker termina os jobs em andamento ao receber SIGTERM
STOPSIGNAL SIGTERM
CMD ["node", "--import", "tsx", "worker/index.ts"]
