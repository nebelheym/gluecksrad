#!/usr/bin/env python3
"""
Lädt freie Fotos (Pexels / Pixabay) zu den 24 Themen herunter und baut daraus den Ordner images/
(images/manifest.json, images/tNN/NNN.jpg, CREDITS.md mit Urheber + Quelle je Foto).

Downloads free-licence photos from Pexels and/or Pixabay for the 24 topics and builds images/ for the site.

Kostenlose API-Schlüssel / free API keys:
  Pexels : https://www.pexels.com/api/      -> Umgebungsvariable PEXELS_API_KEY
  Pixabay: https://pixabay.com/api/docs/    -> Umgebungsvariable PIXABAY_API_KEY
(einer reicht, beide = mehr Auswahl / one is enough, both = more choice)

Benutzung / usage:
  pip install pillow
  export PEXELS_API_KEY=...        # Windows PowerShell: $env:PEXELS_API_KEY="..."
  export PIXABAY_API_KEY=...
  python tools/fetch_photos.py --per-topic 15
  python tools/fetch_photos.py --only "Musik,Haustiere" --per-topic 20   # nur einzelne Themen

Hinweise:
  * Bitte Fotos kurz ansehen und Unpassendes löschen (Datei löschen reicht, dann
    `python tools/fetch_photos.py --rebuild-manifest` ausführen).
  * Pexels verlangt Namensnennung/Link auf Pexels, siehe CREDITS.md (wird automatisch erzeugt).
  * images/ steht in .gitignore. Zum Veröffentlichen: Zeile entfernen oder `git add -f images CREDITS.md`.
  * Bitte moderat bleiben (Standard 15 Fotos/Thema): Die Dienste verbieten Massen-Downloads.
"""
import argparse, io, json, os, shutil, sys, time, urllib.parse, urllib.request

try:
    from PIL import Image
except ImportError:
    sys.exit("Bitte zuerst installieren / install first:  pip install pillow")

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "images")
CREDITS = os.path.join(ROOT, "CREDITS.md")
UA = {"User-Agent": "gluecksrad-photo-fetch/1.0 (educational, small set)"}

# Thema -> englische Suchanfragen (die APIs liefern damit die besten Treffer)
TOPICS = {
    "Einkaufen": ["family shopping supermarket", "woman shopping market", "carrying groceries home"],
    "Haustiere": ["child with pet dog", "cat and owner at home", "family with pet"],
    "Lernen, Schule und Bildung": ["students learning together", "schoolchildren with backpacks", "doing homework"],
    "Freizeit zu Hause": ["family relaxing at home", "playing at home living room", "watching tv at home"],
    "Familie und Freizeit": ["family leisure outdoors", "family picnic", "parents playing with children"],
    "Kindergarten und Sport mit Kindern": ["kindergarten children playing", "kids sport class", "children team sport"],
    "Arbeit im Büro und am Computer": ["people working in office", "working on laptop", "colleagues office meeting"],
    "Berufe: Florist, Koch, Kellner": ["florist at work", "chef cooking restaurant kitchen", "waiter serving"],
    "Müdigkeit und Schlaf": ["tired woman", "sleeping on train", "exhausted at desk"],
    "Hausarbeit und Putzen": ["cleaning the house", "doing laundry", "washing dishes together"],
    "Renovierung und Umzug": ["renovating apartment", "moving boxes new home", "painting walls couple"],
    "Bibliothek und Lesen": ["reading in library", "man reading book", "reading on the beach"],
    "Autounfall und Verkehr": ["car accident minor", "children crossing road", "cyclist traffic city"],
    "Schach und Brettspiele": ["playing chess in park", "friends board game", "family board game"],
    "Café und Freunde treffen": ["friends coffee cafe", "friends meeting talking", "restaurant friends dinner"],
    "Reisen und öffentliche Verkehrsmittel": ["passengers on train", "public transport city", "traveling with child train"],
    "Kochen und Essen": ["cooking with children", "family cooking kitchen", "picking apples orchard"],
    "Hobbys und Bewegung": ["jogging park", "gym workout", "walking in the rain with umbrella"],
    "Großeltern und Generationen": ["grandparents with grandchildren", "elderly people park", "multigenerational family"],
    "Smartphones und Technik": ["people using smartphones", "teenager smartphone", "video call"],
    "Musik": ["street musician", "band playing music", "man playing guitar"],
    "Gesundheit und Medizin": ["pharmacy customer", "sick man at home", "vaccination"],
    "Gemeinschaft und Nachbarschaft": ["neighbors helping", "diverse people together", "community people"],
    "Winter und Schnee": ["family building snowman", "children playing in snow", "winter walk"],
}


