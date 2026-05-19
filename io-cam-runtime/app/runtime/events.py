from __future__ import annotations

import asyncio
import json
from typing import Any, Callable, Awaitable

EventHandler = Callable[[dict[str, Any]], Awaitable[None]]


class EventBus:
    def __init__(self) -> None:
        self._handlers: list[EventHandler] = []

    def subscribe(self, handler: EventHandler) -> None:
        self._handlers.append(handler)

    async def emit(self, evt: str, data: dict[str, Any] | None = None) -> None:
        payload = {"evt": evt, "data": data or {}}
        for h in list(self._handlers):
            await h(payload)

    @staticmethod
    def dumps(payload: dict[str, Any]) -> str:
        return json.dumps(payload)
