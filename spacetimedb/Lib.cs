using SpacetimeDB;
using System;
using System.Collections.Generic;

public static partial class Module
{
    private const int WELT_BREITE   = 256;
    private const int WELT_HOEHE    = 256;
    private const int SEED          = 42;
    private const float SCALE       = 0.035f;
    private const int OKTAVEN       = 6;
    private const float PERSISTENZ  = 0.5f;
    private const float LACUNARITY  = 2.0f;
    private const float WASSER_ANTEIL = 0.30f;
    private const ulong QI_PRO_SAMMELN = 10;
    private const ushort NPC_ANGRIFF_SCHADEN    = 15;
    private const float  NPC_ANGRIFF_REICHWEITE = 1.0f; // Tiles, pro Achse (= 8 Nachbarfelder)

    // TimeSpan.FromSeconds ist keine Compile-Time-Konstante, daher static readonly statt const.
    private static readonly TimeSpan NPC_TICK_INTERVALL = TimeSpan.FromSeconds(3);

    private static readonly float[] LAND_SHARES = { 0.08f, 0.25f, 0.30f, 0.25f, 0.12f };

    private static readonly ushort[] TIERE_HP      = { 20, 40, 70 };   // Hase, Wolf, Tiger
    private static readonly ushort[] MENSCHEN_HP   = { 50, 60, 80 };   // Wanderer, Einsiedler, Raeuber
    private static readonly ushort[] FABELWESEN_HP = { 90, 70, 130 };  // Fuchsgeist, KranichFee, Berggeist

    // Indiziert nach Biom-Byte. Wasser/Berg immer 0 (unbegehbar -> keine Spawns, gleiche
    // Regel wie UpdatePosition sie für Spieler durchsetzt). Schnee vorerst ebenfalls 0
    // (auf Wunsch, keine unbegehbarkeits-Regel dahinter wie bei Wasser/Berg).
    private static readonly float[] NPC_SPAWN_CHANCE = { 0f, 0.004f, 0.006f, 0.01f, 0f, 0f };

    // Pro Biom Gewichte [Tiere, Menschen, Fabelwesen] (müssen nicht auf 1 summieren,
    // werden in KategorieWuerfeln normalisiert).
    private static readonly float[][] NPC_KATEGORIE_GEWICHTE = {
        new float[] { 0f,   0f,   0f   }, // Wasser (ungenutzt)
        new float[] { 0.30f,0.50f,0.20f}, // Strand
        new float[] { 0.40f,0.50f,0.10f}, // Ebene
        new float[] { 0.60f,0.10f,0.30f}, // Wald
        new float[] { 0f,   0f,   0f   }, // Berg (ungenutzt)
        new float[] { 0.20f,0.10f,0.70f}, // Schnee
    };

    public enum Biom : byte
    {
        Wasser  = 0,
        Strand  = 1,
        Ebene   = 2,
        Wald    = 3,
        Berg    = 4,
        Schnee  = 5
    }

    // TileId ist ein globaler Schlüssel = (MapId << 32) | (x + y*Breite), siehe WorldTileId() -
    // damit bleibt die Kachel-Suche ein einfacher Einzelspalten-.Find() (O(1)) über mehrere
    // Karten hinweg, ohne auf einen mehrspaltigen Index angewiesen zu sein (dessen
    // Abfrage-Syntax in diesem SpacetimeDB-SDK nirgends dokumentiert ist).
    [SpacetimeDB.Table(Accessor = "WorldTile", Public = true)]
    public partial struct WorldTile
    {
        [PrimaryKey] public ulong TileId;
        [SpacetimeDB.Index.BTree] public uint MapId;
        public short  X;
        public short  Y;
        public byte   BiomTyp;
        public float  NoiseWert;
        public byte   KraeuterMenge;
        public byte   SpiritStones;
        public byte   Holz;
        public byte   Erz;
    }

    // Eine Zeile pro Karte (nicht mehr Singleton) - MapId ist zugleich die Karten-ID.
    [SpacetimeDB.Table(Accessor = "WorldMeta", Public = true)]
    public partial struct WorldMeta
    {
        [PrimaryKey] [AutoInc] public uint MapId;
        public string Name;
        public bool   Generiert;
        public int    Seed;
        public short  Breite;
        public short  Hoehe;
        public float  WasserAnteil;
        public float  Skala;
    }

    // Zeiger-Singleton (Id immer 0), analog zu EditorSecret: welche Karte neue
    // Registrierungen bekommen. "Genau eine Zeile true" ist über [Unique] auf einem bool
    // nicht ausdrückbar, daher ein separater Zeiger statt einer IstStandard-Spalte auf WorldMeta.
    [SpacetimeDB.Table(Accessor = "StandardMap", Public = true)]
    public partial struct StandardMap
    {
        [PrimaryKey] public uint Id; // immer 0
        public uint MapId;
    }

    [SpacetimeDB.Table(Accessor = "Player", Public = true)]
    public partial struct Player
    {
        [PrimaryKey] public ulong PlayerId;
        [SpacetimeDB.Index.BTree] public uint MapId;
        public string Name;
        public ulong  Qi;
        public ulong  QiMaximum;
        public byte   Stufe;
        public float  PosX;
        public float  PosY;
    }

    public enum NpcKategorie : byte
    {
        Tiere      = 0,
        Menschen   = 1,
        Fabelwesen = 2
    }

    // Flaches Roster, gruppiert nach Kategorie (0-2 Tiere, 3-5 Menschen, 6-8 Fabelwesen) -
    // die Reihenfolge ist wichtig für ArtWuerfeln/HpFuerArt unten, nicht ohne Anpassung
    // dort umsortieren.
    public enum NpcArt : byte
    {
        Hase        = 0,
        Wolf        = 1,
        Tiger       = 2,
        Wanderer    = 3,
        Einsiedler  = 4,
        Raeuber     = 5,
        Fuchsgeist  = 6,
        KranichFee  = 7,
        Berggeist   = 8
    }

