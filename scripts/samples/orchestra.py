#!/usr/bin/env python3
"""Build the orchestral pad's sample layers from Sonatina Symphonic Orchestra sustains.

    python3 scripts/samples/orchestra.py "<path to .../Sonatina Symphonic Orchestra/Samples>"

Needs ffmpeg and numpy. For every sustained sample it: decodes to float, lengthens a short
one by crossfade-looping its steady middle (the sections are only 3-6 s long and the player
re-strikes a held note every 2.6-4 s, so every sample must be 8 s), levels it by
*perceived* (A-weighted) loudness with a 3 dB/octave taper above C5, fades the last 0.8 s,
and writes a 112 kbps stereo MP3 to public/samples/orchestra/<layer>/<Note>.mp3. Pitch is
checked by harmonic product spectrum against the filename and reported.

SSO is Creative Commons Sampling Plus 1.0 — credit Mattias Westlund / github.com/peastman/sso.
"""
import glob, os, re, subprocess, sys
import numpy as np

SRC = sys.argv[1]
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'samples', 'orchestra')
FR = 44100
NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b']
LAYERS = {                      # layer -> (folder, filename glob)
    'basses':    ('Basses',       'basses-sus-*'),
    'celli':     ('Celli',        'celli-sus-*'),
    'violas':    ('Violas',       'violas-sus-*'),
    'violins':   ('1st Violins',  '1st-violins-sus-*'),
    'horns':     ('Horns',        'horns-sus-mp-*'),
    'clarinets': ('Clarinets',    'clarinets-sus-*'),
    'flutes':    ('Flutes',       'flutes-sus-*'),
}
TARGET_LEN, MAX_LEN, MIN_FULL = 8.0, 8.0, 7.4
A0, TAPER = 0.034, 3.0


def midi(name):
    m = re.search(r'-([a-g]#?)(\d)(?:-[A-Za-z-]+)?\.[a-z]+$', name)   # also horns-sus-mp-a#2-PB-loop.wav
    return (int(m.group(2)) + 1) * 12 + NAMES.index(m.group(1)) if m else None


def decode(path):
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', path, '-f', 'f32le', '-ac', '2', '-ar', str(FR), '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()


def env(x, w=0.1):
    n = int(w * FR)
    return np.array([np.sqrt((x[i:i + n] ** 2).mean()) for i in range(0, len(x) - n, n)])


def steady_end(x):
    """Where the note really stops: the first drop of >10 dB below the median level in the last 40%."""
    e = env(x.mean(axis=1))
    med = np.median(e[len(e) // 5:])
    for i in range(int(len(e) * 0.6), len(e)):
        if e[i] < med * 0.32:
            return i * 0.1
    return len(x) / FR


def lengthen(x):
    end = steady_end(x)
    if end >= MIN_FULL:
        return x[: int(min(MAX_LEN, len(x) / FR) * FR)], 'natural'
    a, b = 0.5, end - 0.1
    if b - a < 1.2:
        a = 0.3
    seg = x[int(a * FR):int(b * FR)]
    xf = int(0.4 * FR)
    ramp = np.linspace(0, 1, xf)[:, None]
    fin, fout = np.sqrt(ramp), np.sqrt(1 - ramp)               # equal power
    out = x[: int(b * FR)]
    while len(out) < TARGET_LEN * FR:
        out = np.concatenate([out[:-xf], out[-xf:] * fout + seg[:xf] * fin, seg[xf:]])
    return out[: int(TARGET_LEN * FR)], f'looped x{int(np.ceil(TARGET_LEN * FR / max(1, len(seg))))}'


def a_weight(f):
    f = np.maximum(f, 1e-3); f2 = f ** 2
    return (12194 ** 2 * f2 ** 2) / ((f2 + 20.6 ** 2) * np.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2)) / 1.2589


def a_level(x):
    m = x.mean(axis=1)[int(1.0 * FR):int(4.0 * FR)]
    m = m * np.hanning(len(m)); sp = np.abs(np.fft.rfft(m)); f = np.fft.rfftfreq(len(m), 1 / FR)
    return np.sqrt(((sp * a_weight(f)) ** 2).sum() / (sp ** 2).sum()) * np.sqrt((m ** 2).mean())


def pitch_cents(x, expected):
    m = x.mean(axis=1)[int(1.0 * FR):int(4.0 * FR)] * np.hanning(int(3.0 * FR))
    n = 1 << 19; sp = np.abs(np.fft.rfft(m, n)); f = np.fft.rfftfreq(n, 1 / FR)
    hps = sp.copy()
    for h in (2, 3, 4):
        hps[: len(sp) // h] *= sp[::h][: len(sp) // h]
    target = 440 * 2 ** ((expected - 69) / 12)
    band = (f > target * 0.8) & (f < target * 1.25)
    peak = f[band][hps[band].argmax()]
    return 1200 * np.log2(peak / target)


def encode(x, path):
    x = x.copy(); n = int(0.8 * FR)
    x[-n:] *= np.linspace(1, 0, n)[:, None]
    p = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'f32le', '-ac', '2', '-ar', str(FR), '-i', '-',
                          '-c:a', 'libmp3lame', '-b:a', '112k', path], stdin=subprocess.PIPE)
    p.communicate(x.astype(np.float32).tobytes())


if __name__ == '__main__':
    only = set(sys.argv[2:])
    for layer, (folder, pat) in LAYERS.items():
        if only and layer not in only:
            continue
        os.makedirs(os.path.join(OUT, layer), exist_ok=True)
        files, seen = [], set()
        for f in sorted(glob.glob(os.path.join(SRC, folder, pat)), key=lambda f: (midi(os.path.basename(f)) or 0, f.endswith('.flac'))):
            if midi(os.path.basename(f)) not in seen:      # a few notes exist as both .wav and .flac
                seen.add(midi(os.path.basename(f)))
                files.append(f)
        notes, flags = [], []
        for f in files:
            m = midi(os.path.basename(f))
            if m is None:
                continue
            x, how = lengthen(decode(f))
            level = a_level(x)
            g = (A0 * 10 ** (-(TAPER * max(0, m - 72) / 12) / 20)) / level
            g = min(max(g, 10 ** (-6 / 20)), 10 ** (4 / 20))
            if np.abs(x).max() * g > 0.95:
                g = 0.95 / np.abs(x).max()
            cents = pitch_cents(x, m)
            name = NAMES[m % 12].upper().replace('#', 's') + str(m // 12 - 1)
            encode(x * g, os.path.join(OUT, layer, name + '.mp3'))
            notes.append(name)
            flags.append(f'{name}:{how.split()[0]}{"" if abs(cents) < 60 else f" PITCH {cents:+.0f}c"}')
        print(f'{layer:10} {len(notes):2} samples  {" ".join(flags)}')
        print(f'           notes: {" ".join(notes)}')
