import asyncio

import config
from models import PlayerRow
from stdb_client import StdbError


class PollWorker:
    """Async poller for the player table. Rendering code only ever reads
    get_players()/get_error(); it never awaits or issues HTTP calls itself.

    Runs as an asyncio task (single-threaded event loop), so the shared state
    needs no lock - reads and the writes below never interleave mid-statement."""

    def __init__(self, client):
        self.client = client
        self._players = {}
        self._error = None
        self._poll_now = asyncio.Event()
        self._stopped = False
        self._task = None

    def start(self):
        self._task = asyncio.create_task(self._run())

    def stop(self):
        self._stopped = True
        self._poll_now.set()

    def poll_now(self):
        """Trigger an immediate refresh instead of waiting for the next tick
        (call right after issuing a reducer)."""
        self._poll_now.set()

    def get_players(self):
        return self._players

    def get_error(self):
        return self._error

    async def _run(self):
        while not self._stopped:
            await self._poll_once()
            try:
                await asyncio.wait_for(self._poll_now.wait(), timeout=config.POLL_INTERVAL_SECONDS)
            except asyncio.TimeoutError:
                pass
            self._poll_now.clear()

    async def _poll_once(self):
        try:
            rows = await self.client.sql("SELECT * FROM player")
        except StdbError as exc:
            self._error = str(exc)
            return

        players = {}
        for row in rows:
            try:
                p = PlayerRow.from_dict(row)
                players[p.player_id] = p
            except (KeyError, ValueError):
                continue

        self._players = players
        self._error = None