    // Statisches Verhaltensprofil pro NpcArt - ersetzt hand-kodierte Spezialfall-Zweige pro
    // Spezies durch eine Datentabelle, die NpcTick generisch für jeden NPC ausliest.
    // Beute-/BedrohungMaske sind Bitmasken über NpcArt (Bit i = NpcArt-Wert i), 9 Arten
    // passen bequem in ushort. Reine Balancing-Daten, keine Architekturentscheidung - die
    // konkrete Nahrungskette (wer jagt/flieht vor wem) lässt sich hier frei nachjustieren.
    private struct NpcVerhalten
    {
        public bool   WandertBeiLeerlauf;   // bewegt sich zufällig, wenn nichts in Reichweite ist
        public float  WanderChance;         // Wahrscheinlichkeit pro Tick für einen Leerlauf-Schritt (Drossel)
        public byte   Wahrnehmungsradius;   // Tschebyschew-Distanz in Kacheln
        public ushort BeuteMaske;           // NpcArt-Bits, die gejagt/angenähert werden
        public ushort BedrohungMaske;       // NpcArt-Bits, vor denen geflohen wird
        public bool   FliehtVorSpielern;    // behandelt nahe Spieler zusätzlich als Bedrohung
        public bool   NaehertSichSpielern;  // behandelt nahe Spieler zusätzlich als "Beute" (nur Annäherung, kein Kampf)
    }

    private static ushort Maske(params NpcArt[] arten)
    {
        ushort m = 0;
        foreach (var a in arten) m |= (ushort)(1 << (byte)a);
        return m;
    }

    // Indiziert direkt per (byte)NpcArt (0-8) - flach, kein Banding wie bei HpFuerArt nötig.
    private static readonly NpcVerhalten[] NPC_VERHALTEN =
    {
        // Hase (0): schreckhafte Beute, flieht vor Wolf/Tiger/Fuchsgeist und vor Spielern.
        new NpcVerhalten { WandertBeiLeerlauf = true,  WanderChance = 0.20f, Wahrnehmungsradius = 5,
            BeuteMaske = 0, BedrohungMaske = Maske(NpcArt.Wolf, NpcArt.Tiger, NpcArt.Fuchsgeist),
            FliehtVorSpielern = true, NaehertSichSpielern = false },
        // Wolf (1): jagt Hase, flieht vor Tiger und Berggeist.
        new NpcVerhalten { WandertBeiLeerlauf = true,  WanderChance = 0.15f, Wahrnehmungsradius = 6,
            BeuteMaske = Maske(NpcArt.Hase), BedrohungMaske = Maske(NpcArt.Tiger, NpcArt.Berggeist),
            FliehtVorSpielern = false, NaehertSichSpielern = false },
        // Tiger (2): Spitzenprädator, jagt Hase+Wolf, fürchtet nichts.
        new NpcVerhalten { WandertBeiLeerlauf = true,  WanderChance = 0.12f, Wahrnehmungsradius = 7,
            BeuteMaske = Maske(NpcArt.Hase, NpcArt.Wolf), BedrohungMaske = 0,
            FliehtVorSpielern = false, NaehertSichSpielern = false },
        // Wanderer (3): neutraler Reisender, flieht vor Raubtieren und Räubern.
        new NpcVerhalten { WandertBeiLeerlauf = true,  WanderChance = 0.15f, Wahrnehmungsradius = 4,
            BeuteMaske = 0, BedrohungMaske = Maske(NpcArt.Wolf, NpcArt.Tiger, NpcArt.Raeuber),
            FliehtVorSpielern = false, NaehertSichSpielern = false },
        // Einsiedler (4): bleibt meist an Ort, meidet Räuber und Besucher.
        new NpcVerhalten { WandertBeiLeerlauf = false, WanderChance = 0.0f,  Wahrnehmungsradius = 3,
            BeuteMaske = 0, BedrohungMaske = Maske(NpcArt.Raeuber),
            FliehtVorSpielern = true, NaehertSichSpielern = false },
        // Raeuber (5): jagt andere Menschen, pirscht sich auch an Spieler heran.
        new NpcVerhalten { WandertBeiLeerlauf = true,  WanderChance = 0.20f, Wahrnehmungsradius = 6,
            BeuteMaske = Maske(NpcArt.Wanderer, NpcArt.Einsiedler), BedrohungMaske = Maske(NpcArt.Tiger),
            FliehtVorSpielern = false, NaehertSichSpielern = true },
        // Fuchsgeist (6): Trickster, jagt Hase, flieht vor Berggeist.
        new NpcVerhalten { WandertBeiLeerlauf = true,  WanderChance = 0.18f, Wahrnehmungsradius = 5,
            BeuteMaske = Maske(NpcArt.Hase), BedrohungMaske = Maske(NpcArt.Berggeist),
            FliehtVorSpielern = false, NaehertSichSpielern = false },
        // KranichFee (7): scheu, flieht vor fast allem und vor Spielern.
        new NpcVerhalten { WandertBeiLeerlauf = true,  WanderChance = 0.10f, Wahrnehmungsradius = 6,
            BeuteMaske = 0, BedrohungMaske = Maske(NpcArt.Wolf, NpcArt.Tiger, NpcArt.Raeuber, NpcArt.Fuchsgeist),
            FliehtVorSpielern = true, NaehertSichSpielern = false },
        // Berggeist (8): stoischer Wächter, fürchtet nichts, bewegt sich selten.
        new NpcVerhalten { WandertBeiLeerlauf = true,  WanderChance = 0.05f, Wahrnehmungsradius = 4,
            BeuteMaske = 0, BedrohungMaske = 0,
            FliehtVorSpielern = false, NaehertSichSpielern = false },
    };

