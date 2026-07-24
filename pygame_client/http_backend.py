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
    import json

    import platform  # noqa: provided by pygbag inside the browser

    # pygbag cannot pass a Python dict to JS fetch, nor `await` a JS promise
    # directly. The supported pattern (see pygbag/support/cross/aio/fetch.py) is
    # to inject a JS *generator* that does the fetch and yields its result, then
    # drive it with `platform.jsiter`, passing only strings across the bridge.
    # We add custom headers (Authorization) and the status code, which pygbag's
    # bundled RequestHandler does not support.
    _JS_FETCH = """
    window.xianxiaFetch = function* (url, method, headersJson, body) {
        var opts = { method: method };
        if (headersJson) { opts.headers = JSON.parse(headersJson); }
        if (body) { opts.body = body; }
        var out = 'undefined';
        fetch(new Request(url, opts))
          .then(function (r) {
              return r.text().then(function (t) {
                  out = JSON.stringify({ status: r.status, text: t });
              });
          })
          .catch(function (e) {
              out = JSON.stringify({ status: 0, text: '' + e });
          });
        while (out === 'undefined') { yield; }
        yield out;
    }
    """
    _fetch_ready = False

    def _ensure_fetch():
        global _fetch_ready
        if not _fetch_ready:
            platform.window.eval(_JS_FETCH)
            _fetch_ready = True

    async def request(method, url, headers=None, body=None):
        """Returns (status_code:int, text:str). Uses the browser fetch API via a
        pygbag JS generator (only strings cross the Python<->JS bridge)."""
        try:
            _ensure_fetch()
            headers_json = json.dumps(headers) if headers else ""
            raw = await platform.jsiter(
                platform.window.xianxiaFetch(url, method, headers_json, body or "")
            )
        except Exception as exc:  # JS/bridge errors surface as generic exceptions
            raise HttpError(f"fetch-Bruecke fehlgeschlagen: {exc}") from exc

        try:
            parsed = json.loads(str(raw))
        except (ValueError, TypeError) as exc:
            raise HttpError(f"unerwartete fetch-Antwort: {raw!r}") from exc

        if parsed.get("status", 0) == 0:
            raise HttpError(f"fetch fehlgeschlagen (evtl. CORS/Netzwerk): {parsed.get('text')}")
        return int(parsed["status"]), parsed["text"]

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
