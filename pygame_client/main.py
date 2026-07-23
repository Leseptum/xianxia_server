import asyncio

import pygame

import http_backend
import world_cache
from poll_worker import PollWorker
from screens.game_screen import GameScreen
from screens.login_screen import LoginScreen
from stdb_client import StdbClient, StdbError

WIDTH, HEIGHT = 960, 720


async def main():
    pygame.init()
    pygame.display.set_caption("Xianxia - Pygame Test-Client")
    screen = pygame.display.set_mode((WIDTH, HEIGHT))
    clock = pygame.time.Clock()
    status_font = pygame.font.SysFont(None, 28)

    client = StdbClient()
    try:
        await client.get_or_create_identity()
    except StdbError as exc:
        await _show_fatal_error(screen, clock, status_font, str(exc))
        return

    state = "login"
    login_screen = LoginScreen(client, WIDTH, HEIGHT)
    game_screen = None
    poll_worker = None
    loading = {"status": "Lade Welt..."}

    async def load_world_and_start(local_player):
        try:
            grid = await world_cache.load_world(client)
            loading["grid"] = grid
            loading["player"] = local_player
        except (StdbError, RuntimeError) as exc:
            loading["error"] = str(exc)

    running = True
    while running:
        clock.tick(60)

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            elif state == "login":
                login_screen.handle_event(event)
            elif state == "game" and game_screen is not None:
                game_screen.handle_event(event)

        if state == "login":
            player = login_screen.poll_result()
            if player is not None:
                state = "loading_world"
                asyncio.create_task(load_world_and_start(player))
            login_screen.draw(screen)

        elif state == "loading_world":
            screen.fill((15, 15, 25))
            if "error" in loading:
                msg = status_font.render(f"Fehler: {loading['error']}", True, (230, 120, 120))
            else:
                msg = status_font.render(loading.get("status", "Lade..."), True, (220, 220, 220))
            screen.blit(msg, (WIDTH // 2 - msg.get_width() // 2, HEIGHT // 2))

            if "grid" in loading:
                poll_worker = PollWorker(client)
                poll_worker.start()
                game_screen = GameScreen(client, poll_worker, loading["grid"], loading["player"], WIDTH, HEIGHT)
                state = "game"

        elif state == "game" and game_screen is not None:
            game_screen.update(1 / 60)
            game_screen.draw(screen)

        pygame.display.flip()
        await asyncio.sleep(0)

    if poll_worker is not None:
        poll_worker.stop()
    if not http_backend.IS_WEB:
        pygame.quit()


async def _show_fatal_error(screen, clock, font, message):
    running = True
    while running:
        clock.tick(30)
        for event in pygame.event.get():
            if event.type == pygame.QUIT or event.type == pygame.KEYDOWN:
                running = False
        screen.fill((20, 10, 10))
        msg1 = font.render("Verbindung zum Server fehlgeschlagen:", True, (255, 200, 200))
        msg2 = font.render(message, True, (255, 150, 150))
        screen.blit(msg1, (40, HEIGHT // 2 - 30))
        screen.blit(msg2, (40, HEIGHT // 2 + 10))
        pygame.display.flip()
        await asyncio.sleep(0)


asyncio.run(main())
