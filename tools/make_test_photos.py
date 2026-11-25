"""Makes pretend phone photos of pages (angle, shadow, noise, different tables) with known corners."""
import sys, os, json, random
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
F = lambda s, b=False: ImageFont.truetype(r"C:\Windows\Fonts\%s" % ("arialbd.ttf" if b else "arial.ttf"), s)
W, H = 1654, 2339
INK = (15, 15, 15)


def letter():
    p = Image.new("RGB", (W, H), (250, 249, 246)); d = ImageDraw.Draw(p)
    d.text((W // 2, 190), "Dynamic Community Newsletter", font=F(64, True), fill=(20, 40, 110), anchor="mm")
    d.text((180, 300), "12 March 2026", font=F(38), fill=INK)
    paras = ["Dear friends, thank you for your kind letter of last week. We were glad to hear that the family is well and that the garden has come through the winter.",
             "The meeting will be held on Saturday at ten in the morning. Please bring your own chair, a warm jacket and something to share at the table.",
             "Liewe vriende, dankie vir julle hulp. Ons sien uit daarna om almal weer te ontmoet en saam te gesels oor die nuwe jaar en alles wat voorlê.",
             "If you cannot come, please let the office know before Thursday so that we can plan the number of seats and the food."]
    y = 420
    for t in paras:
        line = ""
        for w in t.split():
            if d.textlength(line + " " + w, font=F(40)) > W - 360:
                d.text((180, y), line, font=F(40), fill=INK); y += 60; line = w
            else:
                line = (line + " " + w).strip()
        d.text((180, y), line, font=F(40), fill=INK); y += 110
    d.text((180, y), "What to bring", font=F(54, True), fill=INK); y += 100
    for it in ["1. A chair for every person", "2. A jacket", "3. Food to share"]:
        d.text((220, y), it, font=F(40), fill=INK); y += 62
    d.rectangle((180, y + 60, 700, y + 330), fill=(60, 120, 70)); d.ellipse((760, y + 60, 1030, y + 330), fill=(190, 60, 50))
    d.text((180, y + 400), "Kind regards", font=F(40), fill=(20, 20, 140)); d.text((180, y + 465), "The committee", font=F(40), fill=(20, 20, 140))
    return p


def invoice():
    p = Image.new("RGB", (W, H), (247, 247, 247)); d = ImageDraw.Draw(p)
    d.text((150, 160), "INVOICE", font=F(80, True), fill=INK); d.text((1500, 180), "No. 10482", font=F(42), fill=INK, anchor="ra")
    y = 420; d.rectangle((150, y - 20, 1504, y + 70), fill=(215, 220, 230))
    rows = [("Item", "Qty", "Price", "Total"), ("Paper A4 white", "5", "89.90", "449.50"), ("Blue pens box", "2", "120.00", "240.00"), ("Stapler", "1", "185.50", "185.50"), ("Printer ink black", "3", "310.00", "930.00")]
    for r in rows:
        b = r[0] == "Item"
        d.text((170, y), r[0], font=F(42, b), fill=INK)
        for x, t in ((900, r[1]), (1200, r[2]), (1480, r[3])):
            d.text((x, y), t, font=F(42, b), fill=INK, anchor="ra")
        d.line((150, y + 75, 1504, y + 75), fill=(120, 120, 120), width=2); y += 100
    d.text((1200, y + 40), "TOTAL", font=F(46, True), fill=INK, anchor="ra"); d.text((1480, y + 40), "R 1805.00", font=F(46, True), fill=INK, anchor="ra")
    return p


def card():
    c = Image.new("RGB", (1014, 640), (225, 235, 225)); d = ImageDraw.Draw(c)
    d.rectangle((60, 150, 330, 520), fill=(150, 120, 100)); d.text((380, 60), "SAMPLE CARD", font=F(60, True), fill=(20, 60, 30))
    for i, t in enumerate(["Name: A. Example", "Number: 0000 000", "Valid: 2030"]):
        d.text((380, 180 + i * 90), t, font=F(44), fill=INK)
    return c


def bg(kind, w, h, rng):
    if kind == "wood":
        y = np.linspace(0, 60, h)[:, None]; x = np.linspace(0, 6, w)[None, :]
        g = np.sin(y * 2.2 + np.sin(x * 2) * 1.5) * 12 + rng.normal(0, 5, (h, 1))
        b = np.stack([130 + g, 90 + g * .8, 58 + g * .6], -1)
        for k in range(1, 4): b[int(h * k / 4):int(h * k / 4) + 6] *= 0.55
    elif kind == "dark": b = np.full((h, w, 3), (45, 46, 50.)) + rng.normal(0, 4, (h, w, 1))
    elif kind == "light": b = np.full((h, w, 3), (214, 208, 198.)) + rng.normal(0, 2, (h, w, 1))
    elif kind == "tiles":
        b = np.full((h, w, 3), (165, 160, 150.))
        for k in range(0, w, 420): b[:, k:k + 10] = 95
        for k in range(0, h, 420): b[k:k + 10] = 95
    else:
        yy, xx = np.mgrid[0:h, 0:w]; m = ((xx // 130 + yy // 130) % 2)[..., None]
        b = np.where(m, (150, 40, 45.), (225, 215, 205.)).astype(float)
    return b


def persp(page, quad, w, h):
    pw, ph = page.size; A = []; src = [(0, 0), (pw, 0), (pw, ph), (0, ph)]
    for (x, y), (u, v) in zip(quad, src):
        A += [[x, y, 1, 0, 0, 0, -u * x, -u * y], [0, 0, 0, x, y, 1, -v * x, -v * y]]
    c = np.linalg.solve(np.array(A, float), np.array(src, float).reshape(-1))
    im = page.transform((w, h), Image.PERSPECTIVE, c.tolist(), Image.BICUBIC)
    mk = Image.new("L", page.size, 255).transform((w, h), Image.PERSPECTIVE, c.tolist(), Image.BICUBIC)
    return np.asarray(im, float), np.asarray(mk, float)[..., None] / 255


def project(pw, ph, w, h, tilt, pan, roll, dist, shift):
    f = 0.82 * max(w, h)
    pts = np.array([[-pw / 2, -ph / 2, 0], [pw / 2, -ph / 2, 0], [pw / 2, ph / 2, 0], [-pw / 2, ph / 2, 0]], float)
    a, b, c = np.radians([tilt, pan, roll])
    Rx = np.array([[1, 0, 0], [0, np.cos(a), -np.sin(a)], [0, np.sin(a), np.cos(a)]])
    Ry = np.array([[np.cos(b), 0, np.sin(b)], [0, 1, 0], [-np.sin(b), 0, np.cos(b)]])
    Rz = np.array([[np.cos(c), -np.sin(c), 0], [np.sin(c), np.cos(c), 0], [0, 0, 1]])
    q = pts @ (Rx @ Ry @ Rz).T + np.array([shift[0], shift[1], dist])
    return [(f * x / z + w / 2, f * y / z + h / 2) for x, y, z in q]


rng = np.random.default_rng(7); random.seed(7); truth = {}; cases = []
U = random.uniform
for i, kind in enumerate(["wood", "dark", "light", "tiles", "cloth"] * 4):
    pg = [letter, invoice][i % 2]
    cases.append((f"{i:02d}_{kind}_{pg.__name__}", kind, pg(), 210, 297, U(-28, 28), U(-18, 18), U(-14, 14), U(375, 450)))
cases.append(("20_wood_card", "wood", card(), 85.6, 53.98, 12, -8, 5, 150))
cases.append(("21_dark_card", "dark", card(), 85.6, 53.98, -18, 10, -6, 170))
for name, kind, pg, mw, mh, t, p, r, dist in cases:
    w, h = (3000, 2250) if "card" in name else (2250, 3000)
    q = project(mw, mh, w, h, t, p, r, dist, (U(-6, 6), U(-8, 8)))
    b = bg(kind, w, h, rng); im, mk = persp(pg, q, w, h)
    sh = np.asarray(Image.fromarray((mk[..., 0] * 255).astype(np.uint8)).resize((w // 8, h // 8)).filter(ImageFilter.GaussianBlur(4)).resize((w, h)), float)[..., None] / 255
    sh = np.roll(sh, (14, 10), (0, 1)); o = b * (1 - 0.35 * sh); o = o * (1 - mk) + im * mk
    yy, xx = np.mgrid[0:h, 0:w]; ang = U(0, 6.28)
    light = 0.82 + 0.42 * (np.cos(ang) * (xx / w - .5) + np.sin(ang) * (yy / h - .5))
    ed = (np.cos(ang + 1) * (xx - w * U(.35, .65)) + np.sin(ang + 1) * (yy - h * U(.35, .65))) / 260
    hand = 1 - 0.38 / (1 + np.exp(-ed * 3))
    o = o * (light * hand)[..., None] * np.array([1.04, 1.0, .9]) + rng.normal(0, 5, (h, w, 1))
    img = Image.fromarray(np.clip(o, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    img.save(os.path.join(out, name + ".jpg"), quality=88)
    for s in (320, 1200):
        k = s / max(img.size); sm = img.resize((round(w * k), round(h * k)), Image.BOX).convert("RGBA")
        os.makedirs(f"{out}_{s}", exist_ok=True)
        open(os.path.join(f"{out}_{s}", f"{name}_{sm.width}x{sm.height}.rgba"), "wb").write(sm.tobytes())
    truth[name] = {"quad": q, "w": w, "h": h, "aspect": mw / mh}
json.dump(truth, open(os.path.join(out, "truth.json"), "w"))
print(len(truth), "photos")
