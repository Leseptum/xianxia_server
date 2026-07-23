import json
import os

import config
import http_backend
from http_backend import HttpError


class StdbError(Exception):
    """Raised when a SpacetimeDB HTTP call fails (network, auth, or server error)."""


def sql_escape(value: str) -> str:
    """Escapes a string literal for embedding into a raw SQL query."""
    return value.replace("'", "''")


_IDENTITY_STORAGE_KEY = "xianxia_stdb_identity"


class StdbClient:
    def __init__(self, server_url=None, database=None):
        self.server_url = (server_url or config.SERVER_URL).rstrip("/")
        self.database = database or config.DATABASE_NAME
        self.identity = None
        self.token = None

    def _load_cached_identity(self):
        if http_backend.IS_WEB:
            raw = http_backend.web_storage_get(_IDENTITY_STORAGE_KEY)
            return json.loads(raw) if raw else None
        if os.path.exists(config.IDENTITY_FILE):
            with open(config.IDENTITY_FILE, "r") as f:
                return json.load(f)
        return None

    def _save_cached_identity(self, data):
        if http_backend.IS_WEB:
            http_backend.web_storage_set(_IDENTITY_STORAGE_KEY, json.dumps(data))
        else:
            with open(config.IDENTITY_FILE, "w") as f:
                json.dump(data, f)

    async def get_or_create_identity(self):
        cached = self._load_cached_identity()
        if cached:
            self.identity = cached["identity"]
            self.token = cached["token"]
            return

        try:
            status, text = await http_backend.request("POST", f"{self.server_url}/v1/identity")
        except HttpError as exc:
            raise StdbError(f"Konnte keine Identity erzeugen: {exc}") from exc
        if status >= 300:
            raise StdbError(f"Identity-Erzeugung fehlgeschlagen (HTTP {status}): {text}")

        data = json.loads(text)
        self.identity = data["identity"]
        self.token = data["token"]
        self._save_cached_identity(data)

    def _headers(self):
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    async def sql(self, query):
        """Runs a SQL query, returns a list of dicts (rows of the first statement)."""
        try:
            status, text = await http_backend.request(
                "POST",
                f"{self.server_url}/v1/database/{self.database}/sql",
                headers=self._headers(),
                body=query,
            )
        except HttpError as exc:
            raise StdbError(f"SQL-Anfrage fehlgeschlagen: {exc}") from exc
        if status >= 300:
            raise StdbError(f"SQL-Anfrage fehlgeschlagen (HTTP {status}): {text}")

        statements = json.loads(text)
        if not statements:
            return []

        schema = statements[0]["schema"]
        raw_rows = statements[0]["rows"]
        columns = [el["name"]["some"] for el in schema["elements"]]

        rows = []
        for raw_row in raw_rows:
            rows.append(dict(zip(columns, raw_row)))
        return rows

    async def call_reducer(self, name, args):
        try:
            status, text = await http_backend.request(
                "POST",
                f"{self.server_url}/v1/database/{self.database}/call/{name}",
                headers=self._headers(),
                body=json.dumps(args),
            )
        except HttpError as exc:
            raise StdbError(f"Reducer '{name}' fehlgeschlagen: {exc}") from exc
        if status >= 300:
            raise StdbError(f"Reducer '{name}' fehlgeschlagen (HTTP {status}): {text}")
