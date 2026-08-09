"""The pluggable EV-scorer contract every pick model implements.

An EV model answers one question: given the pack in front of you and the pool
you've drafted, what is each candidate card worth? Implementations range from
the cold-start ratings heuristic to trained networks; the API and overlay only
ever see this interface, so swapping models is a registry change.
"""

from dataclasses import dataclass
from typing import List, Optional, Protocol


@dataclass
class CardScore:
    grp_id: int
    ev: Optional[float]  # higher is better; None for unknown cards
    prob: Optional[float]  # softmax over the pack, when the model provides one
    rank: int  # 1 = take this card


class EVModel(Protocol):
    model_id: str
    model_kind: str
    fallback: bool  # True when serving a stand-in (heuristic / borrowed format)

    def score_pack(
        self,
        pack_grp_ids: List[int],
        pool_grp_ids: List[int],
        pack_number: Optional[int] = None,
        pick_number: Optional[int] = None,
    ) -> List[CardScore]: ...


def rank_scores(pack_grp_ids, evs):
    """Shared helper: (grp_ids, ev floats or None) -> ranked CardScore list.

    Unknown cards (ev None) sort to the bottom but keep their identity so the
    overlay can still display them. Probabilities are softmax over known EVs.
    """
    import math

    known = [(g, e) for g, e in zip(pack_grp_ids, evs) if e is not None]
    if known:
        peak = max(e for _, e in known)
        exps = {g: math.exp(e - peak) for g, e in known}
        total = sum(exps.values())
    scores = []
    ordered = sorted(
        zip(pack_grp_ids, evs),
        key=lambda item: (item[1] is None, -(item[1] or 0.0)),
    )
    for rank, (grp_id, ev) in enumerate(ordered, start=1):
        prob = (exps[grp_id] / total) if (ev is not None and known) else None
        scores.append(CardScore(grp_id=grp_id, ev=ev, prob=prob, rank=rank))
    return scores
