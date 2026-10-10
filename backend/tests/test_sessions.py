"""Full session lifecycle: lobby → studying → extension vote → quiz → grading → review → settled."""

from datetime import timedelta

import pytest

from app import config
from app.models.charity_seed import seed_charities  # noqa: F401  (used in fixture)
from app.models.session import QuizAnswer, StudySession
from app.services import ai, engine, quiz
from app.timeutil import utc_now

TOKENS = {"mode": "tokens", "payoutTarget": "winners"}


def config_body(**overrides):
    body = {"title": "Bio revision", **TOKENS, "stakeAmount": 50, "studyMinutes": 30, "quizQuestionCount": 5,
            "maxExtensions": 1, "extensionMinutes": 10}
    body.update(overrides)
    return body


FAKE_QUESTIONS = [
    ai.GeneratedQuestion("multiple_choice", f"Question {i}?", [{"id": c, "text": f"opt {c}"} for c in "abcd"], "a", None)
    for i in range(4)
] + [ai.GeneratedQuestion("short_answer", "What do ribosomes make?", None, None, "Proteins")]


@pytest.fixture(autouse=True)
def fake_ai(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setattr(ai, "generate_quiz", lambda text, count: FAKE_QUESTIONS[:count])
    monkeypatch.setattr(
        ai, "grade_short_answers",
        lambda items: {i["id"]: ai.Grade(1.0 if "protein" in i["answer"].lower() else 0.0, "ok") for i in items},
    )


@pytest.fixture
def crew(client, db_session, new_user):
    """alice (host) and bob in a group, plus a charity."""
    with db_session() as db:
        seed_charities(db)
        db.commit()
    alice, alice_me = new_user("alice")
    bob, bob_me = new_user("bob")
    g = client.post("/api/groups", json={"name": "Bio"}, headers=alice).json()
    client.post("/api/groups/join", json={"inviteCode": g["inviteCode"]}, headers=bob)
    return {"group": g["id"], "alice": alice, "bob": bob, "alice_id": alice_me["id"], "bob_id": bob_me["id"]}


def create(client, crew, **overrides):
    r = client.post(f"/api/groups/{crew['group']}/sessions", json=config_body(**overrides), headers=crew["alice"])
    assert r.status_code == 201, r.text
    return r.json()["id"]


def ready_lobby(client, crew, sid, vote=("fixed", 50)):
    client.post(f"/api/sessions/{sid}/join", headers=crew["bob"])
    m = client.post(f"/api/sessions/{sid}/materials/text", json={"title": "Notes", "text": "Mitochondria are the powerhouse of the cell."}, headers=crew["alice"]).json()
    for who in ("alice", "bob"):
        client.post(f"/api/sessions/{sid}/materials/{m['id']}/approve", json={"approved": True}, headers=crew[who])
        client.put(f"/api/sessions/{sid}/assessment-vote", json={"thresholdType": vote[0], "thresholdValue": vote[1]}, headers=crew[who])
        r = client.post(f"/api/sessions/{sid}/ready", json={"isReady": True}, headers=crew[who])
        assert r.status_code == 200, r.text


def get(client, crew, sid, who="alice"):
    return client.get(f"/api/sessions/{sid}", headers=crew[who]).json()


def shift(db_session, sid, **fields):
    """Move session timestamps into the past to simulate time passing."""
    with db_session() as db:
        s = db.get(StudySession, sid)
        for k, v in fields.items():
            setattr(s, k, v)
        db.commit()


def end_study_after(db_session, sid, minutes):
    """Pretend the study block ran for `minutes` with everyone in their current focus state."""
    from app.models.session import Participant

    now = utc_now()
    with db_session() as db:
        s = db.get(StudySession, sid)
        s.study_ends_at = now
        for p in db.query(Participant).filter_by(session_id=sid):
            p.focus_since = now - timedelta(minutes=minutes)
        db.commit()


def tokens(client, headers):
    return client.get("/api/me/stats", headers=headers).json()["tokens"]


# ───────── Lobby ─────────


def test_create_and_view(client, crew):
    sid = create(client, crew)
    s = get(client, crew, sid)
    assert s["status"] == "lobby"
    assert s["config"]["stakeAmount"] == 50
    assert s["me"] == {"isHost": True, "isParticipant": True, "isReady": False, "quizProgress": None, "reviewDone": False, "wantsToFinish": False}
    assert [p["user"]["username"] for p in s["participants"]] == ["alice"]
    group = client.get(f"/api/groups/{crew['group']}", headers=crew["bob"]).json()
    assert group["activeSession"] == {"id": sid, "status": "lobby"}

    # one active session per group
    again = client.post(f"/api/groups/{crew['group']}/sessions", json=config_body(), headers=crew["bob"])
    assert again.status_code == 409


def test_non_member_cannot_see(client, crew, new_user):
    sid = create(client, crew)
    outsider, _ = new_user("eve")
    assert client.get(f"/api/sessions/{sid}", headers=outsider).status_code == 404


def test_money_mode_rules(client, crew, new_user):
    charities = client.get("/api/charities").json()["items"]
    assert len(charities) >= 3
    # a charity is only needed when failed stakes go to charity
    no_charity = client.post(f"/api/groups/{crew['group']}/sessions", json=config_body(mode="money", stakeAmount=500, payoutTarget="charity"), headers=crew["alice"])
    assert no_charity.status_code == 422
    sid = create(client, crew, mode="money", stakeAmount=500, charityId=charities[0]["id"])
    s = get(client, crew, sid)
    assert s["charity"]["name"] == charities[0]["name"]

    # a teen in the group can't join a money session
    teen, _ = new_user("teen", date_of_birth=f"{utc_now().year - 15}-01-01")
    code = client.get(f"/api/groups/{crew['group']}", headers=crew["alice"]).json()["inviteCode"]
    client.post("/api/groups/join", json={"inviteCode": code}, headers=teen)
    r = client.post(f"/api/sessions/{sid}/join", headers=teen)
    assert r.status_code == 403 and r.json()["error"]["code"] == "age_restricted"

    # and nobody has coins yet
    client.put(f"/api/sessions/{sid}/assessment-vote", json={"thresholdType": "fixed", "thresholdValue": 50}, headers=crew["alice"])
    client.post(f"/api/sessions/{sid}/materials/text", json={"title": "N", "text": "Some study notes here."}, headers=crew["alice"])
    r = client.post(f"/api/sessions/{sid}/ready", json={"isReady": True}, headers=crew["alice"])
    assert r.json()["error"]["code"] == "insufficient_balance"


def test_ready_requirements_and_unready_on_change(client, crew):
    sid = create(client, crew)
    client.post(f"/api/sessions/{sid}/join", headers=crew["bob"])
    r = client.post(f"/api/sessions/{sid}/ready", json={"isReady": True}, headers=crew["bob"])
    assert r.status_code == 409 and "Vote" in r.json()["error"]["message"]

    ready_lobby(client, crew, sid)
    assert all(p["isReady"] for p in get(client, crew, sid)["participants"])

    # new material un-readies everyone, and needs everyone's approval again
    client.post(f"/api/sessions/{sid}/materials/text", json={"title": "More", "text": "Ribosomes make proteins."}, headers=crew["bob"])
    s = get(client, crew, sid)
    assert not any(p["isReady"] for p in s["participants"])
    assert [m["approvedByAll"] for m in s["materials"]] == [True, False]
    r = client.post(f"/api/sessions/{sid}/start", headers=crew["alice"])
    assert r.status_code == 409


def test_config_changes_are_host_only_and_validated(client, crew):
    sid = create(client, crew)
    client.post(f"/api/sessions/{sid}/join", headers=crew["bob"])
    assert client.patch(f"/api/sessions/{sid}", json={"studyMinutes": 45}, headers=crew["bob"]).status_code == 403
    r = client.patch(f"/api/sessions/{sid}", json={"studyMinutes": 45}, headers=crew["alice"])
    assert r.status_code == 200 and r.json()["config"]["studyMinutes"] == 45
    bad = client.patch(f"/api/sessions/{sid}", json={"studyMinutes": 1}, headers=crew["alice"])
    assert bad.status_code == 422


def test_file_upload_and_extraction(client, crew):
    sid = create(client, crew)
    r = client.post(
        f"/api/sessions/{sid}/materials",
        files={"file": ("notes.md", b"# Cells\nMitochondria produce ATP for the cell.", "text/markdown")},
        headers=crew["alice"],
    )
    assert r.status_code == 201, r.text
    m = r.json()
    assert m["textStatus"] == "ready" and m["approvedBy"] == [crew["alice_id"]]
    content = client.get(f"/api/sessions/{sid}/materials/{m['id']}/content", headers=crew["alice"])
    assert b"Mitochondria" in content.content

    bad = client.post(f"/api/sessions/{sid}/materials", files={"file": ("x.exe", b"MZ", "application/octet-stream")}, headers=crew["alice"])
    assert bad.status_code == 415
    unreadable = client.post(f"/api/sessions/{sid}/materials", files={"file": ("tiny.txt", b"hi", "text/plain")}, headers=crew["alice"])
    assert unreadable.json()["textStatus"] == "failed"


def test_leave_passes_host_and_last_out_cancels(client, crew):
    sid = create(client, crew)
    client.post(f"/api/sessions/{sid}/join", headers=crew["bob"])
    assert client.post(f"/api/sessions/{sid}/leave", headers=crew["alice"]).status_code == 204
    assert get(client, crew, sid, "bob")["host"]["username"] == "bob"
    client.post(f"/api/sessions/{sid}/leave", headers=crew["bob"])
    assert get(client, crew, sid, "bob")["status"] == "cancelled"


# ───────── Full game ─────────


def answer_all(client, crew, sid, who, correct_mc: int, short: str, db_session=None):
    """Answer the 5 questions: first `correct_mc` multiple-choice right, rest wrong, then the short answer."""
    current = client.get(f"/api/sessions/{sid}/quiz/current", headers=crew[who]).json()
    mc_seen = 0
    while current["question"]:
        q = current["question"]
        assert q["timeLimitSeconds"] == 20
        if q["type"] == "multiple_choice":
            body = {"questionId": q["id"], "optionId": "a" if mc_seen < correct_mc else "b"}
            mc_seen += 1
        else:
            body = {"questionId": q["id"], "text": short}
        r = client.post(f"/api/sessions/{sid}/quiz/answers", json=body, headers=crew[who])
        assert r.status_code == 200, r.text
        current = r.json()
    return current


def test_full_session_settles_and_pays(client, crew, db_session):
    sid = create(client, crew)
    ready_lobby(client, crew, sid)
    assert tokens(client, crew["alice"]) == 100

    s = client.post(f"/api/sessions/{sid}/start", headers=crew["alice"]).json()
    assert s["status"] == "studying"
    assert s["assessment"]["decided"] == {"thresholdType": "fixed", "thresholdValue": 50}
    assert tokens(client, crew["alice"]) == 50 and tokens(client, crew["bob"]) == 50  # stakes locked

    # shared to-do
    todo = client.post(f"/api/sessions/{sid}/todos", json={"title": "Read chapter 3"}, headers=crew["bob"]).json()
    done = client.patch(f"/api/sessions/{sid}/todos/{todo['id']}", json={"isDone": True}, headers=crew["alice"]).json()
    assert done["isDone"] and done["completedBy"]["username"] == "alice"

    # focus isn't tracked while studying: bob leaving the app doesn't change anything
    client.post(f"/api/sessions/{sid}/focus-events", json={"state": "away"}, headers=crew["bob"])
    bob_p = next(p for p in get(client, crew, sid)["participants"] if p["user"]["username"] == "bob")
    assert bob_p["focus"]["state"] == "focused"

    # 30 minutes later the timer ends → extension vote (max 1); bob says no → 2 people need both → quiz
    end_study_after(db_session, sid, 30)
    engine.tick()
    assert get(client, crew, sid)["status"] == "extension_vote"
    client.post(f"/api/sessions/{sid}/extension-vote", json={"extend": True}, headers=crew["alice"])
    s = client.post(f"/api/sessions/{sid}/extension-vote", json={"extend": False}, headers=crew["bob"]).json()
    assert s["status"] == "generating_quiz"
    assert s["extension"]["lastOutcome"] == {"extended": False, "decidedBy": "vote"}

    quiz.generate_quiz_job(sid)
    s = get(client, crew, sid)
    assert s["status"] == "quiz" and s["me"]["quizProgress"] == {"answered": 0, "total": 5, "flagged": 0}

    answer_all(client, crew, sid, "alice", correct_mc=4, short="Proteins")
    assert get(client, crew, sid)["status"] == "quiz"  # bob still going
    final = answer_all(client, crew, sid, "bob", correct_mc=1, short="no idea")
    assert final["question"] is None
    assert get(client, crew, sid)["status"] == "grading"

    quiz.grade_job(sid)
    s = get(client, crew, sid)
    assert s["status"] == "review"
    results = {p["user"]["username"]: p["result"] for p in s["participants"]}
    assert results["alice"]["quizScore"] == 100 and results["alice"]["passed"] and not results["alice"]["final"]
    assert results["bob"]["quizScore"] == 20 and not results["bob"]["passed"]

    review = client.get(f"/api/sessions/{sid}/review", headers=crew["bob"]).json()
    short_q = next(q for q in review["questions"] if q["question"]["type"] == "short_answer")
    assert short_q["modelAnswer"] == "Proteins" and short_q["myAnswer"]["text"] == "no idea" and short_q["myScore"] == 0

    for who in ("alice", "bob"):
        assert client.post(f"/api/sessions/{sid}/review/done", headers=crew[who]).status_code == 204
    s = get(client, crew, sid)
    assert s["status"] == "settled"
    alice_r = next(p for p in s["participants"] if p["user"]["username"] == "alice")["result"]
    assert alice_r["final"] and alice_r["payout"] == 100 and alice_r["netAmount"] == 50
    # alice: 50 left + 50 back + 50 won + 45 bonus (30 focused min × 1.5)
    assert tokens(client, crew["alice"]) == 50 + 50 + 50 + 45
    assert tokens(client, crew["bob"]) == 50

    stats = client.get("/api/me/stats", headers=crew["alice"]).json()
    assert stats["sessionsCompleted"] == 1 and stats["wins"] == 1 and stats["winRate"] == 100
    assert stats["totalStudyMinutes"] == 30 and stats["currentStreakDays"] == 1
    group = client.get(f"/api/groups/{crew['group']}", headers=crew["alice"]).json()
    assert group["activeSession"] is None and group["stats"]["sessionsCompleted"] == 1
    history = client.get("/api/sessions?scope=past", headers=crew["bob"]).json()["items"]
    assert history[0]["myResult"] == {"passed": False, "netAmount": -50}


def test_extension_granted(client, crew, db_session):
    sid = create(client, crew)
    ready_lobby(client, crew, sid)
    client.post(f"/api/sessions/{sid}/start", headers=crew["alice"])
    shift(db_session, sid, study_ends_at=utc_now() - timedelta(seconds=1))
    engine.tick()
    client.post(f"/api/sessions/{sid}/extension-vote", json={"extend": True}, headers=crew["alice"])
    again = client.post(f"/api/sessions/{sid}/extension-vote", json={"extend": True}, headers=crew["alice"])
    assert again.status_code == 409 and again.json()["error"]["code"] == "already_voted"
    s = client.post(f"/api/sessions/{sid}/extension-vote", json={"extend": True}, headers=crew["bob"]).json()
    assert s["status"] == "studying" and s["extension"]["used"] == 1

    # max 1 extension: next timer end goes straight to the quiz
    shift(db_session, sid, study_ends_at=utc_now() - timedelta(seconds=1))
    engine.tick()
    assert get(client, crew, sid)["status"] == "generating_quiz"


def test_extension_vote_times_out_as_no(client, crew, db_session):
    sid = create(client, crew)
    ready_lobby(client, crew, sid)
    client.post(f"/api/sessions/{sid}/start", headers=crew["alice"])
    shift(db_session, sid, study_ends_at=utc_now() - timedelta(seconds=1))
    engine.tick()
    client.post(f"/api/sessions/{sid}/extension-vote", json={"extend": True}, headers=crew["alice"])
    shift(db_session, sid, extension_vote_ends_at=utc_now() - timedelta(seconds=1))
    engine.tick()
    assert get(client, crew, sid)["status"] == "generating_quiz"


def _to_quiz(client, crew, db_session, sid):
    ready_lobby(client, crew, sid)
    client.post(f"/api/sessions/{sid}/start", headers=crew["alice"])
    shift(db_session, sid, study_ends_at=utc_now() - timedelta(seconds=1), max_extensions=0)
    engine.tick()
    quiz.generate_quiz_job(sid)
    assert get(client, crew, sid)["status"] == "quiz"


def test_question_timer_and_anticheat_flag(client, crew, db_session):
    sid = create(client, crew)
    _to_quiz(client, crew, db_session, sid)

    q1 = client.get(f"/api/sessions/{sid}/quiz/current", headers=crew["alice"]).json()
    assert q1["number"] == 1 and q1["deadline"]
    # leaving the app while the question is open flags it
    client.post(f"/api/sessions/{sid}/focus-events", json={"state": "away"}, headers=crew["alice"])
    r = client.post(f"/api/sessions/{sid}/quiz/answers", json={"questionId": q1["question"]["id"], "optionId": "a"}, headers=crew["alice"])
    assert r.json()["number"] == 2
    with db_session() as db:
        a = db.query(QuizAnswer).filter_by(question_id=q1["question"]["id"]).one()
        assert a.flagged and a.score == 0.0

    # too slow on question 2
    q2 = r.json()["question"]
    with db_session() as db:
        a = db.query(QuizAnswer).filter_by(question_id=q2["id"], user_id=crew["alice_id"]).one()
        a.deadline = utc_now() - timedelta(seconds=5)
        db.commit()
    late = client.post(f"/api/sessions/{sid}/quiz/answers", json={"questionId": q2["id"], "optionId": "a"}, headers=crew["alice"])
    assert late.status_code == 409 and late.json()["error"]["code"] == "question_expired"
    nxt = client.get(f"/api/sessions/{sid}/quiz/current", headers=crew["alice"]).json()
    assert nxt["number"] == 3
    progress = get(client, crew, sid)["me"]["quizProgress"]
    assert progress == {"answered": 2, "total": 5, "flagged": 1}


def test_quiz_hard_cutoff(client, crew, db_session):
    sid = create(client, crew)
    _to_quiz(client, crew, db_session, sid)
    answer_all(client, crew, sid, "alice", correct_mc=4, short="proteins")
    shift(db_session, sid, quiz_ends_at=utc_now() - timedelta(seconds=1))
    engine.tick()
    assert get(client, crew, sid)["status"] == "grading"
    quiz.grade_job(sid)
    bob = next(p for p in get(client, crew, sid)["participants"] if p["user"]["username"] == "bob")
    assert bob["result"]["quizScore"] == 0


def test_dispute_nullifies_with_two_thirds(client, crew, db_session):
    sid = create(client, crew)
    _to_quiz(client, crew, db_session, sid)
    answer_all(client, crew, sid, "alice", correct_mc=3, short="proteins")  # 4/5 = 80
    answer_all(client, crew, sid, "bob", correct_mc=3, short="proteins")
    quiz.grade_job(sid)

    review = client.get(f"/api/sessions/{sid}/review", headers=crew["alice"]).json()
    wrong = next(q for q in review["questions"] if q["myScore"] == 0)
    d = client.post(f"/api/sessions/{sid}/disputes", json={"questionId": wrong["question"]["id"], "reason": "Ambiguous"}, headers=crew["alice"]).json()
    assert d["dropVotes"] == 1 and d["votesNeeded"] == 2 and d["outcome"] == "open"
    dup = client.post(f"/api/sessions/{sid}/disputes", json={"questionId": wrong["question"]["id"], "reason": "x"}, headers=crew["bob"])
    assert dup.status_code == 409
    d = client.post(f"/api/sessions/{sid}/disputes/{d['id']}/vote", json={"vote": "drop"}, headers=crew["bob"]).json()
    assert d["outcome"] == "nullified"
    scores = {p["user"]["username"]: p["result"]["quizScore"] for p in get(client, crew, sid)["participants"]}
    assert scores == {"alice": 100, "bob": 100}  # wrong question no longer counts

    # review window ends → settled
    shift(db_session, sid, review_ends_at=utc_now() - timedelta(seconds=1))
    engine.tick()
    assert get(client, crew, sid)["status"] == "settled"


def test_generation_failure_refunds(client, crew, db_session, monkeypatch):
    def broken(text, count):
        raise ai.AiError("model down")

    monkeypatch.setattr(ai, "generate_quiz", broken)
    sid = create(client, crew)
    ready_lobby(client, crew, sid)
    client.post(f"/api/sessions/{sid}/start", headers=crew["alice"])
    assert tokens(client, crew["bob"]) == 50
    shift(db_session, sid, study_ends_at=utc_now() - timedelta(seconds=1), max_extensions=0)
    engine.tick()
    quiz.generate_quiz_job(sid)
    s = get(client, crew, sid)
    assert s["status"] == "cancelled" and "refunded" in s["cancelReason"]
    assert tokens(client, crew["bob"]) == 100


def test_session_socket_snapshot_and_focus(client, crew):
    sid = create(client, crew)
    token = crew["alice"]["Authorization"].removeprefix("Bearer ")
    with client.websocket_connect(f"/ws/sessions/{sid}?token={token}") as ws:
        first = ws.receive_json()
        assert first["type"] == "session.updated" and first["data"]["id"] == sid
        assert first["data"]["participants"][0]["presence"] == "online"
        assert ws.receive_json()["type"] == "session.todos"
        ws.send_json({"type": "focus.update", "data": {"state": "away"}})
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong", "data": {}}


# ───────── Finish early ─────────


def test_finish_early_needs_everyone(client, crew, db_session):
    sid = create(client, crew)
    ready_lobby(client, crew, sid)
    assert client.post(f"/api/sessions/{sid}/finish-early", json={"wantsToFinish": True}, headers=crew["alice"]).status_code == 409  # lobby
    client.post(f"/api/sessions/{sid}/start", headers=crew["alice"])

    s = client.post(f"/api/sessions/{sid}/finish-early", json={"wantsToFinish": True}, headers=crew["alice"]).json()
    assert s["status"] == "studying" and s["me"]["wantsToFinish"]
    assert {p["user"]["username"]: p["wantsToFinish"] for p in s["participants"]} == {"alice": True, "bob": False}

    # changing your mind works
    s = client.post(f"/api/sessions/{sid}/finish-early", json={"wantsToFinish": False}, headers=crew["alice"]).json()
    assert not s["me"]["wantsToFinish"]

    end_study_after(db_session, sid, 10)  # pretend 10 minutes passed (sets study_ends_at = now)
    shift(db_session, sid, study_ends_at=utc_now() + timedelta(minutes=20))  # …with 20 minutes still to go
    client.post(f"/api/sessions/{sid}/finish-early", json={"wantsToFinish": True}, headers=crew["alice"])
    s = client.post(f"/api/sessions/{sid}/finish-early", json={"wantsToFinish": True}, headers=crew["bob"]).json()
    # everyone agreed: straight to the quiz, no extension vote, focus counted up to now (not the old end time)
    assert s["status"] == "generating_quiz"
    me = next(p for p in s["participants"] if p["user"]["username"] == "alice")
    assert 590 <= me["focus"]["focusedSeconds"] + me["focus"]["unfocusedSeconds"] <= 610


def test_finish_early_resets_after_extension(client, crew, db_session):
    sid = create(client, crew)
    ready_lobby(client, crew, sid)
    client.post(f"/api/sessions/{sid}/start", headers=crew["alice"])
    client.post(f"/api/sessions/{sid}/finish-early", json={"wantsToFinish": True}, headers=crew["alice"])
    shift(db_session, sid, study_ends_at=utc_now() - timedelta(seconds=1))
    engine.tick()
    for who in ("alice", "bob"):
        client.post(f"/api/sessions/{sid}/extension-vote", json={"extend": True}, headers=crew[who])
    s = get(client, crew, sid)
    assert s["status"] == "studying" and not any(p["wantsToFinish"] for p in s["participants"])