    [SpacetimeDB.Table(Accessor = "Npc", Public = true)]
    public partial struct Npc
    {
        [PrimaryKey] [AutoInc] public ulong NpcId;
        [SpacetimeDB.Index.BTree] public uint MapId;
        public byte   Kategorie;   // NpcKategorie
        public byte   Art;         // NpcArt
        public short  PosX;
        public short  PosY;
        public ushort Hp;
        public ushort HpMaximum;
    }

    // Treibt NpcTick per Intervall an - erste geplante Reduktion in diesem Modul. Public =
    // true folgt exakt dem in .windsurfrules/AGENTS.md dokumentierten Scheduled-Table-Muster;
    // kein Client abonniert diese Tabelle (alle Subscriptions in app.ts/editor.ts/world.ts
    // sind explizite Allow-Lists), daher kein Traffic-Impact.
    [SpacetimeDB.Table(
        Accessor    = "NpcTickTimer",
        Scheduled   = nameof(NpcTick),
        ScheduledAt = nameof(ScheduledAt),
        Public      = true
    )]
    public partial struct NpcTickTimer
    {
        [PrimaryKey] [AutoInc] public ulong ScheduledId;
        public ScheduleAt ScheduledAt;
    }

    // Not Public: password hashes must never be readable via the public SQL/subscription
    // interface (they're the sole login credential - no server-side salting, see Register).
    [SpacetimeDB.Table(Accessor = "Credential")]
    public partial struct Credential
    {
        [PrimaryKey] public ulong PlayerId;
        public string PasswordHash;
    }

    // Public, but deliberately carries no secret: only a pass/fail bit per PlayerId so the
    // client can observe whether its own Login call matched, without ever reading a hash back.
    [SpacetimeDB.Table(Accessor = "LoginAttempt", Public = true)]
    public partial struct LoginAttempt
    {
        [PrimaryKey] public ulong PlayerId;
        public bool Success;
    }

    // Not Public, singleton (Id always 0): the map-editor password hash. Set once via
    // SetEditorPassword (meant to be called from the CLI right after publish, never from
    // web_client JS/git) - deliberately kept out of source control, unlike every other
    // "secret" in this POC.
    [SpacetimeDB.Table(Accessor = "EditorSecret")]
    public partial struct EditorSecret
    {
        [PrimaryKey] public uint Id;
        public string PasswordHash;
    }

    // Public, but carries no secret: just whether this caller's Identity is currently
    // authorized to call EditTile. Keyed by the raw Identity (not the hashed PlayerId used
    // for Player/Credential) since editor.html has no registered player to key off of.
    [SpacetimeDB.Table(Accessor = "EditorSession", Public = true)]
    public partial struct EditorSession
    {
        [PrimaryKey] public Identity Owner;
        public bool Authorized;
    }

    // Not Public: purely an internal identity->playerId link so a relogin from a new
    // connection (new browser tab/device, different Identity) can act as the target
    // account. Written only by Register (to your own new row) or by Login after a
    // successful password check - a client can never bind itself to an arbitrary
    // PlayerId without knowing the password. See SenderPlayerId.
    [SpacetimeDB.Table(Accessor = "PlayerSession")]
    public partial struct PlayerSession
    {
        [PrimaryKey] public Identity Identity;
        public ulong PlayerId;
    }

    [SpacetimeDB.Reducer(ReducerKind.Init)]
    public static void Init(ReducerContext ctx)
    {
        if (ctx.Db.WorldMeta.Iter().Any())
        {
            Log.Info("Welt(en) bereits vorhanden – überspringe.");
            return;
        }

        Log.Info($"Starte Weltgenerierung {WELT_BREITE}x{WELT_HOEHE} mit Seed {SEED}...");
        var meta = ctx.Db.WorldMeta.Insert(new WorldMeta
        {
            MapId        = 0, // AutoInc
            Name         = "Standardwelt",
            Generiert    = false,
            Seed         = SEED,
            Breite       = WELT_BREITE,
            Hoehe        = WELT_HOEHE,
            WasserAnteil = WASSER_ANTEIL,
            Skala        = SCALE
        });
        WeltGenerieren(ctx, meta.MapId, SEED, WASSER_ANTEIL, SCALE);
        NpcsPlatzieren(ctx, meta.MapId);
        meta.Generiert = true;
        ctx.Db.WorldMeta.MapId.Update(meta);
        ctx.Db.StandardMap.Insert(new StandardMap { Id = 0, MapId = meta.MapId });
        ctx.Db.NpcTickTimer.Insert(new NpcTickTimer
        {
            ScheduledId = 0, // AutoInc
            ScheduledAt = new ScheduleAt.Interval(NPC_TICK_INTERVALL)
        });
        Log.Info("Weltgenerierung abgeschlossen!");
    }

    // Resolves the PlayerId this connection is currently allowed to act as. A successful
    // Register or Login writes a PlayerSession row binding ctx.Sender to that PlayerId
    // (see those reducers) - checked first so a relogin from a fresh Identity (new tab,
    // cleared session, different device) actually works, not just a hash match on the
    // connecting Identity itself. Falls back to the raw hash for rows created before this
    // fix / Identities that only ever registered and never needed a PlayerSession lookup;
    // still safe, since that hash is still only ever *their own* PlayerId.
    private static ulong SenderPlayerId(ReducerContext ctx)
    {
        var session = ctx.Db.PlayerSession.Identity.Find(ctx.Sender);
        if (session != null) return session.Value.PlayerId;
        return (ulong)Math.Abs(ctx.Sender.GetHashCode());
    }

    // Globaler WorldTile-Schlüssel über mehrere Karten hinweg, siehe WorldTile-Kommentar oben.
    private static ulong WorldTileId(uint mapId, int x, int y) =>
        ((ulong)mapId << 32) | (uint)(x + y * WELT_BREITE);

