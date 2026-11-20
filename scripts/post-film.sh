#!/usr/bin/env bash
# post-film.sh — «де-ИИ» пост для video-studio: узел «Пост».
# Задача НЕ улучшить картинку, а ДЕГРАДИРОВАТЬ её до уровня обычной съёмки:
# убрать глянец и стерильную резкость нейронки, добавить то, что есть у любой
# реальной камеры и чего нет у генерации.
#
# Порядок (физически правильный, как свет идёт до файла):
#   1 fps-конформ → 2 хроматическая аберрация (радиальная)
#   3 gate weave / микродрожание кадра → 4 потеря разрешения сенсора (down→up)
#   5 вертикальный смаз → 6 резкость ISP (телефон) → 7 мягкие углы объектива
#   8 halation → 9 смаз затвора (tmix) → 10 тон: приподнятые чёрные,
#   сжатые/пересвеченные света, roll-off цвета → 11 виньетка
#   12 сенсорный шум, ВРЕМЕННОЙ и сильнее в тенях → 13 честная компрессия
#   (+ опционально второй проход «залили в соцсеть и скачали обратно»)
#
# Использование:
#   post-film.sh -i IN.mp4 -o OUT.mp4 [-p ПРЕСЕТ] [-f FPS] [-l LUT.cube]
#                [--degrade|--no-degrade] [--nvenc] [-b 6M] [-n]
#   post-film.sh IN.mp4 OUT.mp4 [ПРЕСЕТ]
#
# Пресеты:
#   light     — минимум, только снять «пластик»: шум + микродрожание + тон
#   medium    — заметная фактура цифровой камеры, кадр остаётся рекламным
#   film      — «скан плёнки»: зерно, halation, дрожание, пережатие
#   camcorder — бытовая камера: мягче, шумнее, ниже разрешение, вертикальный смаз
#   phone     — снято на телефон: резко в центре, пересветы, компрессия
#   tiktok    — «тёмный зернистый TikTok» (по текстурному референсу из соцсетей).
#               Цель по цифрам: яркость ~50/255, чёрное (<=10) ~30 %, зерно ×3 от camera,
#               лицо при этом читается. Разрешение и резкость НЕ трогаем — убиваем свет.
#   camera    — ФИЗИКА КАМЕРЫ без потери качества: резкость, разрешение и битрейт
#               НЕ трогаются вообще. Работаем только с тем, чем реальная съёмка
#               отличается от рендера при той же резкости: ограниченный динамический
#               диапазон (света реально выбиты, тени реально потеряны), дыхание
#               автоэкспозиции, неидеальный баланс белого, человеческая моторика
#               камеры, смаз затвора, тонкое зерно в тенях.
set -euo pipefail

IN=""; OUT=""; PRESET="medium"; FPS=""; LUT=""; DEGRADE=""; DRY=0; ENC="libx264"; MAXRATE=""
if [[ $# -ge 2 && "${1:0:1}" != "-" ]]; then
  IN="$1"; OUT="$2"; shift 2
  if [[ $# -ge 1 && "${1:0:1}" != "-" ]]; then PRESET="$1"; shift; fi
fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    -i|--input)  IN="$2"; shift 2;;
    -o|--output) OUT="$2"; shift 2;;
    -p|--preset) PRESET="$2"; shift 2;;
    -f|--fps)    FPS="$2"; shift 2;;
    -l|--lut)    LUT="$2"; shift 2;;
    --degrade)    DEGRADE=1; shift;;
    --no-degrade) DEGRADE=0; shift;;
    --nvenc)     ENC="h264_nvenc"; shift;;
    -b|--maxrate) MAXRATE="$2"; shift 2;;  # напр. 6M — потолок битрейта
    -n|--dry-run) DRY=1; shift;;
    -h|--help)   sed -n '2,28p' "$0"; exit 0;;
    *) echo "неизвестный аргумент: $1" >&2; exit 2;;
  esac
