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

    private static readonly float[] LAND_SHARES = { 0.08f, 0.25f, 0.30f, 0.25f, 0.12f };

    public enum Biom : byte
    {
        Wasser  = 0,
        Strand  = 1,
        Ebene   = 2,
        Wald    = 3,
        Berg    = 4,
        Schnee  = 5
    }

    [SpacetimeDB.Table(Accessor = "WorldTile", Public = true)]
    public partial struct WorldTile
    {
        [PrimaryKey] public uint  TileId;
        public short  X;
        public short  Y;
        public byte   BiomTyp;
        public float  NoiseWert;
        public byte   KraeuterMenge;
        public byte   SpiritStones;
        public byte   Holz;
        public byte   Erz;
    }

    [SpacetimeDB.Table(Accessor = "WorldMeta", Public = true)]
    public partial struct WorldMeta
    {
        [PrimaryKey] public uint  Id;
        public bool  Generiert;
        public int   Seed;
        public short Breite;
        public short Hoehe;
    }

    [SpacetimeDB.Table(Accessor = "Player", Public = true)]
    public partial struct Player
    {
        [PrimaryKey] public ulong PlayerId;
        public string Name;
        public ulong  Qi;
        public ulong  QiMaximum;
        public byte   Stufe;
        public float  PosX;
        public float  PosY;
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
        var meta = ctx.Db.WorldMeta.Id.Find(0);
        if (meta != null && meta.Value.Generiert)
        {
            Log.Info("Welt bereits generiert – überspringe.");
            return;
        }

        Log.Info($"Starte Weltgenerierung {WELT_BREITE}x{WELT_HOEHE} mit Seed {SEED}...");
        WeltGenerieren(ctx);

        ctx.Db.WorldMeta.Insert(new WorldMeta
        {
            Id        = 0,
            Generiert = true,
            Seed      = SEED,
            Breite    = WELT_BREITE,
            Hoehe     = WELT_HOEHE
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

        ctx.Db.Player.Insert(new Player
        {
            PlayerId  = playerId,
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

        float ix = Math.Clamp(x, 0, WELT_BREITE - 1);
        float iy = Math.Clamp(y, 0, WELT_HOEHE - 1);
        var tile = ctx.Db.WorldTile.TileId.Find((uint)((int)ix + (int)iy * WELT_BREITE));
        if (tile != null && (tile.Value.BiomTyp == (byte)Biom.Wasser || tile.Value.BiomTyp == (byte)Biom.Berg))
            return;

        var p  = player.Value;
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
    public static void EditTile(ReducerContext ctx, short x, short y, byte biomTyp,
        byte kraeuterMenge, byte spiritStones, byte holz, byte erz)
    {
        var session = ctx.Db.EditorSession.Owner.Find(ctx.Sender);
        if (session == null || !session.Value.Authorized) return;

        if (x < 0 || x >= WELT_BREITE || y < 0 || y >= WELT_HOEHE) return;
        if (biomTyp > (byte)Biom.Schnee) return;

        var tile = ctx.Db.WorldTile.TileId.Find((uint)(x + y * WELT_BREITE));
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

    private static void WeltGenerieren(ReducerContext ctx)
    {
        int[] perm = BuildPerm(SEED);

        float[] rohdaten = new float[WELT_BREITE * WELT_HOEHE];
        float min = float.MaxValue, max = float.MinValue;

        for (int y = 0; y < WELT_HOEHE; y++)
        for (int x = 0; x < WELT_BREITE; x++)
        {
            float v = OctaveNoise(perm, x * SCALE, y * SCALE, OKTAVEN, PERSISTENZ, LACUNARITY);
            rohdaten[x + y * WELT_BREITE] = v;
            if (v < min) min = v;
            if (v > max) max = v;
        }

        float range = max - min;
        for (int i = 0; i < rohdaten.Length; i++)
            rohdaten[i] = (rohdaten[i] - min) / range;

        float[] sortiert = (float[])rohdaten.Clone();
        Array.Sort(sortiert);
        float wasserSchwelle = sortiert[(int)(WASSER_ANTEIL * sortiert.Length)];

        float[] landSchwellen = new float[LAND_SHARES.Length];
        float kumulativ = 0f;
        for (int i = 0; i < LAND_SHARES.Length; i++)
        {
            kumulativ += LAND_SHARES[i];
            float quantil = WASSER_ANTEIL + (1f - WASSER_ANTEIL) * kumulativ;
            int idx = (int)(quantil * (sortiert.Length - 1));
            idx = Math.Clamp(idx, 0, sortiert.Length - 1);
            landSchwellen[i] = sortiert[idx];
        }

        var rng = new Random(SEED + 1);

        for (int y = 0; y < WELT_HOEHE; y++)
        for (int x = 0; x < WELT_BREITE; x++)
        {
            float v    = rohdaten[x + y * WELT_BREITE];
            Biom  biom = BiomBestimmen(v, wasserSchwelle, landSchwellen);

            ctx.Db.WorldTile.Insert(new WorldTile
            {
                TileId         = (uint)(x + y * WELT_BREITE),
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
