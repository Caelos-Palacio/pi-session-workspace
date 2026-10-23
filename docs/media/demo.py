#!/usr/bin/env python3
# ---- suite kit (identical in every repo): 800x450, 15 fps, pure render(t) -> image ----
import os, sys, shutil, subprocess, tempfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H, FPS, S = 800, 450, 15, 2          # S = supersampling factor
BG, TEXT, MUTED = '#0d1117', '#e6edf3', '#8b949e'
ACCENT, OK, ERROR, WARN = '#58a6ff', '#3fb950', '#f85149', '#d29922'
FONT_DIRS = [Path.home() / '.local/share/fonts/JetBrainsMonoNerd']
FALLBACK = ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf']
FONT_FILES = {False: 'JetBrainsMonoNerdFont-Regular.ttf', True: 'JetBrainsMonoNerdFont-Bold.ttf'}


def rgb(h, a=1.0):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), round(255 * max(0, min(1, a))))


def clamp(x): return max(0.0, min(1.0, x))
def seg(t, a, b): return clamp((t - a) / (b - a))
def ease(x): x = clamp(x); return 4 * x ** 3 if x < .5 else 1 - (-2 * x + 2) ** 3 / 2   # cubic in-out
def lerp(a, b, k): return a + (b - a) * k
def typed(s, t, t0, cps=55): return s[:max(0, int((t - t0) * cps))]


_fonts = {}
def font(size, bold=False):
    key = (size, bold)
    if key not in _fonts:
        cands = [d / FONT_FILES[bold] for d in FONT_DIRS] + [Path(p) for p in FALLBACK]
        path = next(p for p in cands if p.exists())
        _fonts[key] = ImageFont.truetype(str(path), round(size * S))
    return _fonts[key]


class Cv:
    def __init__(self):
        self.img = Image.new('RGB', (W * S, H * S), BG)
        self.d = ImageDraw.Draw(self.img, 'RGBA')

    def text(self, x, y, s, size=13, color=TEXT, a=1.0, bold=False, anchor='la'):
        if a > .01 and s:
            self.d.text((x * S, y * S), s, font=font(size, bold), fill=rgb(color, a), anchor=anchor)

    def width(self, s, size=13, bold=False): return font(size, bold).getlength(s) / S

    def box(self, x0, y0, x1, y1, outline=MUTED, a=1.0, fill=None, fa=1.0, r=6, w=1):
        self.d.rounded_rectangle([x0 * S, y0 * S, x1 * S, y1 * S], radius=r * S,
                                 outline=rgb(outline, a), width=round(w * S),
                                 fill=rgb(fill, fa) if fill else None)

    def line(self, x0, y0, x1, y1, color=MUTED, a=1.0, w=1, dash=0):
        if not dash:
            self.d.line([x0 * S, y0 * S, x1 * S, y1 * S], fill=rgb(color, a), width=round(w * S))
            return
        n = int(max(abs(x1 - x0), abs(y1 - y0)) // dash)
        for i in range(0, n, 2):
            p, q = i / n, min(1, (i + 1) / n)
            self.d.line([lerp(x0, x1, p) * S, lerp(y0, y1, p) * S, lerp(x0, x1, q) * S, lerp(y0, y1, q) * S],
                        fill=rgb(color, a), width=round(w * S))

    def arrow(self, x0, y0, x1, y1, color=MUTED, a=1.0):
        self.line(x0, y0, x1, y1, color, a)
        s = 1 if x1 > x0 else -1
        self.d.polygon([(x1 * S, y1 * S), ((x1 - 7 * s) * S, (y1 - 4) * S), ((x1 - 7 * s) * S, (y1 + 4) * S)], fill=rgb(color, a))

    def dot(self, x, y, color=ACCENT, a=1.0, r=4.5):
        self.d.ellipse([(x - r) * S, (y - r) * S, (x + r) * S, (y + r) * S], fill=rgb(color, a))
        self.d.ellipse([(x - r * 2) * S, (y - r * 2) * S, (x + r * 2) * S, (y + r * 2) * S], fill=rgb(color, a * .16))


def envelope(t, T, fade=.5):
    """Loop envelope: blank at t=0 and t=T, so the GIF loops seamlessly."""
    return ease(seg(t, 0, fade)) * (1 - ease(seg(t, T - fade, T)))


def finish(cv, t, T):
    blank = Image.new('RGB', cv.img.size, BG)
    img = Image.blend(blank, cv.img, envelope(t, T))
    return img.resize((W, H), Image.LANCZOS)


def build(render, T, out, frame=None):
    if frame is not None:
        render(frame).save(out); return
    n = round(T * FPS)
    with tempfile.TemporaryDirectory() as tmp:
        for i in range(n):
            render(i / FPS).save(f'{tmp}/f{i:04d}.png')
        pal = f'{tmp}/pal.png'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', str(FPS), '-i', f'{tmp}/f%04d.png',
                        '-vf', 'palettegen=max_colors=128:stats_mode=full', pal], check=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', str(FPS), '-i', f'{tmp}/f%04d.png', '-i', pal,
                        '-lavfi', 'paletteuse=dither=none', '-loop', '0', str(out)], check=True)
    print(f'{out}: {n} frames, {T}s, {Path(out).stat().st_size / 1e6:.2f} MB')