done
[[ -n "$IN" && -n "$OUT" ]] || { echo "нужны -i вход и -o выход" >&2; exit 2; }
[[ -f "$IN" ]] || { echo "нет файла: $IN" >&2; exit 2; }

# OV  оверскан под дрожание   AMP  амплитуда дрожания, px
# CA  хроматическая аберрация SDOWN потеря разрешения (1.0 = нет)
# VSM вертикальный смаз       SOFT мягкость углов   SHARP резкость ISP
# HAL halation                TMIX веса смаза затвора
# GS  сила шума               GOP  доля шума        VIG  виньетка
# GSCALE размер зерна: 2 = крупное плёночное, 1 = попиксельное цифровое
# SHN 1 = шум сильнее в тенях CRF  качество финала   DEG  второй проход
case "$PRESET" in
  light)
    OV=0.016; AMP=1.2; CA=0;      SDOWN=1.00; VSM=0;   SOFT=0;   SHARP=0;    HAL=0.08; TMIX="";        \
    GS=18; GOP=0.20; VIG="PI/6";   SAT=0.98; CON=1.01; SHN=1; CRF=21; DEG_DEF=0; AUD=light; \
    CR='0/0.014 0.25/0.248 0.5/0.5 0.75/0.756 1/0.986'; \
    CG='0/0.013 0.25/0.246 0.5/0.5 0.75/0.753 1/0.984'; \
    CB='0/0.020 0.25/0.252 0.5/0.5 0.75/0.749 1/0.980';;
  medium)
    OV=0.024; AMP=2.0; CA=0.0018; SDOWN=0.92; VSM=0;   SOFT=0.7; SHARP=0.20; HAL=0.13; TMIX="1 10 1"; \
    GS=34; GOP=0.38; VIG="PI/5";   SAT=0.95; CON=1.03; SHN=1; CRF=23; DEG_DEF=0; AUD=full; \
    CR='0/0.024 0.25/0.242 0.5/0.504 0.75/0.772 1/0.968'; \
    CG='0/0.022 0.25/0.240 0.5/0.5   0.75/0.766 1/0.964'; \
    CB='0/0.034 0.25/0.253 0.5/0.496 0.75/0.756 1/0.958';;
  film)
    OV=0.034; AMP=3.0; CA=0.0032; SDOWN=1.00; VSM=0;   SOFT=1.2; SHARP=0.30; HAL=0.19; TMIX="1 7 1";  \
    GS=42; GOP=0.46; VIG="PI/4.8"; SAT=0.91; CON=1.05; SHN=1; CRF=21; DEG_DEF=1; AUD=full; \
    CR='0/0.030 0.25/0.238 0.5/0.508 0.75/0.788 1/0.956'; \
    CG='0/0.027 0.25/0.235 0.5/0.5   0.75/0.780 1/0.950'; \
    CB='0/0.042 0.25/0.252 0.5/0.492 0.75/0.762 1/0.942';;
  camcorder)
    OV=0.030; AMP=3.6; CA=0.0022; SDOWN=0.62; VSM=0.9; SOFT=0.5; SHARP=0;    HAL=0.10; TMIX="1 5 1";  \
    GS=46; GOP=0.50; VIG="PI/5.5"; SAT=0.88; CON=0.96; SHN=1; CRF=25; DEG_DEF=1; AUD=full; \
    CR='0/0.058 0.25/0.262 0.5/0.5   0.75/0.735 1/0.928'; \
    CG='0/0.054 0.25/0.259 0.5/0.5   0.75/0.732 1/0.924'; \
    CB='0/0.068 0.25/0.268 0.5/0.497 0.75/0.726 1/0.916';;
  phone)
    OV=0.020; AMP=2.6; CA=0.0026; SDOWN=0.88; VSM=0;   SOFT=0.9; SHARP=0.55; HAL=0.12; TMIX="1 9 1";  \
    GS=32; GOP=0.34; VIG="PI/5";   SAT=1.04; CON=1.06; SHN=1; CRF=24; DEG_DEF=1; AUD=full; \
    CR='0/0.026 0.25/0.240 0.5/0.524 0.82/0.975 1/1'; \
    CG='0/0.024 0.25/0.238 0.5/0.520 0.82/0.970 1/1'; \
    CB='0/0.034 0.25/0.248 0.5/0.512 0.82/0.958 1/1';;
  tiktok)
    OV=0.018; AMP=2.4; CA=0.0010;SDOWN=1.00; VSM=0;   SOFT=0;   SHARP=0.25; HAL=0.06; TMIX="1 10 1"; \
    GS=46; GOP=0.28; GSCALE=1; VIG="PI/5"; SAT=0.90; CON=1.00; SHN=0; CRF=22; DEG_DEF=0; AUD=full; \
    CR='0/0.004 0.12/0.042 0.25/0.112 0.5/0.290 0.75/0.560 1/0.925'; \
    CG='0/0.004 0.12/0.040 0.25/0.108 0.5/0.285 0.75/0.552 1/0.918'; \
    CB='0/0.008 0.12/0.046 0.25/0.116 0.5/0.281 0.75/0.542 1/0.908';;
  camera)
    OV=0.015; AMP=2.2; CA=0.0012;SDOWN=1.00; VSM=0;   SOFT=0;   SHARP=0;    HAL=0.10; TMIX="1 8 1";  \
    GS=22; GOP=0.26; VIG="PI/7";   SAT=0.99; CON=1.00; SHN=1; CRF=18; DEG_DEF=0; AUD=full; \
    EXPO='0.006*sin(2*PI*t*0.17)+0.004*sin(2*PI*t*0.41)'; \
    CBAL='rs=0.012:bs=-0.010:rh=0.014:bh=-0.012'; \
    CR='0/0.008 0.06/0.038 0.25/0.236 0.5/0.506 0.88/0.988 1/1'; \
    CG='0/0.007 0.06/0.036 0.25/0.234 0.5/0.500 0.88/0.984 1/1'; \
    CB='0/0.013 0.06/0.043 0.25/0.240 0.5/0.494 0.88/0.976 1/1';;
  *) echo "пресет: light|medium|film|camcorder|phone|camera|tiktok" >&2; exit 2;;
