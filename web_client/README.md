# Web-Testclient (Xianxia)

Minimaler JavaScript-Testclient für den SpacetimeDB-Server (`spacetimedb/Lib.cs`):
Login/Registrierung, Weltkarte, Bewegung, Qi-Sammeln, Durchbruch, andere Spieler
live sehen. Reines statisches HTML/CSS/JS, kein Build-Schritt, keine
Abhängigkeiten — nutzt `fetch`, `sessionStorage` und `<canvas>` direkt.

**Kein Ersatz für den echten Godot-Client**, nur ein Werkzeug zum Testen der
Reducer/Tabellen ohne Godot.

## Server starten (separates Terminal)

```bash
cd ../spacetimedb
spacetime start
spacetime publish --server local xianxia
```

## Client starten

```bash
cd web_client
python3 -m http.server 8080
```

Dann `http://localhost:8080` öffnen. Von einem anderen Gerät im selben LAN:
die LAN-IP dieses Rechners statt `localhost` verwenden — der Client leitet
seinen Standard-Server (`http://<host>:3000`) automatisch vom aufgerufenen
Hostnamen ab, keine Konfiguration nötig.

**HTTPS-Zugriff** (z.B. über eine öffentliche Domain/Tunnel): ein `:3000`-
Default wäre hier als Mixed Content geblockt (HTTPS-Seite, HTTP-Request), und
beliebige Ports lassen sich über die meisten Tunnel/Reverse-Proxys ohnehin
nicht durchreichen. Stattdessen wird angenommen, dass SpacetimeDB unter dem
eigenen Hostnamen mit vorangestelltem `db` per HTTPS erreichbar ist — läuft
diese Seite z.B. auf `antalia.leseptum.de`, wird automatisch
`https://dbantalia.leseptum.de` als Server verwendet. Das ist genau das
Tunnel-Setup dieses Projekts (SpacetimeDB-Port separat unter dem `db`-Präfix
exponiert); bei anderer Namenskonvention `?server=` explizit setzen.

Anderen Server/DB erzwingen (überschreibt den obigen Default):

```
http://localhost:8080/?server=https://maincloud.spacetimedb.com&db=xianxia
```

## Steuerung

- **Login-Screen**: Name/Passwort eingeben, "Registrieren" oder "Login".
- **Bewegung**: WASD oder Pfeiltasten.
- **Qi sammeln**: Button unten rechts (+10 Qi).
- **Durchbruch**: aktiv sobald Qi voll ist.
- **M**: wechselt zwischen normaler Ansicht (Kamera folgt Spieler) und
  Kartenansicht (ganze Weltkarte, alle Spieler als Punkte).
- **Logout**: verwirft die Identity dieses Tabs und lädt neu — danach kann
  sich derselbe Tab als anderer Spieler registrieren/einloggen.

Wasser- und Berg-Kacheln sind nicht begehbar (client- und serverseitig
durchgesetzt, siehe unten) — ein Schritt Richtung einer solchen Kachel wird
einfach nicht ausgeführt, der Spieler bleibt auf dem aktuellen Feld stehen.

## Karteneditor (`editor.html`)

Eigenständige Seite, kein Login nötig:

```
http://localhost:8080/editor.html
```

Lädt die aktuelle Karte, zeigt sie vergrößert (4px/Kachel) an. Links ein
Biom-Pinsel (anklicken zum Auswählen) plus Ressourcenwerte (Kräuter, Spirit
Stones, Holz, Erz) — Klicken/Ziehen auf der Karte malt die gewählte
Biom-/Ressourcen-Kombination auf jede berührte Kachel und speichert sofort
über den `edit_tile`-Reducer (`spacetimedb/Lib.cs`). Kein Zugriffsschutz —
jeder mit Zugriff auf die Seite kann die Karte verändern (passend zum übrigen
POC-Sicherheitsniveau, siehe `CLAUDE.md`). Änderungen sind sofort für alle
Spieler sichtbar (bzw. nach einem Reload/der nächsten Weltladung).

## Mehrere Spieler gleichzeitig testen

Die Identity liegt in `sessionStorage`, nicht `localStorage` — das ist pro Tab
isoliert (anders als `localStorage`, das sich alle Tabs desselben Origins
teilen). **Einfach einen zweiten Tab auf dieselbe URL öffnen** bekommt
automatisch eine eigene Identity und kann einen zweiten Spieler registrieren;
beide Tabs sehen sich dann gegenseitig als Punkte auf der Karte (Polling).
Ein Reload behält die Identity des Tabs, Schließen des Tabs verwirft sie.

## Bekannte Einschränkungen (bewusste Vereinfachungen für den Testclient)

- HTTP-Polling statt WebSocket-Subscriptions (alle 400ms) — andere Spieler
  "springen" nach statt weich zu interpolieren.
- Bewegung ist Feld-für-Feld (ein Tile pro Tastendruck, 4 Richtungen, kein
  Diagonalschritt), kein freies/analoges Laufen.
- Ressourcen pro Tile (`kraeuter_menge`, `spirit_stones`, `holz`, `erz`) werden
  im Hauptclient geladen, aber nicht gerendert — nur das Biom bestimmt die
  Kachelfarbe. Im Karteneditor sind sie einsehbar/editierbar.
- **Ein Spieler pro Identity**: `Register` (`Lib.cs`) legt pro Identity nur
  einmal einen Spieler an — ein zweiter `Registrieren`-Versuch mit derselben
  Identity, aber anderem Namen, tut serverseitig nichts (kein Fehler, einfach
  kein Insert), der Client meldet dann einen Fehler. Siehe "Mehrere Spieler
  gleichzeitig testen" oben.
