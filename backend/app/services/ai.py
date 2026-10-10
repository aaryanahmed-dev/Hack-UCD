"""OpenRouter calls: quiz generation and short-answer grading (default model: Gemma 4 31B, free)."""

import json
import logging
import random
import re
from dataclasses import dataclass

import httpx

from app import config

logger = logging.getLogger(__name__)


class AiError(Exception):
    pass


@dataclass
class GeneratedQuestion:
    type: str  # multiple_choice | short_answer
    prompt: str
    options: list[dict] | None  # [{"id": "a", "text": "..."}]
    correct_option_id: str | None
    model_answer: str | None


@dataclass
class Grade:
    score: float  # 0, 0.5 or 1
    feedback: str


def _chat(model: str, system: str, user: str, temperature: float) -> str:
    if not config.OPENROUTER_API_KEY:
        raise AiError("OPENROUTER_API_KEY is not set")
    try:
        response = httpx.post(
            f"{config.OPENROUTER_BASE_URL}/chat/completions",
            headers={
                "Authorization": f"Bearer {config.OPENROUTER_API_KEY}",
                "X-Title": "Study Stakes",
            },
            json={
                "model": model,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                "temperature": temperature,
                "response_format": {"type": "json_object"},
            },
            timeout=config.AI_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        raise AiError(f"OpenRouter request failed: {exc}") from exc
    if response.status_code != 200:
        raise AiError(f"OpenRouter returned {response.status_code}: {response.text[:300]}")
    try:
        return response.json()["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, ValueError) as exc:
        raise AiError(f"Unexpected OpenRouter response: {response.text[:300]}") from exc


def parse_json_object(text: str) -> dict:
    """Models sometimes wrap JSON in ``` fences or add prose — take the outermost {...}."""
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise AiError("No JSON object in model output")
    try:
        value = json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise AiError(f"Invalid JSON from model: {exc}") from exc
    if not isinstance(value, dict):
        raise AiError("Model output is not a JSON object")
    return value


# ───────── Quiz generation ─────────

QUIZ_SYSTEM = (
    "You write short quizzes that check whether a student genuinely studied the provided material. "
    "You only use facts stated in the material. You reply with a single JSON object and nothing else."
)


def _quiz_prompt(material: str, count: int) -> str:
    short = max(1, round(count * 0.3))
    return f"""Write exactly {count} quiz questions about the STUDY MATERIAL below.

Rules:
- {count - short} questions are "multiple_choice" with exactly 4 options and exactly one correct option.
- {short} questions are "short_answer": the answer is a few words or one short sentence.
- Every question must be answerable in under 20 seconds by someone who studied the material,
  and answerable ONLY from the material (not general knowledge).
- Questions must be clear and unambiguous. No "all of the above" / "none of the above". No trick questions.
- Wrong options must be plausible. Cover different parts of the material.

Reply with JSON in exactly this shape:
{{"questions": [
  {{"type": "multiple_choice", "prompt": "…", "options": ["…", "…", "…", "…"], "correct_index": 0}},
  {{"type": "short_answer", "prompt": "…", "answer": "…"}}
]}}

STUDY MATERIAL:
<<<
{material}
>>>"""


def _validate_questions(data: dict, count: int) -> list[GeneratedQuestion]:
    raw = data.get("questions")
    if not isinstance(raw, list):
        raise AiError("Missing 'questions' list")
    questions: list[GeneratedQuestion] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        prompt = str(item.get("prompt") or "").strip()
        if not prompt:
            continue
        if item.get("type") == "multiple_choice":
            options = item.get("options")
            idx = item.get("correct_index")
            if (
                not isinstance(options, list)
                or len(options) != 4
                or not all(isinstance(o, str) and o.strip() for o in options)
                or len({o.strip().lower() for o in options}) != 4
                or not isinstance(idx, int)
                or not 0 <= idx < 4
            ):
                continue
            # Shuffle so the correct answer isn't always where the model put it
            order = list(range(4))
            random.shuffle(order)
            ids = "abcd"
            shuffled = [{"id": ids[pos], "text": options[orig].strip()} for pos, orig in enumerate(order)]
            correct = ids[order.index(idx)]
            questions.append(GeneratedQuestion("multiple_choice", prompt, shuffled, correct, None))
        elif item.get("type") == "short_answer":
            answer = str(item.get("answer") or "").strip()
            if answer:
                questions.append(GeneratedQuestion("short_answer", prompt, None, None, answer))
    if len(questions) < count:
        raise AiError(f"Only {len(questions)} usable questions, needed {count}")
    return questions[:count]


def generate_quiz(material: str, count: int) -> list[GeneratedQuestion]:
    content = _chat(config.QUIZ_MODEL, QUIZ_SYSTEM, _quiz_prompt(material, count), temperature=0.5)
    return _validate_questions(parse_json_object(content), count)


# ───────── Grading ─────────

GRADING_SYSTEM = (
    "You grade short quiz answers fairly against a reference answer. Accept answers with the same meaning, "
    "synonyms and minor spelling mistakes. You reply with a single JSON object and nothing else."
)


def grade_short_answers(items: list[dict]) -> dict[str, Grade]:
    """items: [{"id", "question", "reference", "answer"}] -> {id: Grade}."""
    if not items:
        return {}
    payload = json.dumps(
        [{"id": i["id"], "question": i["question"], "reference_answer": i["reference"], "student_answer": i["answer"]}
         for i in items],
        ensure_ascii=False,
    )
    prompt = f"""Grade each student answer against its reference answer.
score: 1 = correct, 0.5 = partly correct, 0 = wrong or blank.
feedback: one short sentence for the student.

Reply with JSON: {{"grades": [{{"id": "…", "score": 1, "feedback": "…"}}]}}

ANSWERS:
{payload}"""
    data = parse_json_object(_chat(config.GRADING_MODEL, GRADING_SYSTEM, prompt, temperature=0))
    grades: dict[str, Grade] = {}
    for g in data.get("grades") or []:
        if not isinstance(g, dict) or "id" not in g:
            continue
        try:
            score = float(g.get("score", 0))
        except (TypeError, ValueError):
            continue
        score = min((0.0, 0.5, 1.0), key=lambda allowed: abs(allowed - score))
        grades[str(g["id"])] = Grade(score=score, feedback=str(g.get("feedback") or "").strip()[:300])
    return grades


def _words(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def fallback_grade(reference: str, answer: str) -> Grade:
    """Used when the AI grader is unavailable: full marks if the answer contains the reference's words."""
    ref, ans = _words(reference), _words(answer)
    if ref and ref.issubset(ans):
        return Grade(1.0, "Matches the reference answer (graded automatically).")
    overlap = len(ref & ans) / len(ref) if ref else 0
    if overlap >= 0.5:
        return Grade(0.5, "Partly matches the reference answer (graded automatically).")
    return Grade(0.0, f"Expected: {reference} (graded automatically).")