    // Einzige Quelle der Wahrheit für "kann hier etwas stehen" - von UpdatePosition (Spieler)
    // und NpcsBewegen (NPCs) gemeinsam genutzt, statt zweimal inline dupliziert. Eine
    // ungenerierte/nicht existente Kachel gilt als begehbar (gleiche Regel wie zuvor inline).
    private static bool IstBegehbar(ReducerContext ctx, uint mapId, int x, int y)
    {
        var tile = ctx.Db.WorldTile.TileId.Find(WorldTileId(mapId, x, y));
        return tile == null || (tile.Value.BiomTyp != (byte)Biom.Wasser && tile.Value.BiomTyp != (byte)Biom.Berg);
    }

    // Ob ctx.Sender aktuell für Editor-Reducer (EditTile, KarteErstellen, Npc-/Spieler-CRUD)
    // freigeschaltet ist - separater Autorisierungskanal von SenderPlayerId, siehe EditorLogin.
    private static bool EditorAuthorized(ReducerContext ctx)
    {
        var session = ctx.Db.EditorSession.Owner.Find(ctx.Sender);
        return session != null && session.Value.Authorized;
    }

    [SpacetimeDB.Reducer]
    public static void Register(ReducerContext ctx, string name, string passwordHash)
    {
        var playerId = SenderPlayerId(ctx);
        if (ctx.Db.Player.PlayerId.Find(playerId) != null)
        {
            Log.Info("Spieler bereits registriert.");
            return;
        }

        foreach (var existing in ctx.Db.Player.Iter())
        {
            if (existing.Name != name) continue;
            Log.Info($"Name bereits vergeben: {name}");
            return;
        }

        var standard = ctx.Db.StandardMap.Id.Find(0);
        if (standard == null)
        {
            Log.Warn("Kein Standard-Kartenzeiger gesetzt - Registrierung abgelehnt.");
            return;
        }

        ctx.Db.Player.Insert(new Player
        {
            PlayerId  = playerId,
            MapId     = standard.Value.MapId,
            Name      = name,
            Qi        = 0,
            QiMaximum = 100,
            Stufe     = 0,
            PosX      = 128f,
            PosY      = 128f
        });
        ctx.Db.Credential.Insert(new Credential { PlayerId = playerId, PasswordHash = passwordHash });
        ctx.Db.PlayerSession.Insert(new PlayerSession { Identity = ctx.Sender, PlayerId = playerId });
        Log.Info($"Neuer Kultivator: {name}");
    }

    [SpacetimeDB.Reducer]
    public static void Login(ReducerContext ctx, string name, string passwordHash)
    {
        foreach (var player in ctx.Db.Player.Iter())
        {
            if (player.Name != name) continue;

            var cred = ctx.Db.Credential.PlayerId.Find(player.PlayerId);
            bool success = cred != null && cred.Value.PasswordHash == passwordHash;

            if (ctx.Db.LoginAttempt.PlayerId.Find(player.PlayerId) != null)
                ctx.Db.LoginAttempt.PlayerId.Update(new LoginAttempt { PlayerId = player.PlayerId, Success = success });
            else
                ctx.Db.LoginAttempt.Insert(new LoginAttempt { PlayerId = player.PlayerId, Success = success });

            if (success)
            {
                // Binds *this* connection's Identity to the target account, so subsequent
                // action reducers (UpdatePosition/QiSammeln/Durchbruch) resolve to the
                // right PlayerId even from a brand-new Identity - this is what actually
                // makes a relogin from a new tab/device/session work.
                if (ctx.Db.PlayerSession.Identity.Find(ctx.Sender) != null)
                    ctx.Db.PlayerSession.Identity.Update(new PlayerSession { Identity = ctx.Sender, PlayerId = player.PlayerId });
                else
                    ctx.Db.PlayerSession.Insert(new PlayerSession { Identity = ctx.Sender, PlayerId = player.PlayerId });
            }

            Log.Info(success ? $"Login erfolgreich: {name}" : $"Falsches Passwort für: {name}");
            return;
        }
        Log.Warn($"Spieler nicht gefunden: {name}");
    }

    [SpacetimeDB.Reducer]
    public static void UpdatePosition(ReducerContext ctx, float x, float y)
    {
        var player = ctx.Db.Player.PlayerId.Find(SenderPlayerId(ctx));
        if (player == null) return;

        var p = player.Value;
        float ix = Math.Clamp(x, 0, WELT_BREITE - 1);
        float iy = Math.Clamp(y, 0, WELT_HOEHE - 1);
        if (!IstBegehbar(ctx, p.MapId, (int)ix, (int)iy)) return;

        p.PosX = ix;
        p.PosY = iy;
        ctx.Db.Player.PlayerId.Update(p);
    }

    // Meant to be called exactly once from the CLI right after `spacetime publish`
    // (`spacetime call <db> set_editor_password <sha256-hex-of-your-chosen-password>`),
    // never from the web client - that's what keeps the actual secret out of git and off
    // the wire except for that one deployer-initiated call. No-ops if already set, so a
    // stray/malicious call can't overwrite an existing password.
    [SpacetimeDB.Reducer]
    public static void SetEditorPassword(ReducerContext ctx, string passwordHash)
    {
        if (ctx.Db.EditorSecret.Id.Find(0) != null)
        {
            Log.Warn("Editor-Passwort ist bereits gesetzt, Aufruf ignoriert.");
            return;
        }
        ctx.Db.EditorSecret.Insert(new EditorSecret { Id = 0, PasswordHash = passwordHash });
        Log.Info("Editor-Passwort gesetzt.");
    }

