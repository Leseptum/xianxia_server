"""The one platform-dependent layer.

On desktop (CPython) HTTP goes through `requests`, run in a thread-pool
executor so it never blocks the async game loop. Under pygbag/WASM
(`sys.platform == "emscripten"`) there are no sockets and no `requests`, so
requests go through the browser's `fetch` API via pygbag's JS bridge.

Everything else in the client is platform-agnostic and only calls `request()`
and the `web_storage_*` helpers from here.
"""

import sys

IS_WEB = sys.platform == "emscripten"


class HttpError(Exception):
    """Transport-level failure (network, CORS, timeout, non-2xx handling is up
    to the caller which inspects the returned status)."""


if IS_WEB:
    import platform  # noqa: provided by pygbag inside the browser

    async def request(method, url, headers=None, body=None):
        """Returns (status_code:int, text:str). Uses the browser fetch API."""
        options = {"method": method}
        if headers:
            options["headers"] = headers
        if body is not None:
            options["body"] = body
        try:
            resp = await platform.window.fetch(url, options)
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

else:
    import asyncio

    import requests

    async def request(method, url, headers=None, body=None):
        """Returns (status_code:int, text:str). Runs blocking requests in an
        executor so the async game loop keeps rendering."""
        loop = asyncio.get_event_loop()

        def _do():
            resp = requests.request(method, url, headers=headers, data=body, timeout=5)
            return resp.status_code, resp.text

        try:
            return await loop.run_in_executor(None, _do)
        except requests.RequestException as exc:
            raise HttpError(str(exc)) from exc

    def web_storage_get(key):
        return None

    def web_storage_set(key, value):
        pass
