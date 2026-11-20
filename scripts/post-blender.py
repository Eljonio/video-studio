# post-blender.py — «де-ИИ» пост НОДАМИ, через API Blender 5. Без GUI, без единого клика.
# Тот же рецепт, что в post-film.sh, но в 32-битном float и настоящим нодовым графом.
#
# Запуск (обычно через post-blender.sh):
#   blender -b --factory-startup --python post-blender.py -- IN.mp4 OUT_PREFIX PRESET [F_END]
#
# Грабли Blender 5, на которых легко встать:
#   - scene.node_tree больше НЕТ: компоузер = нод-группа scene.compositing_node_group
#   - настройки нод переехали в СОКЕТЫ (n.inputs['Distortion']), зато теперь анимируются и связываются
#   - вывод видео: image_settings.media_type='VIDEO', и только потом file_format='FFMPEG'
#   - по умолчанию включён тонмап AgX, картинка уплывает: view_transform='Standard'
#   - у ShaderNodeMix сокеты сдвоены под типы: RGBA это Factor=in[0], A=in[6], B=in[7], Result=out[2]
import bpy, sys, math

argv   = sys.argv[sys.argv.index("--")+1:]
SRC    = argv[0]
OUT    = argv[1]
PRESET = argv[2] if len(argv) > 2 else "medium"
F_END  = int(argv[3]) if len(argv) > 3 else 10**6

# OV оверскан | AMP дрожание, px | CA хроматика | DIST бочка объектива
# SDOWN потеря разрешения сенсора | SOFT мягкость углов, px | HAL halation
# GRAIN сила зерна | GSC размер зерна | VIG виньетка | SAT насыщенность
# LIFT поднятый чёрный | ROLL откат светов | MID S-кривая в четвертях
P = {
 "light":     dict(OV=.016, AMP=1.2, CA=.000, DIST=.000, SDOWN=1.00, SOFT=0, HAL=.06,
                   GRAIN=.100, GSC=0.50, VIG=.12, SAT=.98, LIFT=.014, ROLL=.988, MID=(.248,.500,.755)),
 "medium":    dict(OV=.024, AMP=2.0, CA=.004, DIST=.0015,SDOWN=.92,  SOFT=3, HAL=.12,
                   GRAIN=.190, GSC=0.50, VIG=.22, SAT=.95, LIFT=.024, ROLL=.968, MID=(.242,.504,.772)),
 "film":      dict(OV=.034, AMP=3.0, CA=.007, DIST=.0025,SDOWN=1.00, SOFT=5, HAL=.18,
                   GRAIN=.270, GSC=0.45, VIG=.30, SAT=.91, LIFT=.030, ROLL=.956, MID=(.238,.508,.788)),
 "camcorder": dict(OV=.030, AMP=3.6, CA=.005, DIST=.004, SDOWN=.62,  SOFT=2, HAL=.09,
                   GRAIN=.330, GSC=0.55, VIG=.26, SAT=.88, LIFT=.058, ROLL=.928, MID=(.262,.500,.735)),
 "phone":     dict(OV=.020, AMP=2.6, CA=.006, DIST=.002, SDOWN=.88,  SOFT=4, HAL=.10,
                   GRAIN=.205, GSC=0.50, VIG=.22, SAT=1.04,LIFT=.026, ROLL=.999, MID=(.240,.524,.930)),
}[PRESET]

sc = bpy.context.scene
for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)
sc.render.engine = 'BLENDER_WORKBENCH'

clip = bpy.data.movieclips.load(SRC)
W, H = clip.size
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, 100
sc.render.fps = int(round(clip.fps))
sc.frame_start, sc.frame_end = 1, min(F_END, clip.frame_duration)
print(f"CLIP {W}x{H} {clip.fps} fps, кадров {sc.frame_end}, пресет {PRESET}")

# без этого Blender подмешивает AgX и картинка уплывает
sc.view_settings.view_transform = 'Standard'
sc.view_settings.look = 'None'

ng = bpy.data.node_groups.new("FilmPost", 'CompositorNodeTree')
sc.compositing_node_group = ng
ng.interface.new_socket("Image", in_out='OUTPUT', socket_type='NodeSocketColor')
X = [0]
def add(t, dy=0):
    n = ng.nodes.new(t); X[0] += 200; n.location = (X[0], dy); return n
L = ng.links.new

def mix(a, b, fac, blend='MIX', dy=0):
    """Смешать два изображения. У ShaderNodeMix сокеты сдвоены: RGBA = in[0]/in[6]/in[7], out[2]."""
    m = add('ShaderNodeMix', dy); m.data_type = 'RGBA'; m.blend_type = blend
    if hasattr(fac, 'name'): L(fac, m.inputs[0])
    else: m.inputs[0].default_value = fac
    L(a, m.inputs[6]); L(b, m.inputs[7])
    return m.outputs[2]

