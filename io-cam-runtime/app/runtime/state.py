from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class JobPhase(str, Enum):
    IDLE = "idle"
    PREPARING = "preparing"
    READY = "ready"
    RUNNING = "running"
    PAUSED = "paused"
    STOPPING = "stopping"
    COMPLETE = "complete"
    ERROR = "error"


@dataclass
class JobState:
    phase: JobPhase = JobPhase.IDLE
    index: int = 0
    total: int = 0
    message: str | None = None
    job_id: str | None = None

    def to_status(self) -> dict[str, Any]:
        return {
            "phase": self.phase.value,
            "index": self.index,
            "total": self.total,
            "message": self.message,
            "job_id": self.job_id,
        }


@dataclass
class RuntimeContext:
    state: JobState = field(default_factory=JobState)
    pause_event: asyncio.Event = field(default_factory=asyncio.Event)
    stop_requested: bool = False

    def __post_init__(self) -> None:
        self.pause_event.set()
