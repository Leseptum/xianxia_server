import threading
import time

import config
from models import PlayerRow
from stdb_client import StdbError


class PollWorker:
    """Background poller for the Player table. Rendering code only ever reads
    get_players()/get_error() - it never issues blocking HTTP calls itself."""

    def __init__(self, client):
        self.client = client
        self._lock = threading.Lock()
        self._players = {}
        self._error = None
        self._poll_now = threading.Event()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self):
        self._thread.start()

    def stop(self):
        self._stop.set()
        self._poll_now.set()

    def poll_now(self):
        """Call right after issuing a reducer so the UI updates without waiting
        for the next scheduled poll tick."""
        self._poll_now.set()

    def get_players(self):
        with self._lock:
            return dict(self._players)

    def get_error(self):
        with self._lock:
            return self._error

    def _run(self):
        while not self._stop.is_set():
            self._poll_once()
            self._poll_now.wait(timeout=config.POLL_INTERVAL_SECONDS)
            self._poll_now.clear()

    def _poll_once(self):
        try:
            rows = self.client.sql("SELECT * FROM Player")
        except StdbError as exc:
            with self._lock:
                self._error = str(exc)
            return

        players = {}
        for row in rows:
            try:
                p = PlayerRow.from_dict(row)
                players[p.player_id] = p
            except (KeyError, ValueError):
                continue

        with self._lock:
            self._players = players
            self._error = None
