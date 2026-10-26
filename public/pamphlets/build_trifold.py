"""
Build a self-contained Sociva trifold HTML (embedded images).
Opens correctly via file:// - no server required.
"""
from __future__ import annotations

import base64
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT.parent.parent / "design" / "sociva-trifold" / "assets"
OUT = ROOT / "trifold.html"


def uri(path: Path) -> str:
    ext = path.suffix.lower()
    mime = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".svg": "image/svg+xml",
    }[ext]
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


def main() -> None:
    logo = uri(ASSETS / "sociva-logo-lockup.svg")
    cover = uri(ASSETS / "sociva-cover-hero.jpg")
    kitchen = uri(ASSETS / "sociva-home-kitchen.jpg")
    cook = uri(ASSETS / "sociva-neighbors-cook.jpg")
    feast = uri(ASSETS / "sociva-hero-feast.jpg")
    tutor = uri(ASSETS / "sociva-tutor.jpg")
    qr_ios = uri(ASSETS / "qr-ios-official.png")
    qr_and = uri(ASSETS / "qr-android-official.png")
    icon = uri(ROOT.parent / "app-icon-1024x1024.png")

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sociva Trifold Pamphlet</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet" />
<style>
:root {{
  --charcoal: #0B1010;
  --paper: #FDFCFA;
  --ink: #141416;
  --muted: #5C5C66;
  --soft: #F1EEE8;
  --line: #E4DFD6;
  --green: #22A06B;
  --green-deep: #1A7A52;
  --mint: #C1F5DF;
  --teal: #1F7A66;
}}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
html, body {{
  background: #3a3a3a;
  color: var(--ink);
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}}
.toolbar {{
  max-width: 297mm;
  margin: 10mm auto 0;
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
}}
.toolbar a, .toolbar button {{
  appearance: none; border: 0;
  background: var(--green); color: #04140c;
  font-weight: 700; font-size: 13px;
  padding: 10px 16px; border-radius: 10px;
  text-decoration: none; cursor: pointer;
}}
.toolbar a.secondary {{
  background: #222; color: #eee; border: 1px solid #555;
}}
.note {{
  max-width: 297mm; margin: 6mm auto 0;
  text-align: center; color: #bbb; font-size: 12px;
}}

/* ========== PRINT SHEETS ========== */
.sheet {{
  width: 297mm;
  height: 210mm;
  margin: 8mm auto;
  background: var(--paper);
  display: grid;
  overflow: hidden;
  box-shadow: 0 16px 48px rgba(0,0,0,.45);
  position: relative;
}}
.sheet.outside {{ grid-template-columns: 1.02fr 1.02fr 0.96fr; }}
.sheet.inside {{ grid-template-columns: 1fr 1fr 1fr; }}

.panel {{
  min-width: 0;
  height: 100%;
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 12mm 8mm 12mm;
}}

.eyebrow {{
  font-size: 8pt;
  font-weight: 800;
  letter-spacing: .16em;
  text-transform: uppercase;
  color: var(--green);
  margin-bottom: 3.5mm;
}}
.eyebrow.mint {{ color: var(--mint); }}

h1 {{
  font-size: 22pt;
  font-weight: 800;
  letter-spacing: -.03em;
  line-height: 1.08;
}}
h2 {{
  font-size: 16pt;
  font-weight: 800;
  letter-spacing: -.03em;
  line-height: 1.12;
  margin-bottom: 3mm;
}}
h2 .a {{ color: var(--green); }}
h3 {{ font-size: 11pt; font-weight: 800; line-height: 1.2; margin-bottom: 1.5mm; }}
.lead {{
  font-size: 8.5pt;
  line-height: 1.4;
  color: var(--muted);
  font-weight: 500;
  margin-bottom: 4mm;
}}
.lead.light {{ color: rgba(253,252,250,.82); }}