# Zusätzliche klassische Prüfungsthemen (Szenen mit Personen) / extra classic exam topics
NEW_TOPICS = {
    "Im Supermarkt und Einkaufen": ["woman shopping supermarket vegetables", "family shopping cart supermarket", "customer paying cashier", "people shopping at market"],
    "Beim Arzt / Krank sein": ["doctor examining patient", "sick woman in bed with fever", "pharmacist advising customer", "nurse talking to patient"],
    "Im Restaurant und Café": ["waiter serving guests restaurant", "friends having coffee cafe", "family eating restaurant", "people ordering at cafe"],
    "Reisen und Verkehrsmittel": ["family at airport with suitcases", "passengers waiting at train station", "people boarding bus", "tourists with luggage"],
    "Kochen und Essen zu Hause": ["family cooking together kitchen", "father and daughter cooking", "family dinner table", "woman cooking at home"],
    "Hausarbeit und Putzen": ["woman cleaning house", "family doing housework", "man vacuum cleaning", "doing laundry at home"],
    "Umzug und Wohnung": ["moving into new apartment boxes", "couple carrying moving boxes", "people painting wall apartment", "family unpacking boxes"],
    "Sport und Fitness": ["people jogging in park", "friends playing football", "group fitness class", "cycling family"],
    "Feiern und Geburtstag": ["birthday party children", "friends celebrating party", "family birthday cake", "wedding guests celebrating"],
    "Urlaub und Strand": ["family on beach vacation", "tourists sightseeing city", "children playing on beach", "hiking in mountains group"],
    "Bei der Arbeit: Berufe": ["florist arranging flowers", "chef in restaurant kitchen", "hairdresser cutting hair", "teacher in classroom with students"],
    "Winter und Schnee": ["children playing in snow", "family sledding winter", "people walking in snow", "building snowman children"],
    "Verkehr und Fahrrad": ["cyclist in city traffic", "children crossing street crossing", "people waiting at bus stop", "traffic accident police"],
    "Lesen und Bibliothek": ["people reading in library", "student studying library", "child reading book with parent", "reading book on park bench"],
}


def get_json(url, headers=None):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)


