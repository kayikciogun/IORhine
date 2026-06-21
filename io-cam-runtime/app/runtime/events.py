from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Callable, Awaitable

logger = logging.getLogger(__name__)

EventHandler = Callable[[dict[str, Any]], Awaitable[None]]


class EventBus:
    def __init__(self) -> None:
        self._handlers: list[EventHandler] = []

    def subscribe(self, handler: EventHandler) -> None:
        self._handlers.append(handler)

    def unsubscribe(self, handler: EventHandler) -> None:
        """Subscriber'ı çıkar; yoksa sessizce geç (idempotent)."""
        try:
            self._handlers.remove(handler)
        except ValueError:
            pass

    async def emit(self, evt: str, data: dict[str, Any] | None = None) -> None:
        # P2-A3: sequential await yerine concurrent broadcast. Tek yavaş/ölü
        # WebSocket'in tüm subscriber'ları ve job loop'u bloklamasını önler;
        # bir handler hatası sonrakileri durdurmaz (return_exceptions=True).
        payload = {"evt": evt, "data": data or {}}
        if not self._handlers:
            return
        results = await asyncio.gather(
            *(h(payload) for h in list(self._handlers)),
            return_exceptions=True,
        )
        for r in results:
            if isinstance(r, Exception):
                logger.warning("event handler failed: %s", r)

    @staticmethod
    def dumps(payload: dict[str, Any]) -> str:
        return json.dumps(payload)
