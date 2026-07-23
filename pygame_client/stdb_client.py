import json
import os

import requests

import config


class StdbError(Exception):
    """Raised when a SpacetimeDB HTTP call fails (network, auth, or server error)."""


def sql_escape(value: str) -> str:
    """Escapes a string literal for embedding into a raw SQL query."""
    return value.replace("'", "''")


class StdbClient:
    def __init__(self, server_url=None, database=None):
        self.server_url = (server_url or config.SERVER_URL).rstrip("/")
        self.database = database or config.DATABASE_NAME
        self.identity = None
        self.token = None

    def get_or_create_identity(self):
        if os.path.exists(config.IDENTITY_FILE):
            with open(config.IDENTITY_FILE, "r") as f:
                data = json.load(f)
            self.identity = data["identity"]
            self.token = data["token"]
            return

        try:
            resp = requests.post(f"{self.server_url}/v1/identity", timeout=3)
            resp.raise_for_status()
        except requests.RequestException as exc:
            raise StdbError(f"Konnte keine Identity erzeugen: {exc}") from exc

        data = resp.json()
        self.identity = data["identity"]
        self.token = data["token"]
        with open(config.IDENTITY_FILE, "w") as f:
            json.dump(data, f)

    def _headers(self):
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    def sql(self, query):
        """Runs a SQL query, returns a list of dicts (rows of the first statement)."""
        try:
            resp = requests.post(
                f"{self.server_url}/v1/database/{self.database}/sql",
                headers=self._headers(),
                data=query,
                timeout=3,
            )
            resp.raise_for_status()
        except requests.RequestException as exc:
            raise StdbError(f"SQL-Anfrage fehlgeschlagen: {exc}") from exc

        statements = resp.json()
        if not statements:
            return []

        schema = statements[0]["schema"]
        raw_rows = statements[0]["rows"]
        columns = [el["name"]["some"] for el in schema["elements"]]

        rows = []
        for raw_row in raw_rows:
            rows.append(dict(zip(columns, raw_row)))
        return rows

    def call_reducer(self, name, args):
        try:
            resp = requests.post(
                f"{self.server_url}/v1/database/{self.database}/call/{name}",
                headers=self._headers(),
                data=json.dumps(args),
                timeout=3,
            )
            resp.raise_for_status()
        except requests.RequestException as exc:
            raise StdbError(f"Reducer '{name}' fehlgeschlagen: {exc}") from exc
