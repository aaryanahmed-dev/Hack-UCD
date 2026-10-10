import json

import httpx
import pytest

from app import config
from app.services import ai

GOOD = {
    "questions": [
        {"type": "multiple_choice", "prompt": "Powerhouse of the cell?", "options": ["Mitochondria", "Nucleus", "Ribosome", "Golgi"], "correct_index": 0},
        {"type": "multiple_choice", "prompt": "DNA lives in the?", "options": ["Nucleus", "Membrane", "Wall", "Vacuole"], "correct_index": 0},
        {"type": "short_answer", "prompt": "What do ribosomes make?", "answer": "Proteins"},
    ]
}


def test_parse_json_object_handles_fences_and_prose():
    assert ai.parse_json_object('```json\n{"a": 1}\n```') == {"a": 1}
    assert ai.parse_json_object('Sure! Here it is: {"a": {"b": 2}} hope that helps') == {"a": {"b": 2}}
    with pytest.raises(ai.AiError):
        ai.parse_json_object("no json here")


def test_validate_questions_shuffles_and_keeps_correct_answer():
    questions = ai._validate_questions(GOOD, 3)
    assert [q.type for q in questions] == ["multiple_choice", "multiple_choice", "short_answer"]
    q = questions[0]
    assert [o["id"] for o in q.options] == ["a", "b", "c", "d"]
    correct = next(o for o in q.options if o["id"] == q.correct_option_id)
    assert correct["text"] == "Mitochondria"
    assert questions[2].model_answer == "Proteins"


def test_validate_questions_rejects_bad_items():
    bad = {"questions": [
        {"type": "multiple_choice", "prompt": "x", "options": ["a", "b", "c"], "correct_index": 0},  # 3 options
        {"type": "multiple_choice", "prompt": "y", "options": ["a", "a", "b", "c"], "correct_index": 0},  # dup
        {"type": "short_answer", "prompt": "z", "answer": ""},
    ]}
    with pytest.raises(ai.AiError):
        ai._validate_questions(bad, 1)


def test_generate_quiz_calls_openrouter(monkeypatch):
    monkeypatch.setattr(config, "OPENROUTER_API_KEY", "test-key")
    seen = {}

    def fake_post(url, headers, json, timeout):
        seen.update(url=url, headers=headers, body=json)
        return httpx.Response(200, json={"choices": [{"message": {"content": __import__("json").dumps(GOOD)}}]})

    monkeypatch.setattr(httpx, "post", fake_post)
    questions = ai.generate_quiz("Cells have mitochondria.", 3)
    assert len(questions) == 3
    assert seen["url"].endswith("/chat/completions")
    assert seen["headers"]["Authorization"] == "Bearer test-key"
    assert seen["body"]["model"] == "google/gemma-4-31b-it:free"
    assert seen["body"]["response_format"] == {"type": "json_object"}


def test_missing_key_is_an_ai_error(monkeypatch):
    monkeypatch.setattr(config, "OPENROUTER_API_KEY", "")
    with pytest.raises(ai.AiError):
        ai.generate_quiz("text", 5)


def test_grading_snaps_scores(monkeypatch):
    monkeypatch.setattr(config, "OPENROUTER_API_KEY", "k")
    reply = {"grades": [{"id": "1", "score": 0.9, "feedback": "Right"}, {"id": "2", "score": "0.4", "feedback": "Half"}]}
    monkeypatch.setattr(
        httpx, "post",
        lambda *a, **k: httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(reply)}}]}),
    )
    grades = ai.grade_short_answers([
        {"id": "1", "question": "q", "reference": "r", "answer": "a"},
        {"id": "2", "question": "q", "reference": "r", "answer": "a"},
    ])
    assert grades["1"].score == 1.0 and grades["2"].score == 0.5


def test_fallback_grade():
    assert ai.fallback_grade("Proteins", "they make proteins").score == 1.0
    assert ai.fallback_grade("light energy", "energy").score == 0.5
    assert ai.fallback_grade("Proteins", "lipids").score == 0.0