/* COVER */
.cover {{
  padding: 0;
  color: #fff;
  background: #111 url('{cover}') center 28%/cover no-repeat;
}}
.cover::before {{
  content: '';
  position: absolute; inset: 0;
  background: linear-gradient(180deg,
    rgba(11,16,16,.52) 0%,
    rgba(11,16,16,.1) 40%,
    rgba(11,16,16,.92) 100%);
}}
.cover-top {{
  position: relative; z-index: 1;
  padding: 10mm 8mm 0;
}}
.cover-top img.logo {{
  width: 52mm;
  border-radius: 3mm;
  display: block;
  box-shadow: 0 4mm 10mm rgba(0,0,0,.35);
}}
.cover-bottom {{
  position: absolute; z-index: 1;
  left: 0; right: 0; bottom: 0;
  padding: 0 8mm 12mm;
}}
.cover-bottom .eyebrow {{ color: var(--mint); }}
.cover-bottom h1 {{
  margin-bottom: 3mm;
  text-shadow: 0 2mm 6mm rgba(0,0,0,.4);
}}
.cover-bottom h1 em {{ font-style: normal; color: var(--mint); }}
.cover-bottom .sub {{
  font-size: 8.5pt;
  line-height: 1.4;
  font-weight: 500;
  color: rgba(253,252,250,.92);
  margin-bottom: 4.5mm;
}}
.cta {{
  display: inline-block;
  background: linear-gradient(135deg, var(--green), var(--teal));
  color: #fff;
  font-size: 9pt;
  font-weight: 800;
  padding: 2.8mm 4.5mm;
  border-radius: 999px;
  margin-bottom: 3mm;
}}
.cover-meta {{
  font-size: 7pt;
  font-weight: 700;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: rgba(253,252,250,.7);
}}

