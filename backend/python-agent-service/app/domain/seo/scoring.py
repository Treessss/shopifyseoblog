from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable


@dataclass(slots=True)
class ContentScoreBreakdown:
    hook_power: int = 0
    voice_authenticity: int = 0
    value_density: int = 0
    engagement_potential: int = 0
    data_foundation: int = 0
    actionability: int = 0
    roi_clarity: int = 0
    risk_assessment: int = 0
    penalties: list[str] = field(default_factory=list)

    def total(self) -> int:
        return max(
            0,
            min(
                100,
                self.hook_power
                + self.voice_authenticity
                + self.value_density
                + self.engagement_potential
                + self.data_foundation
                + self.actionability
                + self.roi_clarity
                + self.risk_assessment
                - self.penalty_points(),
            ),
        )

    def penalty_points(self) -> int:
        return len(self.penalties) * 3


@dataclass(slots=True)
class ContentQualityAssessment:
    score: int
    publish_ready: bool
    index_ready: bool
    next_step: str
    breakdown: ContentScoreBreakdown
    notes: list[str]


def clamp_score(value: int) -> int:
    return max(0, min(100, value))


def score_from_signals(values: Iterable[int]) -> int:
    items = list(values)
    if not items:
        return 0
    return clamp_score(round(sum(items) / len(items)))

