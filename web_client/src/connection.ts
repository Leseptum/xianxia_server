import type { Identity } from "spacetimedb";
import { DbConnection, type ErrorContext } from "./module_bindings";
import { CONFIG } from "./config";

// sessionStorage (not localStorage): scoped per tab, not shared across tabs of
// the same origin. That means each new tab gets its own fresh identity
// automatically - the natural way to test two players at once with this
// client is to just open a second tab, rather than needing a second browser
// profile/incognito window. Reloading a tab keeps the same identity; closing
// it drops it (server-side: one Player row per identity, see Lib.cs).
const IDENTITY_STORAGE_KEY = "xianxia_stdb_identity";

interface CachedIdentity {
  identity: string;
  token: string;
}

function loadCachedToken(): string | undefined {
  const raw = sessionStorage.getItem(IDENTITY_STORAGE_KEY);
  if (!raw) return undefined;
  try {
    return (JSON.parse(raw) as CachedIdentity).token;
  } catch {
    return undefined;
  }
}

function saveCachedIdentity(identity: Identity, token: string): void {
  sessionStorage.setItem(
    IDENTITY_STORAGE_KEY,
    JSON.stringify({ identity: identity.toHexString(), token } satisfies CachedIdentity)
  );
}

export function clearCachedIdentity(): void {
  sessionStorage.removeItem(IDENTITY_STORAGE_KEY);
}

/**
 * Opens the SpacetimeDB connection. `onConnect`/`onConnectError` mirror the old
 * `stdb_client.js`'s `getOrCreateIdentity()` - but as real connect-lifecycle
 * callbacks instead of a one-shot `POST /v1/identity` + manual token caching.
 */
export function connect(
  onConnect: (connection: DbConnection) => void,
  onConnectError: (error: Error) => void
): DbConnection {
  return DbConnection.builder()
    .withUri(CONFIG.SERVER_URI)
    .withDatabaseName(CONFIG.DATABASE_NAME)
    .withToken(loadCachedToken())
    .onConnect((connection, identity, token) => {
      saveCachedIdentity(identity, token);
      onConnect(connection);
    })
    .onConnectError((_ctx: ErrorContext, error: Error) => onConnectError(error))
    .build();
}