/* DOWNLOAD */
.dl {{ background: var(--charcoal); color: #fff; }}
.dl h2 {{ color: #fff; font-size: 15pt; }}
.qr-grid {{
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3.5mm;
  margin: 2mm 0 4mm;
}}
.qr-box {{ text-align: center; }}
.qr-box .lbl {{
  font-size: 7.5pt;
  font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--mint);
  margin-bottom: 2mm;
}}
.qr-box .frame {{
  background: #fff;
  border-radius: 3mm;
  padding: 2.5mm;
  margin-bottom: 1.5mm;
}}
.qr-box img {{
  width: 100%;
  aspect-ratio: 1;
  object-fit: contain;
  display: block;
}}
.qr-box .hint {{
  font-size: 7pt;
  font-weight: 600;
  color: rgba(253,252,250,.65);
}}
.dl-photo {{
  flex: 1;
  min-height: 35mm;
  border-radius: 3.5mm;
  background: url('{kitchen}') center/cover no-repeat;
  margin-bottom: 3.5mm;
  position: relative;
  overflow: hidden;
}}
.dl-photo::after {{
  content: '';
  position: absolute; inset: 0;
  background: linear-gradient(180deg, transparent 40%, rgba(11,16,16,.75));
}}
.dl-foot {{
  flex: 0 0 auto;
  border-top: 1px solid rgba(193,245,223,.22);
  padding-top: 3mm;
}}
.dl-foot strong {{
  display: block;
  font-size: 9pt;
  font-weight: 800;
  line-height: 1.35;
  margin-bottom: 1.5mm;
}}
.dl-foot .url {{
  font-size: 8.5pt;
  font-weight: 700;
  color: var(--mint);
}}
.dl-foot small {{
  display: block;
  margin-top: 1.2mm;
  font-size: 6.5pt;
  color: rgba(253,252,250,.5);
}}

/* PRICING */
.price {{ background: var(--paper); }}
.block {{
  border-radius: 3.5mm;
  padding: 3.5mm 3.5mm;
  margin-bottom: 2.5mm;
}}
.block.buy {{
  background: linear-gradient(135deg, var(--green), var(--teal));
  color: #fff;
}}
.block.sell {{
  background: var(--soft);
  border: 1px solid var(--line);
}}
.block h3 {{ margin-bottom: 1mm; }}
.block.buy h3 {{ color: #fff; }}
.block p {{
  font-size: 7.5pt;
  line-height: 1.35;
  font-weight: 500;
}}
.block.sell p {{ color: var(--muted); }}
.cats {{
  font-size: 7.5pt;
  font-weight: 700;
  color: var(--green-deep);
  line-height: 1.45;
  margin: 1mm 0 3mm;
}}
.price-photo {{
  flex: 1;
  min-height: 40mm;
  border-radius: 3.5mm;
  background: url('{feast}') center/cover no-repeat;
  margin-bottom: 3mm;
}}
.price-end {{ flex: 0 0 auto; }}
.price-end .closer {{
  font-size: 9.5pt;
  font-weight: 800;
  line-height: 1.3;
  margin-bottom: 1.5mm;
}}
.price-end .closer em {{ font-style: normal; color: var(--green); }}
.price-end .url {{
  font-size: 9pt;
  font-weight: 800;
  color: var(--green);
}}

/* INSIDE */
.in {{ background: var(--paper); }}
.in .eyebrow {{ order: 1; }}
.in h2 {{ order: 2; }}
.in .lead {{ order: 3; }}
.in .body-block {{ order: 4; flex: 0 0 auto; margin-bottom: 3mm; }}
.in .photo {{
  order: 5;
  flex: 1;
  min-height: 42mm;
  border-radius: 3.5mm;
  background-size: cover;
  background-position: center;
  margin-bottom: 3mm;
}}
.in .closer {{ order: 6; flex: 0 0 auto; }}

.points {{ display: flex; flex-direction: column; gap: 2mm; }}
.point strong {{ display: block; font-size: 8.5pt; font-weight: 800; margin-bottom: .4mm; }}
.point span {{ font-size: 7pt; color: var(--muted); font-weight: 500; line-height: 1.3; }}

.split {{
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2.5mm;
}}
.col {{
  background: var(--soft);
  border-radius: 3mm;
  padding: 3mm 2.5mm;
}}
.col.seller {{
  background: rgba(34,160,107,.1);
  border: 1px solid rgba(34,160,107,.28);
}}
.col .lbl {{
  font-size: 6.5pt;
  font-weight: 800;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--green);
  margin-bottom: 1.2mm;
}}
.col h3 {{ font-size: 9pt; }}
.col p {{
  font-size: 6.5pt;
  color: var(--muted);
  font-weight: 500;
  line-height: 1.3;
  margin-bottom: 1.5mm;
}}
.col ul {{ list-style: none; display: flex; flex-direction: column; gap: 1mm; }}
.col li {{
  font-size: 6.5pt;
  font-weight: 600;
  line-height: 1.25;
  padding-left: 2.5mm;
  position: relative;
}}
.col li::before {{
  content: '';
  position: absolute;
  left: 0; top: 1.2mm;
  width: 1.2mm; height: 1.2mm;
  border-radius: 50%;
  background: var(--green);
}}

.steps {{ display: flex; flex-direction: column; gap: 2.5mm; }}
.step {{
  display: grid;
  grid-template-columns: 8mm 1fr;
  gap: 2.5mm;
  align-items: start;
}}
.num {{
  width: 8mm; height: 8mm;
  border-radius: 50%;
  background: var(--green);
  color: #fff;
  font-size: 9pt;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
}}
.step h3 {{ font-size: 9pt; margin-bottom: .5mm; }}
.step p {{ font-size: 7pt; color: var(--muted); font-weight: 500; line-height: 1.3; }}

.band {{
  background: var(--charcoal);
  color: var(--mint);
  border-radius: 3mm;
  padding: 3mm;
  font-size: 8pt;
  font-weight: 800;
  line-height: 1.3;
}}
.band.green {{
  background: linear-gradient(135deg, var(--green), var(--teal));
  color: #fff;
}}
.trust {{
  display: flex;
  flex-wrap: wrap;
  gap: 2mm 3.5mm;
  padding-top: 2.5mm;
  border-top: 1px solid var(--line);
  font-size: 6.5pt;
  font-weight: 700;
  color: var(--muted);
}}
.trust span::before {{
  content: '';
  display: inline-block;
  width: 1.4mm; height: 1.4mm;
  border-radius: 50%;
  background: var(--green);
  margin-right: 1.4mm;
  vertical-align: middle;
}}

.label {{
  position: absolute;
  top: 2mm; left: 50%;
  transform: translateX(-50%);
  font-size: 6pt;
  font-weight: 700;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: rgba(0,0,0,.25);
  pointer-events: none;
  z-index: 5;
}}
.sheet.outside .label {{ color: rgba(255,255,255,.35); }}

@media print {{
  html, body {{ background: #fff; }}
  .toolbar, .note, .label {{ display: none !important; }}
  .sheet {{
    margin: 0;
    box-shadow: none;
    page-break-after: always;
    break-after: page;
  }}
  .sheet.inside {{ page-break-after: auto; }}
  @page {{ size: A4 landscape; margin: 0; }}
}}
</style>
</head>
<body>
  <div class="toolbar">
    <button type="button" onclick="window.print()">Print / Save PDF</button>
    <a class="secondary" href="./a4.html">A4 portrait</a>
    <a class="secondary" href="./a5.html">A5 portrait</a>
    <a class="secondary" href="https://www.sociva.in/">sociva.in</a>
  </div>
  <p class="note">A4 landscape trifold · Outside then Inside · Print actual size, flip on short edge · Images embedded (works offline)</p>

  <!-- ========== OUTSIDE ========== -->
  <section class="sheet outside" aria-label="Outside - Download | Pricing | Cover">
    <div class="label">Outside · Download | Pricing | Cover</div>

    <article class="panel dl">
      <div class="eyebrow mint">Download Sociva</div>
      <h2>Bring your society closer.</h2>
      <p class="lead light">Scan once. Meet kitchens, tutors, and helpers already living around you.</p>
      <div class="qr-grid">
        <div class="qr-box">
          <div class="lbl">iPhone</div>
          <div class="frame"><img src="{qr_ios}" alt="App Store QR" /></div>
          <div class="hint">Apple App Store</div>
        </div>
        <div class="qr-box">
          <div class="lbl">Android</div>
          <div class="frame"><img src="{qr_and}" alt="Google Play QR" /></div>
          <div class="hint">Google Play</div>
        </div>
      </div>
      <div class="dl-photo" aria-hidden="true"></div>
      <div class="dl-foot">
        <strong>Your next favourite meal may already live a few floors away.</strong>
        <div class="url">Not ready yet? sociva.in</div>
        <small>Official stores only - Apple App Store and Google Play</small>
      </div>
    </article>

    <article class="panel price">
      <div class="eyebrow">Pricing and trust</div>
      <h2>Good for the community.<br />Easy to start.</h2>
      <p class="lead">Support talent in your own buildings. Keep discovery close to home.</p>
      <div class="block buy">
        <h3>Free for buyers forever</h3>
        <p>Browse, chat, and order from neighbours in your society.</p>
      </div>
      <div class="block sell">
        <h3>Free for sellers to start</h3>
        <p>Zero listing fees. Create a storefront for what you cook, teach, make, or offer.</p>
      </div>
      <div class="cats">Home kitchens · Tutors · Pet care · Tailoring · Fitness · Everyday help</div>
      <div class="price-photo" aria-hidden="true"></div>
      <div class="price-end">
        <div class="closer">The best things in your society weren't on any app. <em>Until now.</em></div>
        <div class="url">sociva.in</div>
      </div>
    </article>

    <article class="panel cover">
      <div class="cover-top">
        <img class="logo" src="{logo}" alt="Sociva - Your Society, Your Store" />
      </div>
      <div class="cover-bottom">
        <div class="eyebrow">From kitchens and skills in your society</div>
        <h1>What Your Neighbor Makes,<br /><em>No App Can Deliver.</em></h1>
        <p class="sub">Home-cooked meals, trusted tutors, pet care, tailoring, fitness and more - already inside your gates.</p>
        <div class="cta">Discover what's around you</div>
        <div class="cover-meta">Community marketplace · Scan the back to download</div>
      </div>
    </article>
  </section>

  <!-- ========== INSIDE ========== -->
  <section class="sheet inside" aria-label="Inside - Idea | Who | How">
    <div class="label" style="color:rgba(0,0,0,.28)">Inside · Idea | Who | How</div>

    <article class="panel in">
      <div class="eyebrow">The idea</div>
      <h2>Your society has more to offer than <span class="a">you think.</span></h2>
      <p class="lead">Sociva is a GPS-verified community marketplace. It connects residents with home kitchens, tutors, bakers, and local helpers inside the same society.</p>
      <div class="body-block points">
        <div class="point"><strong>Made closer to home</strong><span>Food and goods prepared by people who live where you live.</span></div>
        <div class="point"><strong>Skills around the corner</strong><span>Tutors, fitness, pet care, tailoring, and everyday help nearby.</span></div>
        <div class="point"><strong>Know who you're buying from</strong><span>See the person, chat directly, and read reviews from verified residents.</span></div>
      </div>
      <div class="photo" style="background-image:url('{cook}')" aria-hidden="true"></div>
      <div class="closer band">Not another delivery app. Your neighbourhood, finally visible.</div>
    </article>

    <article class="panel in">
      <div class="eyebrow">Who it's for</div>
      <h2>One community.<br /><span class="a">Two ways in.</span></h2>
      <p class="lead">Buy today. Sell tomorrow. Same society. Same trust.</p>
      <div class="body-block split">
        <div class="col">
          <div class="lbl">For residents</div>
          <h3>Discover nearby</h3>
          <p>Find home-cooked food, services, tutors, and things made by neighbours.</p>
          <ul>
            <li>Beyond big delivery apps</li>
            <li>Chat for custom requests</li>
            <li>Reviews from verified residents</li>
          </ul>
        </div>
        <div class="col seller">
          <div class="lbl">For sellers</div>
          <h3>Be discovered</h3>
          <p>Cook, bake, teach, repair, or offer a service? Let neighbours find you.</p>
          <ul>
            <li>Simple storefront</li>
            <li>Reach your own society</li>
            <li>Free to start, zero listing fees</li>
          </ul>
        </div>
      </div>
      <div class="photo" style="background-image:url('{feast}')" aria-hidden="true"></div>
      <div class="closer band green">Your next favourite - and your next customer - already live nearby.</div>
    </article>

    <article class="panel in">
      <div class="eyebrow">How it works</div>
      <h2>Three simple steps.</h2>
      <p class="lead">From your building to your neighbours - without the noise of a city-wide marketplace.</p>
      <div class="body-block steps">
        <div class="step">
          <div class="num">1</div>
          <div>
            <h3>Prove you live here</h3>
            <p>Verify through Sociva's supported location and verification flow.</p>
          </div>
        </div>
        <div class="step">
          <div class="num">2</div>
          <div>
            <h3>Discover hidden gems</h3>
            <p>Explore home kitchens, tutors, local services, and neighbour-made products.</p>
          </div>
        </div>
        <div class="step">
          <div class="num">3</div>
          <div>
            <h3>Connect and order</h3>
            <p>Message the seller, ask questions, and order the way that offering works.</p>
          </div>
        </div>
      </div>
      <div class="photo" style="background-image:url('{tutor}')" aria-hidden="true"></div>
      <div class="closer trust">
        <span>Community-focused discovery</span>
        <span>Direct chat where available</span>
        <span>Verified-resident reviews where available</span>
      </div>
    </article>
  </section>
</body>
</html>
"""
    # icon unused in final layout but kept available if needed later
    _ = icon
    OUT.write_text(html, encoding="utf-8")
    print("wrote", OUT, "bytes", OUT.stat().st_size)


if __name__ == "__main__":
    main()