def get_bytes(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def search_pexels(q, key, n):
    url = "https://api.pexels.com/v1/search?" + urllib.parse.urlencode(
        {"query": q, "per_page": min(n, 80), "orientation": "landscape"})
    for p in get_json(url, {"Authorization": key}).get("photos", []):
        yield {"id": f"pexels-{p['id']}", "img": p["src"].get("large2x") or p["src"]["large"],
               "page": p["url"], "author": p.get("photographer", "?"), "source": "Pexels",
               "license": "Pexels License (https://www.pexels.com/license/)"}


def search_pixabay(q, key, n):
    url = "https://pixabay.com/api/?" + urllib.parse.urlencode(
        {"key": key, "q": q, "image_type": "photo", "orientation": "horizontal",
         "safesearch": "true", "per_page": max(3, min(n, 100)), "min_width": 1000})
    for p in get_json(url).get("hits", []):
        yield {"id": f"pixabay-{p['id']}", "img": p.get("largeImageURL") or p["webformatURL"],
               "page": p["pageURL"], "author": p.get("user", "?"), "source": "Pixabay",
               "license": "Pixabay Content License (https://pixabay.com/service/license-summary/)"}


def save_jpeg(data, path):
    im = Image.open(io.BytesIO(data)).convert("RGB")
    im.thumbnail((1280, 1280))
    im.save(path, "JPEG", quality=78, optimize=True, progressive=True)


def build_manifest():
    man = {}
    for d in sorted(os.listdir(OUT)):
        p = os.path.join(OUT, d)
        meta = os.path.join(p, "_title.txt")
        if not (os.path.isdir(p) and os.path.exists(meta)):
            continue
        files = sorted(f for f in os.listdir(p) if f.lower().endswith(".jpg"))
        if files:
            man[d] = {"title": open(meta, encoding="utf-8").read().strip(), "files": files}
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(man, f, ensure_ascii=False, indent=1)
    print(f"manifest.json: {sum(len(v['files']) for v in man.values())} Fotos in {len(man)} Themen")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-topic", type=int, default=15)
    ap.add_argument("--only", default="", help="Themen kommagetrennt (Teil des Namens genügt)")
    ap.add_argument("--rebuild-manifest", action="store_true")
    ap.add_argument("--set", choices=["base", "new"], default="base", help="Themenliste: base oder new (zusätzliche Themen)")
    ap.add_argument("--out", default="", help="anderer Ausgabeordner (z. B. images_candidates)")
    ap.add_argument("--start", type=int, default=1, help="erste Themen-Nummer (Ordnername tNN)")
    a = ap.parse_args()
    global OUT
    if a.out:
        OUT = os.path.abspath(a.out)
    topics = NEW_TOPICS if a.set == "new" else TOPICS
    os.makedirs(OUT, exist_ok=True)
    if a.rebuild_manifest:
        return build_manifest()

    pex, pix = os.environ.get("PEXELS_API_KEY"), os.environ.get("PIXABAY_API_KEY")
    if not (pex or pix):
        sys.exit("Kein API-Schlüssel gefunden. Siehe Hinweise oben (PEXELS_API_KEY / PIXABAY_API_KEY).")
    only = [x.strip().lower() for x in a.only.split(",") if x.strip()]
    credits = {}
    if os.path.exists(os.path.join(OUT, "credits.json")):
        credits = json.load(open(os.path.join(OUT, "credits.json"), encoding="utf-8"))

    for i, (title, queries) in enumerate(topics.items(), a.start):
        if only and not any(o in title.lower() for o in only):
            continue
        slug = f"t{i:02d}"
        d = os.path.join(OUT, slug)
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, "_title.txt"), "w", encoding="utf-8").write(title)
        have = {c["id"] for c in credits.values() if c["slug"] == slug}
        got = len([f for f in os.listdir(d) if f.endswith(".jpg")])
        per_q = max(4, a.per_topic)
        print(f"\n== {title} ({got}/{a.per_topic})")
        for q in queries:
            for engine, key in (("pexels", pex), ("pixabay", pix)):
                if not key or got >= a.per_topic:
                    continue
                try:
                    results = list((search_pexels if engine == "pexels" else search_pixabay)(q, key, per_q))
                except Exception as e:
                    print(f"  ! {engine} '{q}': {e}")
                    continue
                for r in results:
                    if got >= a.per_topic:
                        break
                    if r["id"] in have:
                        continue
                    name = f"{got + 1:03d}.jpg"
                    try:
                        save_jpeg(get_bytes(r["img"]), os.path.join(d, name))
                    except Exception as e:
                        print(f"  ! {r['id']}: {e}")
                        continue
                    have.add(r["id"]); got += 1
                    credits[f"{slug}/{name}"] = {**r, "slug": slug, "title": title}
                    print(f"  + {slug}/{name}  {r['source']}  {r['author']}")
                    time.sleep(0.4)
                time.sleep(0.8)

    json.dump(credits, open(os.path.join(OUT, "credits.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    with open(CREDITS if not a.out else os.path.join(OUT, "CREDITS.md"), "w", encoding="utf-8") as f:
        f.write("# Bildnachweise / Picture credits\n\nFotos von Pexels und Pixabay (freie Lizenzen). "
                "Photos from Pexels and Pixabay (free licences).\n\n")
        for k in sorted(credits):
            c = credits[k]
            if os.path.exists(os.path.join(OUT, k)):
                f.write(f"- `images/{k}` – {c['title']} – Foto: {c['author']} / {c['source']} – {c['page']} – {c['license']}\n")
    build_manifest()
    print("\nFertig. Prüfe die Fotos kurz; dann: git add -f images CREDITS.md && git commit && git push")


if __name__ == "__main__":
    main()
