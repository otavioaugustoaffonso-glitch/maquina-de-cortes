#!/usr/bin/env bash
# Baixa as fontes (licença OFL) usadas nas legendas renderizadas pelo FFmpeg/libass.
# Os mesmos nomes de fonte são usados no preview do navegador (next/font).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
GF="https://raw.githubusercontent.com/google/fonts/main/ofl"

fetch() {
  local url="$1" out="$DIR/$2"
  if [ -s "$out" ]; then return; fi
  echo "baixando $2"
  curl -fsSL --retry 3 "$url" -o "$out" || { echo "AVISO: falha ao baixar $2 (o libass usará uma fonte substituta)"; rm -f "$out"; }
}

fetch "$GF/anton/Anton-Regular.ttf" "Anton-Regular.ttf"
fetch "$GF/bebasneue/BebasNeue-Regular.ttf" "BebasNeue-Regular.ttf"
fetch "$GF/poppins/Poppins-Medium.ttf" "Poppins-Medium.ttf"
fetch "$GF/poppins/Poppins-Bold.ttf" "Poppins-Bold.ttf"
fetch "https://raw.githubusercontent.com/JulietaUla/Montserrat/master/fonts/ttf/Montserrat-SemiBold.ttf" "Montserrat-SemiBold.ttf"
fetch "https://raw.githubusercontent.com/JulietaUla/Montserrat/master/fonts/ttf/Montserrat-ExtraBold.ttf" "Montserrat-ExtraBold.ttf"
# Inter vem do pacote do sistema (fonts-inter) no Docker; aqui baixamos como reserva.
fetch "$GF/inter/Inter%5Bopsz,wght%5D.ttf" "Inter-Variable.ttf"
echo "fontes em $DIR"
