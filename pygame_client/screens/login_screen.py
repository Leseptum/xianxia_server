import asyncio
import hashlib

import pygame

from models import PlayerRow
from stdb_client import StdbError, sql_escape

RETRY_ATTEMPTS = 10
RETRY_DELAY_SECONDS = 0.15


class TextField:
    def __init__(self, rect, mask=False):
        self.rect = rect
        self.text = ""
        self.mask = mask
        self.active = False

    def handle_event(self, event):
        if event.type == pygame.MOUSEBUTTONDOWN:
            self.active = self.rect.collidepoint(event.pos)
        elif event.type == pygame.KEYDOWN and self.active:
            if event.key == pygame.K_BACKSPACE:
                self.text = self.text[:-1]
            elif event.key == pygame.K_TAB:
                pass
        elif event.type == pygame.TEXTINPUT and self.active:
            self.text += event.text

    def draw(self, surface, font):
        color = (255, 255, 255) if self.active else (180, 180, 180)
        pygame.draw.rect(surface, (30, 30, 40), self.rect)
        pygame.draw.rect(surface, color, self.rect, 2)
        shown = "*" * len(self.text) if self.mask else self.text
        text_surf = font.render(shown, True, (255, 255, 255))
        surface.blit(text_surf, (self.rect.x + 8, self.rect.y + (self.rect.height - text_surf.get_height()) // 2))


class Button:
    def __init__(self, rect, label):
        self.rect = rect
        self.label = label

    def handle_click(self, pos):
        return self.rect.collidepoint(pos)

    def draw(self, surface, font):
        pygame.draw.rect(surface, (60, 90, 60), self.rect)
        pygame.draw.rect(surface, (200, 220, 200), self.rect, 2)
        text_surf = font.render(self.label, True, (255, 255, 255))
        text_rect = text_surf.get_rect(center=self.rect.center)
        surface.blit(text_surf, text_rect)


class LoginScreen:
    def __init__(self, client, width, height):
        self.client = client
        self.width = width
        self.height = height

        cx = width // 2
        self.name_field = TextField(pygame.Rect(cx - 150, 220, 300, 40))
        self.password_field = TextField(pygame.Rect(cx - 150, 280, 300, 40), mask=True)
        self.register_button = Button(pygame.Rect(cx - 150, 340, 140, 44), "Registrieren")
        self.login_button = Button(pygame.Rect(cx + 10, 340, 140, 44), "Login")

        self.name_field.active = True

        self.font = pygame.font.SysFont(None, 28)
        self.small_font = pygame.font.SysFont(None, 22)

        self.status_message = ""
        self.status_color = (200, 200, 200)
        self.working = False

        self._result_player = None
        self._done = False

    def handle_event(self, event):
        if self.working:
            return
        self.name_field.handle_event(event)
        self.password_field.handle_event(event)

        if event.type == pygame.MOUSEBUTTONDOWN:
            if self.register_button.handle_click(event.pos):
                self._start(self._do_register)
            elif self.login_button.handle_click(event.pos):
                self._start(self._do_login)

    def _start(self, target):
        name = self.name_field.text.strip()
        password = self.password_field.text
        if not name or not password:
            self.status_message = "Name und Passwort duerfen nicht leer sein."
            self.status_color = (230, 120, 120)
            return

        self.working = True
        self.status_message = "Verbinde mit Server..."
        self.status_color = (200, 200, 200)
        self._done = False
        self._result_player = None
        asyncio.create_task(target(name, password))

    async def _do_register(self, name, password):
        pw_hash = hashlib.sha256(password.encode("utf-8")).hexdigest()
        try:
            await self.client.call_reducer("register", [name, pw_hash])

            player = None
            for _ in range(RETRY_ATTEMPTS):
                rows = await self.client.sql(
                    f"SELECT * FROM player WHERE name = '{sql_escape(name)}'"
                )
                if rows:
                    player = PlayerRow.from_dict(rows[0])
                    break
                await asyncio.sleep(RETRY_DELAY_SECONDS)

            if player is None:
                self._fail("Registrierung hat kein Spielerobjekt erzeugt (Timeout).")
            else:
                self._succeed(player)
        except StdbError as exc:
            self._fail(str(exc))

    async def _do_login(self, name, password):
        pw_hash = hashlib.sha256(password.encode("utf-8")).hexdigest()
        try:
            await self.client.call_reducer("login", [name, pw_hash])

            rows = await self.client.sql(
                f"SELECT * FROM player WHERE name = '{sql_escape(name)}' "
                f"AND password_hash = '{sql_escape(pw_hash)}'"
            )
            if rows:
                self._succeed(PlayerRow.from_dict(rows[0]))
            else:
                self._fail("Login fehlgeschlagen: Name/Passwort falsch oder Spieler existiert nicht.")
        except StdbError as exc:
            self._fail(str(exc))

    def _succeed(self, player):
        self._result_player = player
        self._done = True

    def _fail(self, message):
        self.status_message = message
        self.status_color = (230, 120, 120)
        self._done = True

    def poll_result(self):
        """Call once per frame from main.py. Returns the logged-in PlayerRow once
        available, otherwise None."""
        if not self._done:
            return None
        self.working = False
        player = self._result_player
        self._done = False
        if player is not None:
            self.status_message = f"Willkommen, {player.name}!"
            self.status_color = (150, 230, 150)
        return player

    def draw(self, surface):
        surface.fill((15, 15, 25))
        title = self.font.render("Xianxia - Test-Client", True, (255, 255, 255))
        surface.blit(title, (self.width // 2 - title.get_width() // 2, 120))

        name_label = self.small_font.render("Name", True, (200, 200, 200))
        surface.blit(name_label, (self.name_field.rect.x, self.name_field.rect.y - 22))
        pw_label = self.small_font.render("Passwort", True, (200, 200, 200))
        surface.blit(pw_label, (self.password_field.rect.x, self.password_field.rect.y - 22))

        self.name_field.draw(surface, self.font)
        self.password_field.draw(surface, self.font)
        self.register_button.draw(surface, self.small_font)
        self.login_button.draw(surface, self.small_font)

        if self.working:
            msg = self.small_font.render("Bitte warten...", True, (220, 220, 120))
            surface.blit(msg, (self.width // 2 - msg.get_width() // 2, 400))
        elif self.status_message:
            msg = self.small_font.render(self.status_message, True, self.status_color)
            surface.blit(msg, (self.width // 2 - msg.get_width() // 2, 400))
