# Web-Testclient (Xianxia)

Minimaler TypeScript-Testclient für den SpacetimeDB-Server (`spacetimedb/Lib.cs`):
Login/Registrierung, Weltkarte, Bewegung, Qi-Sammeln, Durchbruch, andere Spieler
live sehen. Nutzt das offizielle `spacetimedb`-SDK (echte WebSocket-Verbindung
mit Subscriptions statt Polling) über Vite gebaut — `npm install` + Build-Schritt
nötig, siehe unten (früher: reines Build-Schritt-loses HTML/CSS/JS).

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
npm install   # einmalig
npm run dev
```

Vite gibt beim Start eine lokale URL (z.B. `http://localhost:8081`) und eine
Netzwerk-URL für den LAN-Zugriff aus. Von einem anderen Gerät im selben LAN:
die angezeigte Netzwerk-URL (LAN-IP dieses Rechners) verwenden — der Client
leitet seinen Standard-Server (`ws://<host>:3000`) automatisch vom aufgerufenen
Hostnamen ab, keine Konfiguration nötig.

Für einen Produktions-Build (statische Dateien, z.B. zum Deployment):

```bash
npm run build      # erzeugt dist/
npm run preview    # dist/ lokal ausliefern, zum Gegenchecken
```

**HTTPS-Zugriff** (z.B. über eine öffentliche Domain/Tunnel): ein `:3000`-
Default wäre hier als Mixed Content geblockt (HTTPS-Seite, unverschlüsselter
`ws://`-Request), und beliebige Ports lassen sich über die meisten
Tunnel/Reverse-Proxys ohnehin nicht durchreichen. Stattdessen wird angenommen,
dass SpacetimeDB unter dem eigenen Hostnamen mit vorangestelltem `db` per
`wss://` erreichbar ist — läuft diese Seite z.B. auf `antalia.leseptum.de`,
wird automatisch `wss://dbantalia.leseptum.de` als Server verwendet. Das ist
genau das Tunnel-Setup dieses Projekts (SpacetimeDB-Port separat unter dem
`db`-Präfix exponiert); bei anderer Namenskonvention `?server=` explizit setzen.

Anderen Server/DB erzwingen (überschreibt den obigen Default):

```
http://localhost:8081/?server=wss://maincloud.spacetimedb.com&db=xianxia
```

## Steuerung

- **Login-Screen**: Name/Passwort eingeben, "Registrieren" oder "Login".
- **Bewegung**: WASD oder Pfeiltasten.
- **Qi sammeln**: Button unten rechts (+10 Qi).
- **Durchbruch**: aktiv sobald Qi voll ist.
- **Angreifen**: aktiv sobald ein NPC (Tier/Mensch/Fabelwesen) auf einem der 8 Nachbarfelder
  steht. Jeder Klick zieht dem NPC feste 15 HP ab; bei 0 HP verschwindet er dauerhaft (kein
  Respawn, keine Belohnung in dieser Version).
- **M**: wechselt zwischen normaler Ansicht (Kamera folgt Spieler) und
  Kartenansicht (ganze Weltkarte, alle Spieler als Punkte).
- **Logout**: verwirft die Identity dieses Tabs und lädt neu — danach kann
  sich derselbe Tab als anderer Spieler registrieren/einloggen.

Wasser- und Berg-Kacheln sind nicht begehbar (client- und serverseitig
durchgesetzt, siehe unten) — ein Schritt Richtung einer solchen Kachel wird
einfach nicht ausgeführt, der Spieler bleibt auf dem aktuellen Feld stehen.

## Karteneditor (`editor.html`)

Eigenständige Seite, kein Spieler-Login nötig, aber durch ein gemeinsames
Editor-Passwort geschützt (kein persönlicher Account, ein Passwort für alle
mit Zugriff):

```
http://localhost:8081/editor.html
```

**Einmalige Einrichtung nach jedem frischen `spacetime publish`**: das
Editor-Passwort existiert serverseitig noch nicht und muss einmal per CLI
gesetzt werden (der Reducer tut ab dem zweiten Aufruf nichts mehr — kann also
nicht von irgendjemand später überschrieben werden):

