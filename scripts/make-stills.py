#!/usr/bin/env python3
"""Генерит старт-кадр для каждого плана проекта и прикрепляет его как start_image.
Кадр строится из полей самого плана, поэтому композиция совпадает с тем, что потом анимируем.
Тратит кредиты Higgsfield (одна картинка на план).

    python3 scripts/make-stills.py <project_id> [shot_id ...]
"""
import json, os, sys, urllib.request
B = os.environ.get('VIDEO_STUDIO_URL', 'http://127.0.0.1:4600')

def api(path, method='GET', body=None, t=600):
    req = urllib.request.Request(B + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'content-type': 'application/json'})
    return json.load(urllib.request.urlopen(req, timeout=t))

def still_prompt(p, s):
    loc = next((l for l in p['assets']['locations'] if l['id'] == s.get('location')), None)
    props = [x for x in p['assets']['props'] if x['id'] in s.get('props', [])]
    st = p['style']['style']
    aspect = p['format'].get('aspect', '9:16')
    parts = [
        f"Single film frame, aspect {aspect}. {st.get('style','')}",
        f"LIGHT: {st.get('lighting','')}",
        f"LOCATION: {loc['description']}. {loc.get('light','')}" if loc else '',
        *[f"{x['name']}: {x['description']}." for x in props],
        f"FRAME: {s['first_frame']}",
        f"LENS: {s['type']}. {st.get('camera_lens','')}",
        "Rectilinear optics: NO fisheye, NO barrel distortion, undistorted proportions.",
        "NO text, letters, numbers, logos, badges or labels anywhere.",
        "Photoreal, real camera, not a 3D render.",
    ]
    return ' '.join(x for x in parts if x)

def main(pid, only=None):
    p = api(f'/api/projects/{pid}')
    for s in p['shots']:
        if only and s['id'] not in only:
            continue
        if s.get('start_image') and not only:
            print(f"{s['id']} уже есть кадр, пропускаю"); continue
        try:
            m = api(f'/api/projects/{pid}/still', 'POST',
                    {'model': 'nano_banana_pro', 'prompt': still_prompt(p, s), 'refs': [],
                     'params': {'aspect_ratio': p['format'].get('aspect', '9:16')}})
        except Exception as e:
            print(f"{s['id']} ОШИБКА: {e}"); continue
        fresh = api(f'/api/projects/{pid}')
        for t in fresh['shots']:
            if t['id'] == s['id']:
                t['start_image'] = m
        api(f'/api/projects/{pid}', 'PUT', fresh)
        print(f"{s['id']} {s['title']} → {m['url']}")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1], set(sys.argv[2:]) or None)
