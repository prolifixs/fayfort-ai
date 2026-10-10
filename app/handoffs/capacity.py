from __future__ import annotations

import math
from typing import Any


def _nearest_rank(samples: list[float], percentile: float) -> float:
    ordered = sorted(samples)
    index = max(0, math.ceil(percentile * len(ordered)) - 1)
    return ordered[index]


def estimate_handoff_wait(queue_position: int, available_slots: int, samples: list[float]) -> dict[str, Any]:
    valid: list[float] = []
    for value in samples:
        try:
            numeric = float(value)
        except (TypeError, ValueError, OverflowError):
            continue
        if math.isfinite(numeric) and 0 <= numeric <= 24 * 60:
            valid.append(numeric)
    if queue_position < 1:
        return {"status": "unavailable", "reason": "Queue position is not known."}
    if available_slots < 1:
        return {"status": "unavailable", "reason": "No agent has an active availability window and open capacity."}
    if len(valid) < 5:
        return {"status": "unavailable", "reason": "At least five recent human first-response samples are needed."}
    waves = math.ceil(queue_position / available_slots)
    low = _nearest_rank(valid, 0.5) * waves
    high = _nearest_rank(valid, 0.9) * waves
    return {
        "status": "estimated",
        "lower_minutes": max(0, math.floor(low)),
        "upper_minutes": max(0, math.ceil(max(low, high))),
        "sample_size": len(valid),
        "availability_slots": available_slots,
    }