def cli(render, T, default_out):
    a = sys.argv[1:]
    if a[:1] == ['--frame']:          # python demo.py --frame 5.5 out.png
        build(render, T, a[2], float(a[1]))
    else:
        build(render, T, a[0] if a else default_out)
# ---- end kit ----

# ---- scene: session A -> mailbox -> session B; every terminal line is REAL output (capture.json) ----
import json
HERE = Path(__file__).resolve().parent
CAP = json.loads((HERE / 'capture.json').read_text())
T = 12.0
COLS = 86


import textwrap
def wrap(s, n=COLS): return textwrap.wrap(s, n, break_long_words=True, break_on_hyphens=False, subsequent_indent='  ') or ['']


A, M, B = (40, 180), (330, 470), (620, 760)
PAGES = [(0.5, 3.9), (3.9, 7.5), (7.5, 11.6)]


def page_alpha(t, i):
    a, b = PAGES[i]
    return ease(seg(t, a, a + .25)) * (1 - ease(seg(t, b - .3, b)))


def node(cv, rng, title, sub, act):
    a = lerp(.45, 1, act)
    cv.box(rng[0], 70, rng[1], 150, ACCENT if act > .5 else MUTED, a, r=8)
    cv.text((rng[0] + rng[1]) / 2, 90, title, 13, TEXT, a, bold=True, anchor='ma')
    cv.text((rng[0] + rng[1]) / 2, 116, sub, 12, MUTED, a, anchor='ma')


def render(t):
    cv = Cv()
    cv.text(40, 24, 'pi-session-workspace', 14, TEXT, bold=True)
    cv.text(760, 26, 'synthetic text · real module output · Pi UI not shown', 12, MUTED, anchor='ra')
    p = [page_alpha(t, i) for i in range(3)]
    node(cv, A, 'SESSION A', '/enviar', p[0])
    node(cv, M, 'MAILBOX', '0700 / 0600 files', max(p[0], p[1] * .6))
    node(cv, B, 'SESSION B', '/buzon', max(p[1], p[2]))
    cv.arrow(A[1] + 6, 110, M[0] - 6, 110, MUTED, .5)
    cv.arrow(M[1] + 6, 110, B[0] - 6, 110, MUTED, .5)
    for a, b, x0, x1 in ((1.7, 2.3, A[1] + 6, M[0] - 6), (4.6, 5.2, M[1] + 6, B[0] - 6)):
        k = seg(t, a, b)
        if 0 < k < 1: cv.dot(lerp(x0, x1, ease(k)), 110, ACCENT)
    # notes under the diagram
    k = ease(seg(t, 6.0, 6.3)) * (1 - ease(seg(t, 7.2, 7.5)))
    cv.text(690, 164, 'authority: none', 13, OK, k, anchor='ma', bold=True)
    k = ease(seg(t, 8.7, 9.0)) * (1 - ease(seg(t, 11.3, 11.6)))
    cv.text(690, 164, 'triggerTurn: false', 13, OK, k, anchor='ma', bold=True)
    cv.text(400, 164, 'MAIL_BODY', 13, ERROR, ease(seg(t, 9.9, 10.2)) * (1 - ease(seg(t, 11.3, 11.6))), anchor='ma', bold=True)
    # terminal
    cv.box(40, 196, 760, 394, MUTED, .5, r=6)
    def draw(rows, pa):
        y = 214
        for text, color, at, typ in rows:
            if t >= at:
                cv.text(54, y, typed(text, t, at, 90) if typ else text, 13, color,
                        pa * (1 if typ else ease(seg(t, at, at + .25))))
            y += 20
    def call(s, at):   # (lines of a typed call)
        return [(l, TEXT, at + i * .7, True) for i, l in enumerate(wrap('> ' + s))]
    def out(s, at, color=MUTED):
        return [(l, color, at + i * .2, False) for i, l in enumerate(wrap(s))]
    draw(call(CAP['sendCall'], .7) + out(CAP['sendOut'], 2.2) +
         [(m, OK, 2.5 + i * .25, False) for i, m in enumerate(CAP['modes'])], p[0])
    draw(call(CAP['listCall'], 4.1) + out(CAP['listOut'], 4.8) +
         call(CAP['evidenceCall'], 5.4) + out(CAP['evidenceOut'], 6.2), p[1])
    draw(call(CAP['receiptCall'], 7.7) + out(CAP['receiptOut'], 8.5, OK) +
         call(CAP['rejectCall'], 9.0) + out(CAP['rejectOut'], 9.9, ERROR) +
         call(CAP['reject2Call'], 10.1) + out(CAP['reject2Out'], 10.8, ERROR)[:1], p[2])
    caps = [(0.6, 3.9, 'Session A leaves a message on disk: private directories, owner-only files.'),
            (3.9, 7.5, 'Session B reads it as data. The text claims approval; the envelope says authority: none.'),
            (7.5, 11.6, 'Importing starts no turn. Oversized or control-character messages are refused.')]
    for a, b, s in caps:
        k = ease(seg(t, a, a + .3)) * (1 - ease(seg(t, b - .3, b)))
        cv.text(40, 414, s, 14, TEXT, k)
    return finish(cv, t, T)


if __name__ == '__main__':
    cli(render, T, HERE / 'demo.gif')
