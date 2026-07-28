// Thin wrapper over SpacetimeDB's HTTP API. No WebSocket subscriptions -
// callers poll via sql() on their own schedule.

// sessionStorage (not localStorage): scoped per tab, not shared across tabs
// of the same origin. That means each new tab gets its own fresh identity
// automatically - the natural way to test two players at once with this
// client is to just open a second tab, rather than needing a second browser
// profile/incognito window. Reloading a tab keeps the same identity; closing
// it drops it (server-side: one Player row per identity, see Lib.cs).
const IDENTITY_STORAGE_KEY = "xianxia_stdb_identity";

class StdbError extends Error {}

function sqlEscape(value) {
  return value.replace(/'/g, "''");
}

class StdbClient {
  constructor(serverUrl, database) {
    this.serverUrl = serverUrl.replace(/\/+$/, "");
    this.database = database;
    this.identity = null;
    this.token = null;
  }

  _loadCachedIdentity() {
    const raw = sessionStorage.getItem(IDENTITY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  _saveCachedIdentity(data) {
    sessionStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(data));
  }

  async getOrCreateIdentity() {
    const cached = this._loadCachedIdentity();
    if (cached) {
      this.identity = cached.identity;
      this.token = cached.token;
      return;
    }

    let resp;
    try {
      resp = await fetch(`${this.serverUrl}/v1/identity`, { method: "POST" });
    } catch (exc) {
      throw new StdbError(`Konnte keine Identity erzeugen (Netzwerk/CORS): ${exc}`);
    }
    if (!resp.ok) {
      throw new StdbError(`Identity-Erzeugung fehlgeschlagen (HTTP ${resp.status}): ${await resp.text()}`);
    }

    const data = await resp.json();
    this.identity = data.identity;
    this.token = data.token;
    this._saveCachedIdentity(data);
  }

  _headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
  }

  /** Runs a SQL query, returns an array of row objects (first statement only). */
  async sql(query) {
    let resp;
    try {
      resp = await fetch(`${this.serverUrl}/v1/database/${this.database}/sql`, {
        method: "POST",
        headers: this._headers(),
        body: query,
      });
    } catch (exc) {
      throw new StdbError(`SQL-Anfrage fehlgeschlagen (Netzwerk/CORS): ${exc}`);
    }
    if (!resp.ok) {
      throw new StdbError(`SQL-Anfrage fehlgeschlagen (HTTP ${resp.status}): ${await resp.text()}`);
    }

    const statements = await resp.json();
    if (!statements || statements.length === 0) return [];

    const { schema, rows: rawRows } = statements[0];
    const columns = schema.elements.map((el) => el.name.some);

    return rawRows.map((rawRow) => {
      const row = {};
      columns.forEach((col, i) => (row[col] = rawRow[i]));
      return row;
    });
  }

  async callReducer(name, args) {
    let resp;
    try {
      resp = await fetch(`${this.serverUrl}/v1/database/${this.database}/call/${name}`, {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify(args),
      });
    } catch (exc) {
      throw new StdbError(`Reducer '${name}' fehlgeschlagen (Netzwerk/CORS): ${exc}`);
    }
    if (!resp.ok) {
      throw new StdbError(`Reducer '${name}' fehlgeschlagen (HTTP ${resp.status}): ${await resp.text()}`);
    }
  }
}