    [SpacetimeDB.Reducer]
    public static void EditorLogin(ReducerContext ctx, string passwordHash)
    {
        var secret = ctx.Db.EditorSecret.Id.Find(0);
        bool authorized = secret != null && secret.Value.PasswordHash == passwordHash;

        if (ctx.Db.EditorSession.Owner.Find(ctx.Sender) != null)
            ctx.Db.EditorSession.Owner.Update(new EditorSession { Owner = ctx.Sender, Authorized = authorized });
        else
            ctx.Db.EditorSession.Insert(new EditorSession { Owner = ctx.Sender, Authorized = authorized });
    }

    [SpacetimeDB.Reducer]
    public static void EditTile(ReducerContext ctx, uint mapId, short x, short y, byte biomTyp,
        byte kraeuterMenge, byte spiritStones, byte holz, byte erz)
    {
        if (!EditorAuthorized(ctx)) return;

        if (x < 0 || x >= WELT_BREITE || y < 0 || y >= WELT_HOEHE) return;
        if (biomTyp > (byte)Biom.Schnee) return;

        var tile = ctx.Db.WorldTile.TileId.Find(WorldTileId(mapId, x, y));
        if (tile == null) return;
        var t = tile.Value;
        t.BiomTyp       = biomTyp;
        t.KraeuterMenge = kraeuterMenge;
        t.SpiritStones  = spiritStones;
        t.Holz          = holz;
        t.Erz           = erz;
        ctx.Db.WorldTile.TileId.Update(t);
    }

    [SpacetimeDB.Reducer]
    public static void QiSammeln(ReducerContext ctx)
    {
        var player = ctx.Db.Player.PlayerId.Find(SenderPlayerId(ctx));
        if (player == null) return;
        var p = player.Value;
        p.Qi  = Math.Min(p.Qi + QI_PRO_SAMMELN, p.QiMaximum);
        ctx.Db.Player.PlayerId.Update(p);
    }

    [SpacetimeDB.Reducer]
    public static void Durchbruch(ReducerContext ctx)
    {
        var player = ctx.Db.Player.PlayerId.Find(SenderPlayerId(ctx));
        if (player == null) return;
        var p = player.Value;
        if (p.Qi < p.QiMaximum) return;

        float[] chancen = { 0.85f, 0.60f, 0.35f, 0.15f };
        float chance    = p.Stufe < chancen.Length ? chancen[p.Stufe] : 0.10f;
        bool erfolg     = new Random().NextDouble() < chance;

        if (erfolg)
        {
            p.Stufe++;
            p.QiMaximum = (ulong)(p.QiMaximum * 1.5);
            p.Qi        = 0;
            Log.Info($"{p.Name} Durchbruch! Stufe {p.Stufe}");
        }
        else
        {
            p.Qi = p.QiMaximum / 2;
            Log.Info($"{p.Name} Durchbruch fehlgeschlagen.");
        }
        ctx.Db.Player.PlayerId.Update(p);
    }

    [SpacetimeDB.Reducer]
    public static void Angreifen(ReducerContext ctx, ulong npcId)
    {
        var player = ctx.Db.Player.PlayerId.Find(SenderPlayerId(ctx));
        if (player == null) return;

        var npc = ctx.Db.Npc.NpcId.Find(npcId);
        if (npc == null) return;

        var p = player.Value;
        var n = npc.Value;
        if (n.MapId != p.MapId) return;
        if (Math.Abs(p.PosX - n.PosX) > NPC_ANGRIFF_REICHWEITE ||
            Math.Abs(p.PosY - n.PosY) > NPC_ANGRIFF_REICHWEITE)
            return;

        int neuesHp = n.Hp - NPC_ANGRIFF_SCHADEN;
        if (neuesHp <= 0)
        {
            ctx.Db.Npc.NpcId.Delete(npcId);
            Log.Info($"NPC {n.Art} (#{n.NpcId}) wurde besiegt.");
            return;
        }

        n.Hp = (ushort)neuesHp;
        ctx.Db.Npc.NpcId.Update(n);
    }

    // Von NpcTickTimer (Interval) angetrieben - iteriert alle Karten, bewegt NPCs pro Karte
    // unabhängig. Reine Bewegungs-Reaktion (Fliehen/Annähern), kein NPC-vs-NPC-Kampf/Fressen -
    // das ist eine bewusst separat gehaltene, spätere Erweiterung (siehe Angreifen-Muster).
    [SpacetimeDB.Reducer]
    public static void NpcTick(ReducerContext ctx, NpcTickTimer timer)
    {
        foreach (var map in ctx.Db.WorldMeta.Iter())
            NpcsBewegen(ctx, map.MapId);
    }

    // Erstellt eine neue Karte (Terrain + NPC-Population) mit editierbaren Kernparametern.
    // Generiert inline über alle 65536 Kacheln - spürbar langsamer als ein normaler
    // Reducer-Call (Sekunden, nicht Millisekunden); Editor-UI sollte dafür einen
    // Busy-State zeigen statt ein sofortiges Ergebnis anzunehmen.
    [SpacetimeDB.Reducer]
    public static void KarteErstellen(ReducerContext ctx, string name, int seed, float wasserAnteil, float skala)
    {
        if (!EditorAuthorized(ctx)) return;
        if (wasserAnteil < 0f || wasserAnteil > 1f || skala <= 0f) return;

        var meta = ctx.Db.WorldMeta.Insert(new WorldMeta
        {
            MapId        = 0, // AutoInc
            Name         = name,
            Generiert    = false,
            Seed         = seed,
            Breite       = WELT_BREITE,
            Hoehe        = WELT_HOEHE,
            WasserAnteil = wasserAnteil,
            Skala        = skala
        });
        WeltGenerieren(ctx, meta.MapId, seed, wasserAnteil, skala);
        NpcsPlatzieren(ctx, meta.MapId);
        meta.Generiert = true;
        ctx.Db.WorldMeta.MapId.Update(meta);
        Log.Info($"Neue Karte erstellt: {name} (#{meta.MapId})");
    }