def mth(op, a, b=None, dy=0):
    n = add('ShaderNodeMath', dy); n.operation = op
    for i, v in ((0, a), (1, b)):
        if v is None: continue
        if hasattr(v, 'name'): L(v, n.inputs[i])
        else: n.inputs[i].default_value = v
    return n.outputs[0]

def gray(v, dy=0):
    """float -> цвет, чтобы класть в Mix как изображение"""
    c = add('CompositorNodeCombineColor', dy)
    for s in ('Red', 'Green', 'Blue'): L(v, c.inputs[s])
    c.inputs['Alpha'].default_value = 1.0
    return c.outputs['Image']

# Оптика (бочка, хроматика, размытие, halation) должна считаться в ЛИНЕЙНОМ —
# это и есть преимущество перед ffmpeg. А тон, насыщенность и зерно — в ЭКРАННОМ,
# иначе подъём чёрного в линейном даёт серую муть вместо плёночного чёрного.
def _cs_pick(node, prop, *want):
    items = [i.identifier for i in node.bl_rna.properties[prop].enum_items]
    for w in want:
        for it in items:
            if it.lower() == w.lower(): return it
    for w in want:
        for it in items:
            if w.lower() in it.lower(): return it
    return None

def convert(img, to_display, dy=0):
    n = add('CompositorNodeConvertColorSpace', dy)
    lin = _cs_pick(n, 'from_color_space', 'Linear Rec.709', 'Linear CIE-XYZ D65', 'Linear')
    srg = _cs_pick(n, 'from_color_space', 'sRGB')
    if not (lin and srg):
        ng.nodes.remove(n)
        g = add('CompositorNodeGamma', dy); L(img, g.inputs['Image'])
        g.inputs['Gamma'].default_value = (1/2.2) if to_display else 2.2
        print("ConvertColorSpace недоступен, иду через Gamma")
        return g.outputs['Image']
    n.from_color_space, n.to_color_space = (lin, srg) if to_display else (srg, lin)
    print(f"цвет: {n.from_color_space} -> {n.to_color_space}")
    L(img, n.inputs['Image'])
    return n.outputs['Image']

src = add('CompositorNodeMovieClip'); src.clip = clip
img = src.outputs['Image']
time = add('CompositorNodeSceneTime', -400)

# 4) потеря разрешения сенсора: вниз и обратно
if P['SDOWN'] < 1.0:
    for k in (P['SDOWN'], 1.0 / P['SDOWN']):
        s = add('CompositorNodeScale'); L(img, s.inputs['Image'])
        s.inputs['X'].default_value = k; s.inputs['Y'].default_value = k
        img = s.outputs['Image']

# 2) хроматическая аберрация + лёгкая бочка объектива
if P['CA'] or P['DIST']:
    ld = add('CompositorNodeLensdist'); L(img, ld.inputs['Image'])
    ld.inputs['Distortion'].default_value  = P['DIST']
    ld.inputs['Dispersion'].default_value  = P['CA']
    img = ld.outputs['Image']

# 3) gate weave: оверскан + плавающий сдвиг на двух несоизмеримых частотах
ov = add('CompositorNodeScale'); L(img, ov.inputs['Image'])
ov.inputs['X'].default_value = 1 + P['OV']; ov.inputs['Y'].default_value = 1 + P['OV']
sec = time.outputs['Seconds']
A = P['AMP']
TAU = math.pi * 2
def wave(op, freq, amp):
    return mth('MULTIPLY', mth(op, mth('MULTIPLY', sec, TAU * freq)), amp)
wx = mth('ADD', wave('SINE',   0.37, A), wave('SINE', 1.63, A * 0.45))
wy = mth('ADD', wave('COSINE', 0.29, A), wave('SINE', 1.11, A * 0.40))
tr = add('CompositorNodeTranslate'); L(ov.outputs['Image'], tr.inputs['Image'])
L(wx, tr.inputs['X']); L(wy, tr.inputs['Y'])
img = tr.outputs['Image']

# 7) мягкие углы объектива: резкий центр, мыльная периферия
if P['SOFT']:
    bl = add('CompositorNodeBlur'); L(img, bl.inputs['Image'])
    bl.inputs['Size'].default_value = (P['SOFT'], P['SOFT'])
    em = add('CompositorNodeEllipseMask', -300)
    em.inputs['Size'].default_value = (0.62, 0.62)
    inv = add('CompositorNodeInvert', -300); L(em.outputs['Mask'], inv.inputs['Color'])
    mb = add('CompositorNodeBlur', -300); L(inv.outputs['Color'], mb.inputs['Image'])
    mb.inputs['Size'].default_value = (max(W, H) * 0.09, max(W, H) * 0.09)
    img = mix(img, bl.outputs['Image'], mb.outputs['Image'], 'MIX')

