from app.services.settlement import Entrant, competition_ranks, quiz_passers, settle, split_proportionally


def test_fixed_threshold():
    assert quiz_passers({"a": 80, "b": 75, "c": 74}, "fixed", 75) == {"a", "b"}


def test_relative_to_best():
    assert quiz_passers({"a": 90, "b": 76, "c": 74}, "relative_to_best", 15) == {"a", "b"}


def test_top_percent_includes_ties_at_cutoff():
    scores = {"a": 90, "b": 70, "c": 70, "d": 10}
    assert quiz_passers(scores, "top_percent", 50) == {"a", "b", "c"}
    assert quiz_passers(scores, "top_percent", 0) == {"a"}  # at least one passes


def test_competition_ranks():
    assert competition_ranks({"a": 90, "b": 70, "c": 70, "d": 10}) == {"a": 1, "b": 2, "c": 2, "d": 4}


def test_split_is_exact_and_proportional():
    shares = split_proportionally(100, {"a": 90, "b": 60})
    assert shares == {"a": 60, "b": 40}
    odd = split_proportionally(10, {"a": 1, "b": 1, "c": 1})
    assert sum(odd.values()) == 10 and sorted(odd.values()) == [3, 3, 4]
    assert sum(split_proportionally(9, {"a": 0, "b": 0}).values()) == 9  # all-zero weights: equal split


def _entrants():
    return [
        Entrant("a", 90, 100, 1800),  # 30 focused minutes
        Entrant("b", 60, 100, 1200),
        Entrant("c", 40, 100, 1200),
    ]


def test_settle_losers_pay_winners_proportionally():
    result = settle(
        _entrants(), stake=100, mode="tokens", payout_target="winners",
        threshold_type="fixed", threshold_value=50, min_focus_percent=0, bonus_multiplier=1.5,
    )
    a, b, c = (result.outcomes[u] for u in "abc")
    assert (a.passed, b.passed, c.passed) == (True, True, False)
    assert a.payout == 100 + 60 and b.payout == 100 + 40  # 100 split 90:60
    assert c.payout == 0 and c.net_amount == -100
    assert a.bonus_tokens == 45 and c.bonus_tokens == 0  # floor(30 min × 1.5)
    assert sum(t.amount for t in result.transfers) == 100
    assert all(t.from_user == "c" for t in result.transfers)


def test_settle_focus_requirement_fails_people():
    entrants = [Entrant("a", 90, 40, 600), Entrant("b", 60, 90, 600)]
    result = settle(
        entrants, stake=10, mode="tokens", payout_target="winners",
        threshold_type="fixed", threshold_value=50, min_focus_percent=50, bonus_multiplier=1.5,
    )
    assert not result.outcomes["a"].passed and result.outcomes["b"].passed
    assert result.outcomes["b"].payout == 20


def test_settle_charity_and_nobody_passes():
    money = settle(
        _entrants(), stake=500, mode="money", payout_target="charity",
        threshold_type="fixed", threshold_value=50, min_focus_percent=0, bonus_multiplier=1.5,
    )
    assert money.to_charity == 500 and not money.transfers

    # winners mode and nobody passes: everyone gets their stake back, in either mode
    for mode in ("tokens", "money"):
        nobody = settle(
            _entrants(), stake=100, mode=mode, payout_target="winners",
            threshold_type="fixed", threshold_value=100, min_focus_percent=0, bonus_multiplier=1.5,
        )
        assert nobody.refunded == {"a", "b", "c"} and not nobody.transfers and nobody.to_charity == 0
        assert all(o.payout == 100 and o.net_amount == 0 and not o.passed for o in nobody.outcomes.values())

    burned = settle(
        _entrants(), stake=100, mode="tokens", payout_target="charity",
        threshold_type="fixed", threshold_value=100, min_focus_percent=0, bonus_multiplier=1.5,
    )
    assert burned.burned == 300


def test_everyone_passes_gets_stake_back():
    result = settle(
        _entrants(), stake=50, mode="tokens", payout_target="winners",
        threshold_type="fixed", threshold_value=0, min_focus_percent=0, bonus_multiplier=1.5,
    )
    assert all(o.net_amount == 0 for o in result.outcomes.values())