esac
[[ -n "$DEGRADE" ]] || DEGRADE=$DEG_DEF

IFS=, read -r W H SFPS < <(ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height,r_frame_rate -of csv=p=0 "$IN" | head -1)
SFPS=$(awk -F/ '{printf "%.3f", ($2?$1/$2:$1)}' <<<"$SFPS")
FPS="${FPS:-$SFPS}"
HAS_A=$(ffprobe -v error -select_streams a:0 -show_entries stream=index -of csv=p=0 "$IN" | head -1)
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
DUR=$(awk -v d="$DUR" 'BEGIN{printf "%.2f", d+1}')
GSCALE="${GSCALE:-2}"
GW=$((W/GSCALE)); GH=$((H/GSCALE))
SW=$(awk -v w="$W" -v s="$SDOWN" 'BEGIN{printf "%d", int(w*s/2)*2}')
SH=$(awk -v h="$H" -v s="$SDOWN" 'BEGIN{printf "%d", int(h*s/2)*2}')

V="[0:v]fps=${FPS},format=gbrp"
# 2) хроматическая аберрация: красный канал чуть крупнее, синий чуть мельче
if [[ "$CA" != "0" ]]; then
  V="${V}[pre];
[pre]split=3[car][cag][cab];
[car]lutrgb=g=0:b=0,scale=w=iw*(1+${CA}):h=ih*(1+${CA}),crop=${W}:${H}[car2];
[cab]lutrgb=r=0:g=0,scale=w=iw*(1-${CA}):h=ih*(1-${CA}),pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2[cab2];
[cag]lutrgb=r=0:b=0[cag2];
[car2][cag2]blend=all_mode=addition[carg];
[carg][cab2]blend=all_mode=addition,format=gbrp"
fi
# 3) gate weave / микродрожание: оверскан + две несоизмеримые частоты
V="${V},crop=w=iw*(1-${OV}):h=ih*(1-${OV}):x='(iw*${OV}/2)+${AMP}*sin(2*PI*t*0.37)+${AMP}*0.45*sin(2*PI*t*1.63)':y='(ih*${OV}/2)+${AMP}*cos(2*PI*t*0.29)+${AMP}*0.4*sin(2*PI*t*1.11)',scale=${W}:${H}:flags=lanczos"
# 4) потеря разрешения сенсора/кодека: вниз и обратно
[[ "$SDOWN" != "1.00" ]] && V="${V},scale=${SW}:${SH}:flags=bilinear,scale=${W}:${H}:flags=bilinear"
# 5) вертикальный смаз (бытовая камера / строчная развёртка)
[[ "$VSM" != "0" ]] && V="${V},gblur=sigma=0.15:sigmaV=${VSM}"
V="${V},format=gbrp"
# 6) резкость ISP (телефон «дорисовывает» контур)
[[ "$SHARP" != "0" ]] && V="${V},unsharp=3:3:${SHARP}:3:3:0"
# 7) мягкие углы объектива: резкий центр, размытая периферия
if [[ "$SOFT" != "0" ]]; then
  V="${V}[sh];