# 8) halation — тёплый ореол вокруг светов
if P['HAL']:
    gl = add('CompositorNodeGlare'); L(img, gl.inputs['Image'])
    gl.inputs['Type'].default_value      = 'Bloom'
    gl.inputs['Quality'].default_value   = 'Medium'
    gl.inputs['Threshold'].default_value = 0.80
    gl.inputs['Strength'].default_value  = P['HAL']
    gl.inputs['Size'].default_value      = 0.30
    gl.inputs['Tint'].default_value      = (1.0, 0.52, 0.30, 1.0)
    img = gl.outputs['Image']

img = convert(img, True)     # дальше считаем в экранном

# 11) тон: поднятый чёрный, откат светов, сплит-тон (холодные тени / тёплые света)
crv = add('CompositorNodeCurveRGB'); L(img, crv.inputs['Image'])
m25, m50, m75 = P['MID']
for i, (lift, roll, tint) in enumerate(((P['LIFT'] * 0.9, P['ROLL'] + .002,  .002),   # R
                                        (P['LIFT'] * 0.8, P['ROLL'],          .000),   # G
                                        (P['LIFT'] * 1.3, P['ROLL'] - .006,  -.004))): # B: холоднее тени
    c = crv.mapping.curves[i]
    c.points[0].location  = (0.0, lift)
    c.points[-1].location = (1.0, min(roll, 1.0))
    for x, y in ((0.25, m25 + tint), (0.5, m50), (0.75, m75 - tint)):
        c.points.new(x, min(max(y, 0.0), 1.0))
crv.mapping.update()
hs = add('CompositorNodeHueSat'); L(crv.outputs['Image'], hs.inputs['Image'])
hs.inputs['Saturation'].default_value = P['SAT']
img = hs.outputs['Image']

# 10) виньетка объектива
# эллипс держим круглым в пикселях: на широком кадре короткая ось не должна затемняться сильнее (было перетянуто на 16:9)
vm = add('CompositorNodeEllipseMask', -300)
vm.inputs['Size'].default_value = (min(1.0, 0.86 * max(W, H) / W), min(1.0, 0.86 * max(W, H) / H))
vb = add('CompositorNodeBlur', -300); L(vm.outputs['Mask'], vb.inputs['Image'])
vb.inputs['Size'].default_value = (min(W, H) * 0.12, min(W, H) * 0.12)
img = mix(img, gray(vb.outputs['Image']), P['VIG'], 'MULTIPLY')

# 12) сенсорный шум: временной (W гонится кадром) и сильнее в тенях
coord = add('CompositorNodeImageCoordinates', -300); L(img, coord.inputs['Image'])
nz = add('ShaderNodeTexNoise', -300)
nz.noise_dimensions = '4D'          # 4-е измерение = время, иначе зерно будет статичным
L(coord.outputs['Pixel'], nz.inputs['Vector'])
nz.inputs['Scale'].default_value  = P['GSC']   # ~0.5 на пиксельных координатах = зерно в 2 px;
# ВНИМАНИЕ: при 1.0 шум попадает в шаг пикселя и вырождается в плоскую заливку
nz.inputs['Detail'].default_value = 2.0   # октавы — иначе зерно гладкое, как дымка
L(mth('MULTIPLY', time.outputs['Frame'], 0.613, -300), nz.inputs['W'])
bw = add('CompositorNodeRGBToBW', -300); L(img, bw.inputs['Image'])
shadow = mth('POWER', mth('SUBTRACT', 1.0, bw.outputs['Val'], -300), 1.5, -300)
amp = mth('MULTIPLY', mth('MULTIPLY', mth('SUBTRACT', nz.outputs['Factor'], 0.5, -300),
                            P['GRAIN'], -300), shadow, -300)
img = mix(img, gray(amp, -300), 1.0, 'ADD')

img = convert(img, False)    # обратно в линейное, дальше его заберёт view transform
gout = add('NodeGroupOutput'); L(img, gout.inputs[0])
print("НОД В ГРАФЕ:", len(ng.nodes))

# Промежуточный файл БЕЗ ПОТЕРЬ: иначе кодек Blender стирает зерно,
# ради которого всё и затевалось. Финальный h264 делает ffmpeg в post-blender.sh.
ims = sc.render.image_settings
ims.media_type = 'VIDEO'
ims.file_format = 'FFMPEG'
sc.render.ffmpeg.format = 'MKV'
sc.render.ffmpeg.codec = 'FFV1'
sc.render.ffmpeg.audio_codec = 'NONE'
sc.render.filepath = OUT
bpy.ops.render.render(animation=True)
print("RENDER DONE")
