"""Export trifold.html to PNG (outside + inside), matching the HTML layout."""
from __future__ import annotations

import re
import shutil
import subprocess
import time
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
HTML = ROOT / "trifold.html"
DESK = Path.home() / "OneDrive" / "Desktop"

EDGE = Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
if not EDGE.exists():
    EDGE = Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe")

# A4 landscape @ 300 DPI
W = int(round(297 * 300 / 25.4))  # 3508
H = int(round(210 * 300 / 25.4))  # 2480


def prepare_side(full: str, which: str) -> Path:
    cleaned = re.sub(r'<div class="toolbar">.*?</div>', "", full, flags=re.S)
    cleaned = re.sub(r'<p class="note">.*?</p>', "", cleaned, flags=re.S)
    cleaned = cleaned.replace("background: #3a3a3a;", "background: #FDFCFA;")
    cleaned = cleaned.replace("margin: 8mm auto;", "margin: 0;")
    cleaned = cleaned.replace(
        "box-shadow: 0 16px 48px rgba(0,0,0,.45);", "box-shadow: none;"
    )

    override = f"""
<style>
html, body {{ margin:0 !important; padding:0 !important; background:#FDFCFA !important; }}
.sheet {{
  width: {W}px !important;
  height: {H}px !important;
  margin: 0 !important;
  box-shadow: none !important;
}}
.toolbar, .note, .label {{ display:none !important; }}
</style>
"""
    cleaned = cleaned.replace("</head>", override + "</head>")

    head = cleaned.split("<body>")[0] + "<body>\n"
    o0 = cleaned.index('<section class="sheet outside"')
    i0 = cleaned.index('<section class="sheet inside"')
    i1 = cleaned.index("</body>")

    if which == "outside":
        body = cleaned[o0:i0]
    else:
        body = cleaned[i0:i1]

    out = ROOT / f"_export_{which}.html"
    out.write_text(head + body + "</body></html>", encoding="utf-8")
    return out


def screenshot(src: Path, dest: Path) -> None:
    tmp = ROOT / f"_shot_{dest.stem}.png"
    tmp.unlink(missing_ok=True)
    subprocess.run(
        [
            str(EDGE),
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            f"--window-size={W},{H + 40}",
            f"--screenshot={tmp}",
            "--force-device-scale-factor=1",
            "--virtual-time-budget=22000",
            src.resolve().as_uri(),
        ],
        check=True,
        capture_output=True,
    )
    time.sleep(0.5)
    img = Image.open(tmp).convert("RGB")
    if img.size[0] >= W and img.size[1] >= H:
        img = img.crop((0, 0, W, H))
    else:
        canvas = Image.new("RGB", (W, H), "#FDFCFA")
        canvas.paste(img, (0, 0))
        img = canvas
    img.save(dest, "PNG", optimize=True)

    # lighter preview
    preview = dest.with_name(dest.stem + "-preview.png")
    w150 = int(round(297 * 150 / 25.4))
    h150 = int(H * (w150 / W))
    img.resize((w150, h150), Image.Resampling.LANCZOS).save(
        preview, "PNG", optimize=True
    )
    tmp.unlink(missing_ok=True)
    print("saved", dest.name, dest.stat().st_size, img.size)


def main() -> None:
    full = HTML.read_text(encoding="utf-8")
    outside_src = prepare_side(full, "outside")
    inside_src = prepare_side(full, "inside")

    outside_png = ROOT / "sociva-trifold-outside.png"
    inside_png = ROOT / "sociva-trifold-inside.png"
    screenshot(outside_src, outside_png)
    screenshot(inside_src, inside_png)

    # stacked both-sides proof
    front = Image.open(outside_png)
    back = Image.open(inside_png)
    combo = Image.new("RGB", (W, H * 2 + 40), "#2a2a2a")
    combo.paste(front, (0, 0))
    combo.paste(back, (0, H + 40))
    combo_path = ROOT / "sociva-trifold-both-sides.png"
    combo.save(combo_path, "PNG", optimize=True)
    print("saved", combo_path.name, combo_path.stat().st_size)

    for src in (
        outside_png,
        inside_png,
        combo_path,
        outside_png.with_name("sociva-trifold-outside-preview.png"),
        inside_png.with_name("sociva-trifold-inside-preview.png"),
    ):
        if src.exists():
            shutil.copy2(src, DESK / src.name)
            print("desktop", DESK / src.name)


if __name__ == "__main__":
    main()