    [SpacetimeDB.Reducer]
    public static void KarteAlsStandardSetzen(ReducerContext ctx, uint mapId)
    {
        if (!EditorAuthorized(ctx)) return;
        if (ctx.Db.WorldMeta.MapId.Find(mapId) == null) return;
        ctx.Db.StandardMap.Id.Update(new StandardMap { Id = 0, MapId = mapId });
    }

    [SpacetimeDB.Reducer]
    public static void NpcErstellen(ReducerContext ctx, uint mapId, byte kategorie, byte art, short x, short y)
    {
        if (!EditorAuthorized(ctx)) return;
        if (ctx.Db.WorldMeta.MapId.Find(mapId) == null) return;
        if (x < 0 || x >= WELT_BREITE || y < 0 || y >= WELT_HOEHE) return;
        if (kategorie > (byte)NpcKategorie.Fabelwesen || art > (byte)NpcArt.Berggeist) return;

        ushort hp = HpFuerArt(art);
        ctx.Db.Npc.Insert(new Npc
        {
            NpcId     = 0, // AutoInc
            MapId     = mapId,
            Kategorie = kategorie,
            Art       = art,
            PosX      = x,
            PosY      = y,
            Hp        = hp,
            HpMaximum = hp
        });
    }

    [SpacetimeDB.Reducer]
    public static void NpcVerschieben(ReducerContext ctx, ulong npcId, short x, short y)
    {
        if (!EditorAuthorized(ctx)) return;
        var npc = ctx.Db.Npc.NpcId.Find(npcId);
        if (npc == null) return;
        if (x < 0 || x >= WELT_BREITE || y < 0 || y >= WELT_HOEHE) return;

        var n = npc.Value;
        n.PosX = x;
        n.PosY = y;
        ctx.Db.Npc.NpcId.Update(n);
    }

    [SpacetimeDB.Reducer]
    public static void NpcLoeschen(ReducerContext ctx, ulong npcId)
    {
        if (!EditorAuthorized(ctx)) return;
        ctx.Db.Npc.NpcId.Delete(npcId);
    }

    // Bewusste, dokumentierte Ausnahme von "nie client-gelieferte playerId annehmen": die
    // Autorisierung läuft hier über den separaten EditorSession-Kanal (nicht über die
    // Spieler-Identität selbst) - analog dazu, wie EditTile bereits beliebige WorldTile-Zeilen
    // ändern darf. Keine Wiederholung der ursprünglichen, längst gefixten
    // Impersonations-Lücke (die betraf normale Gameplay-Reducer ganz ohne separate Autorisierung).
    [SpacetimeDB.Reducer]
    public static void SpielerVerschieben(ReducerContext ctx, ulong playerId, float x, float y)
    {
        if (!EditorAuthorized(ctx)) return;
        var player = ctx.Db.Player.PlayerId.Find(playerId);
        if (player == null) return;

        var p = player.Value;
        p.PosX = Math.Clamp(x, 0, WELT_BREITE - 1);
        p.PosY = Math.Clamp(y, 0, WELT_HOEHE - 1);
        ctx.Db.Player.PlayerId.Update(p);
    }

    [SpacetimeDB.Reducer]
    public static void SpielerLoeschen(ReducerContext ctx, ulong playerId)
    {
        if (!EditorAuthorized(ctx)) return;
        ctx.Db.Player.PlayerId.Delete(playerId);
        ctx.Db.Credential.PlayerId.Delete(playerId);
        foreach (var session in ctx.Db.PlayerSession.Iter())
        {
            if (session.PlayerId != playerId) continue;
            ctx.Db.PlayerSession.Identity.Delete(session.Identity);
            break;
        }
    }

    private static void NpcsPlatzieren(ReducerContext ctx, uint mapId)
    {
        foreach (var tile in ctx.Db.WorldTile.MapId.Filter(mapId))
        {
            if (tile.BiomTyp == (byte)Biom.Wasser || tile.BiomTyp == (byte)Biom.Berg) continue;

            float chance = NPC_SPAWN_CHANCE[tile.BiomTyp];
            if (chance <= 0f || ctx.Rng.NextDouble() >= chance) continue;

            var kategorie = KategorieWuerfeln(ctx, NPC_KATEGORIE_GEWICHTE[tile.BiomTyp]);
            byte art = ArtWuerfeln(ctx, kategorie);
            ushort hp = HpFuerArt(art);

            ctx.Db.Npc.Insert(new Npc
            {
                NpcId     = 0, // AutoInc
                MapId     = mapId,
                Kategorie = (byte)kategorie,
                Art       = art,
                PosX      = tile.X,
                PosY      = tile.Y,
                Hp        = hp,
                HpMaximum = hp
            });
        }
    }

    private static NpcKategorie KategorieWuerfeln(ReducerContext ctx, float[] gewichte)
    {
        float summe = gewichte[0] + gewichte[1] + gewichte[2];
        float r = (float)ctx.Rng.NextDouble() * summe;
        if (r < gewichte[0]) return NpcKategorie.Tiere;
        if (r < gewichte[0] + gewichte[1]) return NpcKategorie.Menschen;
        return NpcKategorie.Fabelwesen;
    }

    private static byte ArtWuerfeln(ReducerContext ctx, NpcKategorie kategorie)
    {
        int index = ctx.Rng.Next(0, 3);
        return kategorie switch
        {
            NpcKategorie.Tiere    => (byte)((byte)NpcArt.Hase + index),
            NpcKategorie.Menschen => (byte)((byte)NpcArt.Wanderer + index),
            _                     => (byte)((byte)NpcArt.Fuchsgeist + index),
        };
    }

    private static ushort HpFuerArt(byte art)
    {
        if (art <= (byte)NpcArt.Tiger)   return TIERE_HP[art - (byte)NpcArt.Hase];
        if (art <= (byte)NpcArt.Raeuber) return MENSCHEN_HP[art - (byte)NpcArt.Wanderer];
        return FABELWESEN_HP[art - (byte)NpcArt.Fuchsgeist];
    }

