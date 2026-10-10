"""Pure settlement maths (API_SPEC §7.3, §7.8) — no database, easy to test."""

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Entrant:
    user_id: str
    quiz_score: int  # 0–100
    focus_percent: int  # 0–100
    focused_seconds: int


@dataclass
class Outcome:
    user_id: str
    passed: bool
    rank: int
    payout: int  # stake refund + winnings
    net_amount: int  # payout − stake
    bonus_tokens: int


@dataclass(frozen=True)
class Transfer:
    """Part of a loser's stake going to a winner."""

    from_user: str
    to_user: str
    amount: int


@dataclass
class Settlement:
    outcomes: dict[str, Outcome]
    transfers: list[Transfer]
    to_charity: int  # money forfeited to charity
    burned: int  # tokens forfeited to "charity" in token mode
    refunded: set[str]  # losers who got their stake back because nobody passed (winners mode)


def quiz_passers(scores: dict[str, int], threshold_type: str, threshold_value: int) -> set[str]:
    if not scores:
        return set()
    if threshold_type == "fixed":
        return {u for u, s in scores.items() if s >= threshold_value}
    if threshold_type == "relative_to_best":
        best = max(scores.values())
        return {u for u, s in scores.items() if s >= best - threshold_value}
    if threshold_type == "top_percent":
        ordered = sorted(scores.values(), reverse=True)
        k = max(1, math.ceil(len(ordered) * threshold_value / 100))
        cutoff = ordered[min(k, len(ordered)) - 1]
        return {u for u, s in scores.items() if s >= cutoff}  # ties at the cutoff also pass
    raise ValueError(f"Unknown threshold type {threshold_type}")


def competition_ranks(scores: dict[str, int]) -> dict[str, int]:
    """1 = best; equal scores share a rank (1, 2, 2, 4)."""
    ordered = sorted(scores.items(), key=lambda kv: -kv[1])
    ranks: dict[str, int] = {}
    for i, (user, score) in enumerate(ordered):
        ranks[user] = ranks[ordered[i - 1][0]] if i and score == ordered[i - 1][1] else i + 1
    return ranks


def split_proportionally(amount: int, weights: dict[str, float]) -> dict[str, int]:
    """Largest-remainder split of an integer amount; nothing is lost to rounding."""
    if amount <= 0 or not weights:
        return {u: 0 for u in weights}
    total = sum(weights.values())
    if total <= 0:
        weights = {u: 1.0 for u in weights}
        total = float(len(weights))
    exact = {u: amount * w / total for u, w in weights.items()}
    shares = {u: math.floor(v) for u, v in exact.items()}
    leftover = amount - sum(shares.values())
    # Highest remainder first; ties go to the larger weight, then a stable order
    for u in sorted(exact, key=lambda u: (-(exact[u] - shares[u]), -weights[u], u))[:leftover]:
        shares[u] += 1
    return shares


def settle(
    entrants: list[Entrant],
    *,
    stake: int,
    mode: str,
    payout_target: str,
    threshold_type: str,
    threshold_value: int,
    min_focus_percent: int,
    bonus_multiplier: float,
) -> Settlement:
    scores = {e.user_id: e.quiz_score for e in entrants}
    quiz_ok = quiz_passers(scores, threshold_type, threshold_value)
    passed = {e.user_id for e in entrants if e.user_id in quiz_ok and e.focus_percent >= min_focus_percent}
    ranks = competition_ranks(scores)
    winners = [e for e in entrants if e.user_id in passed]
    losers = [e for e in entrants if e.user_id not in passed]

    payout = {e.user_id: (stake if e.user_id in passed else 0) for e in entrants}
    transfers: list[Transfer] = []
    to_charity = 0
    burned = 0
    refunded: set[str] = set()

    for loser in losers:
        if stake <= 0:
            continue
        if payout_target == "winners":
            if winners:
                shares = split_proportionally(stake, {w.user_id: float(w.quiz_score) for w in winners})
                for winner_id, amount in shares.items():
                    if amount:
                        transfers.append(Transfer(loser.user_id, winner_id, amount))
                        payout[winner_id] += amount
            else:
                # Nobody passed: no winners to pay, so everyone gets their stake back
                payout[loser.user_id] += stake
                refunded.add(loser.user_id)
        elif mode == "money":
            to_charity += stake
        else:
            burned += stake

    outcomes = {
        e.user_id: Outcome(
            user_id=e.user_id,
            passed=e.user_id in passed,
            rank=ranks[e.user_id],
            payout=payout[e.user_id],
            net_amount=payout[e.user_id] - stake,
            bonus_tokens=math.floor(e.focused_seconds / 60 * bonus_multiplier) if e.user_id in passed else 0,
        )
        for e in entrants
    }
    return Settlement(outcomes=outcomes, transfers=transfers, to_charity=to_charity, burned=burned, refunded=refunded)