```bash
HASH=$(echo -n "dein-editor-passwort" | sha256sum | cut -d' ' -f1)
spacetime call --server local xianxia set_editor_password "$HASH"
```

Danach beim Öffnen von `editor.html` das Passwort eingeben und
"Freischalten" klicken — die Tab-Identity bleibt danach für den Rest der
`sessionStorage`-Session freigeschaltet (Reload derselben Tab überspringt den
Prompt, ein neuer Tab braucht das Passwort erneut, siehe "Mehrere Spieler
gleichzeitig testen" unten für das Identity-pro-Tab-Prinzip).

Nach dem Freischalten lädt der Editor die erste Karte. Rechts oben im
Panel: **Karten-Auswahl** — mehrere Karten können gleichzeitig existieren
(siehe "Mehrere Karten" unten); "Neue Karte erstellen" legt mit Name/Seed/
Wasseranteil/Skala eine komplett neue Welt an (dauert einige Sekunden, der
Button zeigt währenddessen einen Status-Text), "Als Standard setzen" legt
fest, auf welcher Karte neue `Register`-Aufrufe landen.

Drei Werkzeug-Reiter:
- **Terrain**: Biom-Pinsel (anklicken zum Auswählen) plus Ressourcenwerte
  (Kräuter, Spirit Stones, Holz, Erz) — Klicken/Ziehen auf der Karte malt die
  gewählte Kombination auf jede berührte Kachel, gespeichert über den
  `edit_tile`-Reducer.
- **NPC**: Art-Palette (Tier/Mensch/Fabelwesen-Unterarten) — Klick auf eine
  leere Kachel platziert einen neuen NPC, Klick auf einen bestehenden wählt
  ihn aus (danach Ziehen zum Verschieben), "NPC löschen" entfernt den
  ausgewählten dauerhaft.
- **Spieler**: Klick auf einen Spieler-Punkt wählt ihn aus (danach Ziehen
  zum Verschieben, ohne die Wasser/Berg-Kollisionsprüfung des normalen
  Spiels), "Spieler löschen" entfernt Account + Zugangsdaten vollständig.

Mausrad (oder die +/−-Buttons oben rechts über der Karte) zoomt rein/raus.
Hover über einer Kachel zeigt Biom-Name, Ressourcenwerte und — falls
vorhanden — NPC-/Spieler-Info an, unabhängig vom aktiven Werkzeug.

Alle Änderungen (Terrain, NPC, Spieler) sind serverseitig nur für
freigeschaltete Identities erlaubt (siehe `CLAUDE.md`) und sofort für alle
Spieler auf der jeweiligen Karte sichtbar.

### Mehrere Karten

Karten laufen **echt parallel**: Spieler auf unterschiedlichen Karten sehen
sich gegenseitig nicht (weder im Spiel-Client noch dessen NPC-Bestand). Ein
Spieler bleibt nach der Registrierung dauerhaft auf seiner Karte — es gibt
aktuell keinen Karten-Wechsel im Spiel-Client, nur der Editor kann eine
Karte zur neuen Standard-Karte für zukünftige Registrierungen machen.

## Mehrere Spieler gleichzeitig testen

Die Identity liegt in `sessionStorage`, nicht `localStorage` — das ist pro Tab
isoliert (anders als `localStorage`, das sich alle Tabs desselben Origins
teilen). **Einfach einen zweiten Tab auf dieselbe URL öffnen** bekommt
automatisch eine eigene Identity und kann einen zweiten Spieler registrieren;
beide Tabs sehen sich dann gegenseitig als Punkte auf der Karte, live über
WebSocket-Subscriptions — **sofern beide Registrierungen auf dieselbe
Standard-Karte trafen** (siehe "Mehrere Karten" oben; ein Editor-Wechsel der
Standard-Karte zwischen zwei Registrierungen platziert die Spieler auf
unterschiedlichen, sich gegenseitig unsichtbaren Karten).
Ein Reload behält die Identity des Tabs, Schließen des Tabs verwirft sie.

## Bekannte Einschränkungen (bewusste Vereinfachungen für den Testclient)

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