    // Ein Durchlauf pro NPC dieser Karte: Bedrohung sehen -> fliehen, sonst Beute sehen ->
    // annähern, sonst (mit WanderChance) ein zufälliger Leerlauf-Schritt. Bewegt sich der NPC
    // diesen Tick nicht, bleibt es bei keinem Update-Aufruf - das ist die Haupt-Drossel gegen
    // Schreib-/Netzwerklast bei ~250 NPCs/Karte.
    private static void NpcsBewegen(ReducerContext ctx, uint mapId)
    {
        var npcs = new List<Npc>(ctx.Db.Npc.MapId.Filter(mapId));
        if (npcs.Count == 0) return;
        var players = new List<Player>(ctx.Db.Player.MapId.Filter(mapId));

        foreach (var npc in npcs)
        {
            var profil = NPC_VERHALTEN[npc.Art];

            if (NaechstesZiel(npc, npcs, players, profil.BedrohungMaske, profil.FliehtVorSpielern,
                    profil.Wahrnehmungsradius, out int bx, out int by))
            {
                if (SchrittRichtung(ctx, mapId, npc.PosX, npc.PosY, bx, by, weg: true, out short nx, out short ny))
                    AktualisierePosition(ctx, npc, nx, ny);
                continue;
            }

            if (NaechstesZiel(npc, npcs, players, profil.BeuteMaske, profil.NaehertSichSpielern,
                    profil.Wahrnehmungsradius, out int px, out int py))
            {
                if (SchrittRichtung(ctx, mapId, npc.PosX, npc.PosY, px, py, weg: false, out short nx, out short ny))
                    AktualisierePosition(ctx, npc, nx, ny);
                continue;
            }

            if (profil.WandertBeiLeerlauf && ctx.Rng.NextDouble() < profil.WanderChance
                && ZufaelligerSchritt(ctx, mapId, npc.PosX, npc.PosY, out short wx, out short wy))
            {
                AktualisierePosition(ctx, npc, wx, wy);
            }
        }
    }

    // Nächstes Ziel (NPC-Art in artMaske, optional plus Spieler) innerhalb radius, nach
    // Tschebyschew-Distanz - bei mehreren Treffern gewinnt das nächste.
    private static bool NaechstesZiel(Npc self, List<Npc> npcs, List<Player> players, ushort artMaske,
        bool inklusiveSpieler, byte radius, out int zx, out int zy)
    {
        zx = 0; zy = 0;
        int besteDistanz = radius + 1;
        bool gefunden = false;

        if (artMaske != 0)
        {
            foreach (var other in npcs)
            {
                if (other.NpcId == self.NpcId) continue;
                if ((artMaske & (1 << other.Art)) == 0) continue;
                int dist = Math.Max(Math.Abs(other.PosX - self.PosX), Math.Abs(other.PosY - self.PosY));
                if (dist <= radius && dist < besteDistanz)
                {
                    besteDistanz = dist; zx = other.PosX; zy = other.PosY; gefunden = true;
                }
            }
        }

        if (inklusiveSpieler)
        {
            foreach (var p in players)
            {
                int px = (int)Math.Round(p.PosX), py = (int)Math.Round(p.PosY);
                int dist = Math.Max(Math.Abs(px - self.PosX), Math.Abs(py - self.PosY));
                if (dist <= radius && dist < besteDistanz)
                {
                    besteDistanz = dist; zx = px; zy = py; gefunden = true;
                }
            }
        }

        return gefunden;
    }

    // Greedy ein-Kachel-Schritt Richtung (weg=false) oder von (weg=true) einem Ziel - bewusst
    // keine Pfadsuche. Unter allen begehbaren Nachbarn wird der mit der besten
    // Distanzänderung zum Ziel gewählt; ist keiner begehbar, bleibt der NPC diesen Tick stehen.
    private static bool SchrittRichtung(ReducerContext ctx, uint mapId, short x, short y, int zielX, int zielY,
        bool weg, out short nx, out short ny)
    {
        nx = x; ny = y;
        bool gefunden = false;
        int besteBewertung = 0;

        for (int ndx = -1; ndx <= 1; ndx++)
        for (int ndy = -1; ndy <= 1; ndy++)
        {
            if (ndx == 0 && ndy == 0) continue;
            int cx = x + ndx, cy = y + ndy;
            if (cx < 0 || cx >= WELT_BREITE || cy < 0 || cy >= WELT_HOEHE) continue;
            if (!IstBegehbar(ctx, mapId, cx, cy)) continue;

            int distZiel = Math.Max(Math.Abs(cx - zielX), Math.Abs(cy - zielY));
            int bewertung = weg ? distZiel : -distZiel; // größer ist immer besser
            if (!gefunden || bewertung > besteBewertung)
            {
                besteBewertung = bewertung; nx = (short)cx; ny = (short)cy; gefunden = true;
            }
        }
        return gefunden;
    }

    private static bool ZufaelligerSchritt(ReducerContext ctx, uint mapId, short x, short y, out short nx, out short ny)
    {
        var kandidaten = new List<(short, short)>();
        for (int ndx = -1; ndx <= 1; ndx++)
        for (int ndy = -1; ndy <= 1; ndy++)
        {
            if (ndx == 0 && ndy == 0) continue;
            int cx = x + ndx, cy = y + ndy;
            if (cx < 0 || cx >= WELT_BREITE || cy < 0 || cy >= WELT_HOEHE) continue;
            if (!IstBegehbar(ctx, mapId, cx, cy)) continue;
            kandidaten.Add(((short)cx, (short)cy));
        }

        if (kandidaten.Count == 0) { nx = x; ny = y; return false; }
        (nx, ny) = kandidaten[ctx.Rng.Next(kandidaten.Count)];
        return true;
    }