[sh]split=2[shA][shB];
[shB]gblur=sigma=${SOFT}[shBl];
color=c=white:s=${W}x${H}:r=${FPS}:d=${DUR},vignette=a=PI/4,negate,curves=all='0/0 0.5/0 0.75/0.35 1/1',format=gbrp[smask];
[shA][shBl][smask]maskedmerge,format=gbrp"
fi
# 8) halation — тёплый ореол вокруг светов
if [[ "$HAL" != "0" ]]; then
  V="${V}[hb];
[hb]split=2[hbase][hhl];
[hhl]curves=all='0/0 0.80/0 1/1',scale=iw/4:ih/4,gblur=sigma=4,scale=${W}:${H},colorchannelmixer=rr=1.0:gg=0.52:bb=0.30,format=gbrp[halo];
[hbase][halo]blend=all_mode=screen:all_opacity=${HAL},format=gbrp"
fi
# 9) смаз затвора вместо идеально резких кадров нейронки
[[ -n "$TMIX" ]] && V="${V},tmix=frames=3:weights='${TMIX}'"
# 10) виньетка объектива (до тона — иначе она съедает приподнятый чёрный)
V="${V},vignette=a=${VIG}"
# 11) тон: чёрные приподняты, света сжаты/пересвечены, roll-off цвета
V="${V},curves=r='${CR}':g='${CG}':b='${CB}',eq=saturation=${SAT}:contrast=${CON}"
# дыхание автоэкспозиции: камера всё время чуть подкручивает яркость, рендер — никогда
[[ -n "${EXPO:-}" ]] && V="${V},eq=eval=frame:brightness='${EXPO}'"
# баланс белого не идеально нейтральный — тени холоднее, света теплее
[[ -n "${CBAL:-}" ]] && V="${V},colorbalance=${CBAL}"
[[ -n "$LUT" ]] && V="${V},lut3d=file='${LUT}'"
V="${V},format=gbrp[tone]"
# 12) сенсорный шум: временной (не статичный), сильнее в тенях
GRAIN_SRC="color=c=0x808080:s=${GW}x${GH}:r=${FPS}:d=${DUR},format=gray,noise=c0s=${GS}:c0f=t+u,scale=${W}:${H}:flags=neighbor,format=gbrp[grain]"
if [[ "$SHN" == "1" ]]; then
  # шум по маске теней: делим на три ветки — чистая, зашумлённая и маска по яркости
  V="${V};
