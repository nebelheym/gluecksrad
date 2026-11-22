# Glücksrad für Lehrkräfte

Glücksrad, Slot-Maschine und Gruppen-Generator für den Unterricht – besonders für **Sprachkurse**
(Gesprächspartner bilden, Themen verteilen). Läuft komplett im Browser:

- 🔒 **Keine Server, keine Konten, kein Tracking.** Namen bleiben im `localStorage` des eigenen Browsers (DSGVO-freundlich).
- 📴 Funktioniert **offline** (PWA) und lässt sich als App installieren.
- 🌍 Oberfläche auf **Deutsch, English, Русский**.
- 🎲 Faire Auswahl mit `crypto.getRandomValues` (ohne Modulo-Bias).

## Funktionen

- Mehrere Klassen/Kurse, Anwesenheitsliste, Namenliste per Copy & Paste einfügen
- Glücksrad mit „Runde“-Logik (Aufgerufene werden ausgeschlossen)
- Slot-Maschine für Dialogpaare, ganze Klasse in 2er/3er/4er-Gruppen aufteilen
- Zufällige Gesprächsthemen ohne Wiederholung (editierbar)
- Sicherung als JSON-Datei, Vollbild für den Beamer, Leertaste = drehen

## Lokal starten

Einfach `index.html` im Browser öffnen, oder:

```bash
npm run serve    # http://localhost:8080
```

Das CSS ist vorkompiliert (`css/styles.css`). Nur wenn du Klassen in `index.html` oder `js/app.js` änderst:

```bash
npm install
npm run build:css
```

## Veröffentlichen mit GitHub Pages

1. Repository auf GitHub anlegen und diesen Ordner pushen (Branch `main`).
2. *Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `/ (root)`*.
3. Nach ca. einer Minute erreichbar unter `https://<benutzername>.github.io/<repo>/`.

Nach Änderungen an den Dateien in `sw.js` die Konstante `CACHE` hochzählen, damit installierte Apps aktualisieren.

## Neue Sprache hinzufügen

`js/i18n.js`: Block `en` kopieren, übersetzen und in `index.html` eine `<option>` im `#langSelect` ergänzen
(sowie den Code in `loadState()` in `js/app.js` erweitern).

## Lizenz

MIT