    private static void AktualisierePosition(ReducerContext ctx, Npc npc, short x, short y)
    {
        npc.PosX = x;
        npc.PosY = y;
        ctx.Db.Npc.NpcId.Update(npc);
    }

    private static void WeltGenerieren(ReducerContext ctx, uint mapId, int seed, float wasserAnteil, float skala)
    {
        int[] perm = BuildPerm(seed);

        float[] rohdaten = new float[WELT_BREITE * WELT_HOEHE];
        float min = float.MaxValue, max = float.MinValue;

        for (int y = 0; y < WELT_HOEHE; y++)
        for (int x = 0; x < WELT_BREITE; x++)
        {
            float v = OctaveNoise(perm, x * skala, y * skala, OKTAVEN, PERSISTENZ, LACUNARITY);
            rohdaten[x + y * WELT_BREITE] = v;
            if (v < min) min = v;
            if (v > max) max = v;
        }

        float range = max - min;
        for (int i = 0; i < rohdaten.Length; i++)
            rohdaten[i] = (rohdaten[i] - min) / range;

        float[] sortiert = (float[])rohdaten.Clone();
        Array.Sort(sortiert);
        float wasserSchwelle = sortiert[(int)(wasserAnteil * sortiert.Length)];

        float[] landSchwellen = new float[LAND_SHARES.Length];
        float kumulativ = 0f;
        for (int i = 0; i < LAND_SHARES.Length; i++)
        {
            kumulativ += LAND_SHARES[i];
            float quantil = wasserAnteil + (1f - wasserAnteil) * kumulativ;
            int idx = (int)(quantil * (sortiert.Length - 1));
            idx = Math.Clamp(idx, 0, sortiert.Length - 1);
            landSchwellen[i] = sortiert[idx];
        }

        var rng = new Random(seed + 1);

        for (int y = 0; y < WELT_HOEHE; y++)
        for (int x = 0; x < WELT_BREITE; x++)
        {
            float v    = rohdaten[x + y * WELT_BREITE];
            Biom  biom = BiomBestimmen(v, wasserSchwelle, landSchwellen);

            ctx.Db.WorldTile.Insert(new WorldTile
            {
                TileId         = WorldTileId(mapId, x, y),
                MapId          = mapId,
                X              = (short)x,
                Y              = (short)y,
                BiomTyp        = (byte)biom,
                NoiseWert      = v,
                KraeuterMenge  = RessourceMenge(rng, biom, Biom.Wald, 0, 8),
                SpiritStones   = RessourceMenge(rng, biom, Biom.Berg, 0, 5),
                Holz           = RessourceMenge(rng, biom, Biom.Wald, 0, 6),
                Erz            = RessourceMenge(rng, biom, Biom.Berg, 0, 4)
            });
        }
    }

    private static Biom BiomBestimmen(float v, float wasser, float[] land)
    {
        if (v <= wasser)  return Biom.Wasser;
        if (v <= land[0]) return Biom.Strand;
        if (v <= land[1]) return Biom.Ebene;
        if (v <= land[2]) return Biom.Wald;
        if (v <= land[3]) return Biom.Berg;
        return Biom.Schnee;
    }

    private static byte RessourceMenge(Random rng, Biom biom, Biom zielBiom, int min, int max)
    {
        if (biom == zielBiom)
            return (byte)rng.Next(min + max / 2, max + 1);
        if (biom == Biom.Wasser || biom == Biom.Schnee)
            return 0;
        return (byte)rng.Next(min, max / 3 + 1);
    }

    private static int[] BuildPerm(int seed)
    {
        int[] p = new int[256];
        for (int i = 0; i < 256; i++) p[i] = i;

        var rng = new Random(seed);
        for (int i = 255; i > 0; i--)
        {
            int j   = rng.Next(i + 1);
            (p[i], p[j]) = (p[j], p[i]);
        }

        int[] perm = new int[512];
        for (int i = 0; i < 512; i++) perm[i] = p[i & 255];
        return perm;
    }

    private static float Fade(float t) =>
        t * t * t * (t * (t * 6 - 15) + 10);

    private static float Lerp(float a, float b, float t) =>
        a + t * (b - a);

    private static float Grad(int hash, float x, float y)
    {
        int h = hash & 7;
        float u = h < 4 ? x : y;
        float v = h < 4 ? y : x;
        return ((h & 1) == 0 ? u : -u) + ((h & 2) == 0 ? v : -v);
    }

    private static float Noise2D(int[] perm, float x, float y)
    {
        int xi = (int)Math.Floor(x) & 255;
        int yi = (int)Math.Floor(y) & 255;
        float xf = x - (float)Math.Floor(x);
        float yf = y - (float)Math.Floor(y);
        float u  = Fade(xf);
        float v  = Fade(yf);

        int aa = perm[perm[xi]     + yi];
        int ab = perm[perm[xi]     + yi + 1];
        int ba = perm[perm[xi + 1] + yi];
        int bb = perm[perm[xi + 1] + yi + 1];

        return Lerp(
            Lerp(Grad(aa, xf,     yf    ), Grad(ba, xf - 1, yf    ), u),
            Lerp(Grad(ab, xf,     yf - 1), Grad(bb, xf - 1, yf - 1), u),
            v
        );
    }

    private static float OctaveNoise(int[] perm, float x, float y,
        int oktaven, float persistenz, float lacunarity)
    {
        float wert      = 0f;
        float amplitude = 1f;
        float frequenz  = 1f;
        float maxWert   = 0f;

        for (int i = 0; i < oktaven; i++)
        {
            wert    += Noise2D(perm, x * frequenz, y * frequenz) * amplitude;
            maxWert += amplitude;
            amplitude *= persistenz;
            frequenz  *= lacunarity;
        }
        return wert / maxWert;
    }
}
