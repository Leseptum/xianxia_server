"""The one platform-dependent layer.

There are no sockets and no `requests` under Pygbag/WASM, so HTTP goes through
the browser's `fetch` API via pygbag's JS bridge.

Everything else in the client is platform-agnostic and only calls `request()`
and the `web_storage_*` helpers from here.
"""

import platform  # noqa: provided by pygbag inside the browser


class HttpError(Exception):
    """Transport-level failure (network, CORS, timeout, non-2xx handling is up
    to the caller which inspects the returned status)."""


async def request(method, url, headers=None, body=None):
    """Returns (status_code:int, text:str). Uses the browser fetch API."""
    options = {"method": method}
    if headers:
        options["headers"] = headers
    if body is not None:
        options["body"] = body
    try:
        # platform.window.fetch needs a real JS object for `options`, not a
        # raw Python dict - the bridge can't auto-convert it. platform.ffi()
        # is pygbag's own documented workaround (JSON round-trip through
        # window.JSON.parse); see pygbag/support/cross/aio/filelike.py.
        resp = await platform.window.fetch(url, platform.ffi(options))
        status = int(resp.status)
        text = await resp.text()
    except Exception as exc:  # JS errors surface as generic exceptions here
        raise HttpError(f"fetch fehlgeschlagen (evtl. CORS/Netzwerk): {exc}") from exc
    return status, str(text)


def web_storage_get(key):
    try:
        val = platform.window.localStorage.getItem(key)
    except Exception:
        return None
    if val is None:
        return None
    val = str(val)
    return val if val and val != "null" else None


def web_storage_set(key, value):
    try:
        platform.window.localStorage.setItem(key, value)
    except Exception:
        pass