[tone]split=3[nclean][nnoisy][nmasksrc];
${GRAIN_SRC};
[nnoisy][grain]blend=all_mode=grainmerge:all_opacity=${GOP}:shortest=1,format=gbrp[gnoisy];
[nmasksrc]format=gray,curves=all='0/1 0.25/0.80 0.55/0.38 1/0.14',format=gbrp[nmask];
[nclean][gnoisy][nmask]maskedmerge,format=yuv420p[vout]"
else
  # равномерное зерно по всему кадру — делить нечего
  V="${V};
${GRAIN_SRC};
[tone][grain]blend=all_mode=grainmerge:all_opacity=${GOP}:shortest=1,format=yuv420p[vout]"
fi

if [[ -n "$HAS_A" ]]; then
  if [[ "$AUD" == "light" ]]; then
    AF=""; AMAP=(-map "[vout]" -map 0:a -c:a aac -b:a 128k)
  else
    AF=";[0:a]aresample=48000,highpass=f=55,lowpass=f=15500,acompressor=threshold=-20dB:ratio=2:attack=20:release=250,aformat=channel_layouts=stereo[a0];
anoisesrc=c=pink:a=0.006:r=48000,pan=stereo|c0=c0|c1=c0[room];
[a0][room]amix=inputs=2:weights='1 0.18':duration=first:normalize=0,alimiter=limit=0.95[aout]"
    AMAP=(-map "[vout]" -map "[aout]" -c:a aac -b:a 128k -ar 48000)
  fi
else
  AF=""; AMAP=(-map "[vout]" -an)
fi

if [[ "$ENC" == "h264_nvenc" ]]; then
  VENC=(-c:v h264_nvenc -preset p6 -rc vbr -cq $((CRF+1)) -b:v 0)
else
  VENC=(-c:v libx264 -preset slow -crf "$CRF" -tune film -x264-params "aq-mode=3:deblock=-1,-1")
fi
if [[ -n "$MAXRATE" ]]; then
  BUF=$(awk -v m="${MAXRATE%[Mm]}" 'BEGIN{printf "%.1fM", m*1.8}')
  VENC+=(-maxrate "$MAXRATE" -bufsize "$BUF")
fi

FG="${V}${AF}"
[[ $DRY -eq 1 ]] && { echo "$FG"; exit 0; }

mkdir -p "$(dirname "$OUT")"
TMPD=$(mktemp -d); trap 'rm -rf "$TMPD"' EXIT
STAGE1="$OUT"; [[ "$DEGRADE" == "1" ]] && STAGE1="$TMPD/stage1.mp4"

ffmpeg -hide_banner -loglevel error -y -i "$IN" \
  -filter_complex "$FG" "${AMAP[@]}" "${VENC[@]}" \
  -pix_fmt yuv420p -r "$FPS" -shortest -movflags +faststart "$STAGE1"

# 13) «залили в соцсеть и скачали обратно» — честные артефакты пережатия
if [[ "$DEGRADE" == "1" ]]; then
  ffmpeg -hide_banner -loglevel error -y -i "$STAGE1" \
    -c:v libx264 -preset fast -crf $((CRF+3)) -tune film -x264-params "deblock=0,0" \
    -pix_fmt yuv420p -c:a copy "$TMPD/stage2.mp4"
  ffmpeg -hide_banner -loglevel error -y -i "$TMPD/stage2.mp4" \
    -c:v libx264 -preset slow -crf "$CRF" -tune film -x264-params "aq-mode=3:deblock=-1,-1" \
    -pix_fmt yuv420p -c:a copy -movflags +faststart "$OUT"
fi

SZ=$(du -h "$OUT" | cut -f1)
BR=$(ffprobe -v error -show_entries format=bit_rate -of csv=p=0 "$OUT")
echo "готово: $OUT  [$PRESET]  ${SZ}  $((BR/1000)) кбит/с"
