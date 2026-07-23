import threading
import time

import pygame

import config
from models import BIOM_FARBEN
from stdb_client import StdbError

HUD_HEIGHT = 90


class Button:
    def __init__(self, rect, label):
        self.rect = rect
        self.label = label
        self.enabled = True

    def handle_click(self, pos):
        return self.enabled and self.rect.collidepoint(pos)

    def draw(self, surface, font):
        color = (60, 90, 60) if self.enabled else (50, 50, 50)
        border = (200, 220, 200) if self.enabled else (100, 100, 100)
        pygame.draw.rect(surface, color, self.rect)
        pygame.draw.rect(surface, border, self.rect, 2)
        text_surf = font.render(self.label, True, (255, 255, 255))
        text_rect = text_surf.get_rect(center=self.rect.center)
        surface.blit(text_surf, text_rect)


class GameScreen:
    def __init__(self, client, poll_worker, world_grid, local_player, width, height):
        self.client = client
        self.poll_worker = poll_worker
        self.world_grid = world_grid
        self.local_player_id = local_player.player_id
        self.local_name = local_player.name

        self.pos_x = local_player.pos_x
        self.pos_y = local_player.pos_y

        self.width = width
        self.height = height

        self.font = pygame.font.SysFont(None, 24)
        self.small_font = pygame.font.SysFont(None, 20)

        self.collect_button = Button(pygame.Rect(width - 320, height - HUD_HEIGHT + 15, 140, 40), "Qi sammeln")
        self.breakthrough_button = Button(pygame.Rect(width - 160, height - HUD_HEIGHT + 15, 140, 40), "Durchbruch")

        self._last_move_sent = 0.0
        self._was_moving = False

        self.error_message = None

    def _local_snapshot(self):
        return self.poll_worker.get_players().get(self.local_player_id)

    def handle_event(self, event):
        if event.type == pygame.MOUSEBUTTONDOWN:
            if self.collect_button.handle_click(event.pos):
                self._call_async("QiSammeln", [self.local_player_id, 10])
            elif self.breakthrough_button.handle_click(event.pos):
                self._call_async("Durchbruch", [self.local_player_id])

    def _call_async(self, reducer, args):
        def run():
            try:
                self.client.call_reducer(reducer, args)
            except StdbError as exc:
                self.error_message = str(exc)
            else:
                self.poll_worker.poll_now()

        threading.Thread(target=run, daemon=True).start()

    def update(self, dt):
        keys = pygame.key.get_pressed()
        dx = 0.0
        dy = 0.0
        if keys[pygame.K_LEFT] or keys[pygame.K_a]:
            dx -= 1.0
        if keys[pygame.K_RIGHT] or keys[pygame.K_d]:
            dx += 1.0
        if keys[pygame.K_UP] or keys[pygame.K_w]:
            dy -= 1.0
        if keys[pygame.K_DOWN] or keys[pygame.K_s]:
            dy += 1.0

        moving = dx != 0.0 or dy != 0.0
        if moving:
            length = (dx * dx + dy * dy) ** 0.5
            dx, dy = dx / length, dy / length
            self.pos_x = min(max(self.pos_x + dx * config.PLAYER_SPEED * dt, 0), self.world_grid.breite - 1)
            self.pos_y = min(max(self.pos_y + dy * config.PLAYER_SPEED * dt, 0), self.world_grid.hoehe - 1)

        now = time.time()
        should_send = (
            (moving and now - self._last_move_sent > config.MOVE_UPDATE_INTERVAL_SECONDS)
            or (self._was_moving and not moving)
        )
        if should_send:
            self._last_move_sent = now
            self._call_async("UpdatePosition", [self.local_player_id, self.pos_x, self.pos_y])
        self._was_moving = moving

        snapshot = self._local_snapshot()
        if snapshot is not None:
            self.breakthrough_button.enabled = snapshot.qi >= snapshot.qi_maximum
        server_error = self.poll_worker.get_error()
        self.error_message = server_error or self.error_message

    def draw(self, surface):
        surface.fill((10, 10, 15))
        self._draw_world(surface)
        self._draw_players(surface)
        self._draw_hud(surface)
        if self.error_message:
            self._draw_error_banner(surface)

    def _camera_origin(self):
        visible_cols = self.width // config.TILE_SIZE + 2
        visible_rows = (self.height - HUD_HEIGHT) // config.TILE_SIZE + 2
        cam_x = self.pos_x - visible_cols / 2
        cam_y = self.pos_y - visible_rows / 2
        return cam_x, cam_y, visible_cols, visible_rows

    def _draw_world(self, surface):
        cam_x, cam_y, cols, rows = self._camera_origin()
        start_x = int(cam_x)
        start_y = int(cam_y)

        for j in range(rows + 1):
            world_y = start_y + j
            for i in range(cols + 1):
                world_x = start_x + i
                tile = self.world_grid.get_tile(world_x, world_y)
                if tile is None:
                    continue
                color = BIOM_FARBEN[tile["biom"]]
                screen_x = (world_x - cam_x) * config.TILE_SIZE
                screen_y = (world_y - cam_y) * config.TILE_SIZE
                pygame.draw.rect(
                    surface, color,
                    (screen_x, screen_y, config.TILE_SIZE, config.TILE_SIZE),
                )

    def _draw_players(self, surface):
        cam_x, cam_y, _, _ = self._camera_origin()
        players = self.poll_worker.get_players()

        for player_id, player in players.items():
            is_local = player_id == self.local_player_id
            world_x = self.pos_x if is_local else player.pos_x
            world_y = self.pos_y if is_local else player.pos_y

            screen_x = (world_x - cam_x) * config.TILE_SIZE + config.TILE_SIZE / 2
            screen_y = (world_y - cam_y) * config.TILE_SIZE + config.TILE_SIZE / 2

            color = (255, 210, 60) if is_local else (200, 80, 220)
            pygame.draw.circle(surface, color, (int(screen_x), int(screen_y)), config.TILE_SIZE // 2 - 2)
            pygame.draw.circle(surface, (0, 0, 0), (int(screen_x), int(screen_y)), config.TILE_SIZE // 2 - 2, 1)

            label = self.small_font.render(player.name, True, (255, 255, 255))
            surface.blit(label, (screen_x - label.get_width() / 2, screen_y - config.TILE_SIZE))

    def _draw_hud(self, surface):
        hud_rect = pygame.Rect(0, self.height - HUD_HEIGHT, self.width, HUD_HEIGHT)
        pygame.draw.rect(surface, (20, 20, 30), hud_rect)
        pygame.draw.line(surface, (80, 80, 90), (0, hud_rect.top), (self.width, hud_rect.top), 2)

        snapshot = self._local_snapshot()
        if snapshot is None:
            waiting = self.small_font.render("Warte auf Server-Daten...", True, (200, 200, 200))
            surface.blit(waiting, (20, hud_rect.top + 15))
        else:
            name_text = self.font.render(f"{snapshot.name}  -  Stufe {snapshot.stufe}", True, (255, 255, 255))
            surface.blit(name_text, (20, hud_rect.top + 8))

            bar_x, bar_y, bar_w, bar_h = 20, hud_rect.top + 40, 400, 24
            pygame.draw.rect(surface, (40, 40, 50), (bar_x, bar_y, bar_w, bar_h))
            ratio = 0 if snapshot.qi_maximum == 0 else min(snapshot.qi / snapshot.qi_maximum, 1.0)
            pygame.draw.rect(surface, (80, 160, 255), (bar_x, bar_y, int(bar_w * ratio), bar_h))
            pygame.draw.rect(surface, (200, 200, 200), (bar_x, bar_y, bar_w, bar_h), 1)

            qi_text = self.small_font.render(
                f"Qi: {snapshot.qi} / {snapshot.qi_maximum}", True, (255, 255, 255)
            )
            surface.blit(qi_text, (bar_x + bar_w + 12, bar_y + 3))

        self.collect_button.draw(surface, self.small_font)
        self.breakthrough_button.draw(surface, self.small_font)

    def _draw_error_banner(self, surface):
        banner = pygame.Rect(0, 0, self.width, 30)
        pygame.draw.rect(surface, (120, 30, 30), banner)
        text = self.small_font.render(self.error_message, True, (255, 255, 255))
        surface.blit(text, (10, 5))
