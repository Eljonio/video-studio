#!/usr/bin/env bash
# post-blender.sh — узел «Пост» на нодовом композе Blender. Тот же интерфейс, что у post-film.sh.
# Blender композит без потерь (FFV1), ffmpeg доводит: смаз затвора, звук, финальный h264, пережатие.
#   post-blender.sh -i IN.mp4 -o OUT.mp4 -p light|medium|film|camcorder|phone [--degrade|--no-degrade] [-b 6M]
set -euo pipefail
IN=""; OUT=""; PRESET="medium"; DEGRADE=""; MAXRATE=""; TMIX=""
if [[ $# -ge 2 && "${1:0:1}" != "-" ]]; then IN="$1"; OUT="$2"; shift 2
  [[ $# -ge 1 && "${1:0:1}" != "-" ]] && { PRESET="$1"; shift; }; fi
while [[ $# -gt 0 ]]; do case "$1" in
  -i|--input) IN="$2"; shift 2;; -o|--output) OUT="$2"; shift 2;;
  -p|--preset) PRESET="$2"; shift 2;; -b|--maxrate) MAXRATE="$2"; shift 2;;
  --degrade) DEGRADE=1; shift;; --no-degrade) DEGRADE=0; shift;;
  -h|--help) sed -n '2,6p' "$0"; exit 0;;
  *) echo "неизвестный аргумент: $1" >&2; exit 2;; esac; done
[[ -n "$IN" && -n "$OUT" ]] || { echo "нужны -i вход и -o выход" >&2; exit 2; }

# смаз затвора нодами не сделать — компоузер не видит соседние кадры, это остаётся за ffmpeg
case "$PRESET" in
  light)     TMIX="";         CRF=21; DEG_DEF=0;;
  medium)    TMIX="1 10 1";   CRF=23; DEG_DEF=0;;
  film)      TMIX="1 7 1";    CRF=21; DEG_DEF=1;;
  camcorder) TMIX="1 5 1";    CRF=25; DEG_DEF=1;;
  phone)     TMIX="1 9 1";    CRF=24; DEG_DEF=1;;
  *) echo "пресет: light|medium|film|camcorder|phone" >&2; exit 2;;
esac
[[ -n "$DEGRADE" ]] || DEGRADE=$DEG_DEF
HAS_A=$(ffprobe -v error -select_streams a:0 -show_entries stream=index -of csv=p=0 "$IN" | head -1)

TMPD=$(mktemp -d); trap 'rm -rf "$TMPD"' EXIT
SELF=$(dirname "$(readlink -f "$0")")
echo "[1/3] нодовый композ в Blender ($PRESET)…"
blender -b --factory-startup --python "$SELF/post-blender.py" -- "$IN" "$TMPD/comp_" "$PRESET" >/dev/null 2>&1
RAW=$(ls "$TMPD"/comp_*.mkv 2>/dev/null | head -1)
[[ -n "$RAW" ]] || { echo "Blender не отдал файл" >&2; exit 1; }

echo "[2/3] смаз затвора, звук и кодирование…"
VF="null"; [[ -n "$TMIX" ]] && VF="tmix=frames=3:weights='$TMIX'"
if [[ -n "$HAS_A" ]]; then
  AIN=(-i "$IN")
  AF=";[1:a]aresample=48000,highpass=f=55,lowpass=f=15500,acompressor=threshold=-20dB:ratio=2:attack=20:release=250,aformat=channel_layouts=stereo[a0];
anoisesrc=c=pink:a=0.006:r=48000,pan=stereo|c0=c0|c1=c0[room];
[a0][room]amix=inputs=2:weights='1 0.18':duration=first:normalize=0,alimiter=limit=0.95[aout]"
  AMAP=(-map "[vout]" -map "[aout]" -c:a aac -b:a 128k -ar 48000)
else AIN=(); AF=""; AMAP=(-map "[vout]" -an); fi
VENC=(-c:v libx264 -preset slow -crf "$CRF" -tune film -x264-params "aq-mode=3:deblock=-1,-1")
[[ -n "$MAXRATE" ]] && VENC+=(-maxrate "$MAXRATE" -bufsize "$(awk -v m=${MAXRATE%[Mm]} 'BEGIN{printf "%.1fM",m*1.8}')")
STAGE1="$OUT"; [[ "$DEGRADE" == "1" ]] && STAGE1="$TMPD/stage1.mp4"
mkdir -p "$(dirname "$OUT")"
ffmpeg -hide_banner -loglevel error -y -i "$RAW" "${AIN[@]}" \
  -filter_complex "[0:v]${VF},format=yuv420p[vout]${AF}" "${AMAP[@]}" "${VENC[@]}" \
  -pix_fmt yuv420p -movflags +faststart "$STAGE1"

if [[ "$DEGRADE" == "1" ]]; then
  echo "[3/3] пережатие «соцсеть туда-обратно»…"
  ffmpeg -hide_banner -loglevel error -y -i "$STAGE1" -c:v libx264 -preset fast -crf $((CRF+3)) \
    -tune film -x264-params "deblock=0,0" -pix_fmt yuv420p -c:a copy "$TMPD/stage2.mp4"
  ffmpeg -hide_banner -loglevel error -y -i "$TMPD/stage2.mp4" -c:v libx264 -preset slow -crf "$CRF" \
    -tune film -x264-params "aq-mode=3:deblock=-1,-1" -pix_fmt yuv420p -c:a copy -movflags +faststart "$OUT"
fi
BR=$(ffprobe -v error -show_entries format=bit_rate -of csv=p=0 "$OUT")
echo "готово: $OUT  [blender/$PRESET]  $(du -h "$OUT"|cut -f1)  $((BR/1000)) кбит/с"
