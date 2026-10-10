from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.schemas.common import CamelModel, UTCDateTime
from app.schemas.user import UserSummary

SessionStatusValue = Literal[
    "lobby", "studying", "extension_vote", "generating_quiz", "quiz", "grading", "review", "settled", "cancelled"
]
Mode = Literal["tokens", "money"]
PayoutTarget = Literal["winners", "charity"]
ThresholdType = Literal["fixed", "top_percent", "relative_to_best"]
FocusState = Literal["focused", "idle", "away", "offline"]


# ───────── Config ─────────


class SessionConfig(CamelModel):
    title: str = Field(min_length=1, max_length=60)
    mode: Mode
    stake_amount: int = Field(ge=0, le=1_000_000)
    payout_target: PayoutTarget
    charity_id: str | None = None
    study_minutes: int = Field(ge=5, le=240)
    extension_minutes: int = Field(default=10, ge=5, le=60)
    max_extensions: int = Field(default=2, ge=0, le=3)
    quiz_question_count: int = Field(default=5, ge=5, le=10)
    min_focus_percent: int = Field(default=0, ge=0, le=100)
    max_participants: int = Field(default=10, ge=2, le=10)
    scheduled_for: UTCDateTime | None = None

    @field_validator("title")
    @classmethod
    def _title(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("cannot be blank")
        return v

    @model_validator(mode="after")
    def _money_rules(self):
        if self.mode == "money":
            if self.stake_amount < 100:
                raise ValueError("Money stakes must be at least 100 coins (€1.00).")
        if self.payout_target == "charity" and not self.charity_id:
            raise ValueError("Pick a charity for forfeited stakes.")
        return self


class UpdateSessionConfig(CamelModel):
    """Partial config; merged with the current config and re-validated as a whole."""

    title: str | None = None
    mode: Mode | None = None
    stake_amount: int | None = None
    payout_target: PayoutTarget | None = None
    charity_id: str | None = None
    study_minutes: int | None = None
    extension_minutes: int | None = None
    max_extensions: int | None = None
    quiz_question_count: int | None = None
    min_focus_percent: int | None = None
    max_participants: int | None = None
    scheduled_for: UTCDateTime | None = None


class AssessmentRule(CamelModel):
    threshold_type: ThresholdType
    threshold_value: int = Field(ge=0, le=100)


class ReadyBody(CamelModel):
    is_ready: bool


class ExtensionVoteBody(CamelModel):
    extend: bool


class FinishEarlyBody(CamelModel):
    wants_to_finish: bool


class FocusEventBody(CamelModel):
    state: Literal["focused", "idle", "away"]


# ───────── Output ─────────


class CharityOut(CamelModel):
    id: str
    name: str
    description: str
    logo_url: str | None
    website_url: str | None


class FocusSummary(CamelModel):
    state: FocusState
    focused_seconds: int
    unfocused_seconds: int
    focus_percent: int


class QuizProgress(CamelModel):
    answered: int
    total: int
    flagged: int


class ParticipantResult(CamelModel):
    quiz_score: int
    focus_percent: int
    flagged_questions: int
    passed: bool
    rank: int
    stake_amount: int
    payout: int
    net_amount: int
    bonus_tokens: int
    final: bool


class ParticipantOut(CamelModel):
    user: UserSummary
    is_host: bool
    is_ready: bool
    joined_at: UTCDateTime
    presence: Literal["online", "offline"]
    has_voted: bool
    wants_to_finish: bool  # opted in to finishing the study block early
    focus: FocusSummary | None
    quiz_progress: QuizProgress | None
    result: ParticipantResult | None


class MaterialOut(CamelModel):
    id: str
    kind: Literal["file", "text"]
    title: str
    mime_type: str | None
    size_bytes: int
    uploaded_by: UserSummary
    uploaded_at: UTCDateTime
    approved_by: list[str]
    approved_by_all: bool
    text_status: Literal["processing", "ready", "failed"]


class VoteTally(CamelModel):
    rule: AssessmentRule
    count: int


class AssessmentOut(CamelModel):
    votes: list[VoteTally]
    my_vote: AssessmentRule | None
    decided: AssessmentRule | None
    decided_by: Literal["vote", "coin_flip"] | None


class ExtensionRoundOut(CamelModel):
    ends_at: UTCDateTime
    yes: int
    no: int
    voted: int
    my_vote: bool | None


class ExtensionOutcome(CamelModel):
    extended: bool
    decided_by: Literal["vote", "coin_flip"]


class ExtensionOut(CamelModel):
    used: int
    vote: ExtensionRoundOut | None
    last_outcome: ExtensionOutcome | None


class SessionMe(CamelModel):
    wants_to_finish: bool
    is_host: bool
    is_participant: bool
    is_ready: bool
    quiz_progress: QuizProgress | None
    review_done: bool


class GroupRef(CamelModel):
    id: str
    name: str


class SessionConfigOut(CamelModel):
    title: str
    mode: Mode
    stake_amount: int
    payout_target: PayoutTarget
    charity_id: str | None
    study_minutes: int
    extension_minutes: int
    max_extensions: int
    quiz_question_count: int
    min_focus_percent: int
    max_participants: int
    scheduled_for: UTCDateTime | None


class StudySessionOut(CamelModel):
    id: str
    group: GroupRef
    status: SessionStatusValue
    host: UserSummary
    config: SessionConfigOut
    charity: CharityOut | None
    participants: list[ParticipantOut]
    materials: list[MaterialOut]
    assessment: AssessmentOut
    extension: ExtensionOut
    created_at: UTCDateTime
    started_at: UTCDateTime | None
    study_ends_at: UTCDateTime | None
    quiz_starts_at: UTCDateTime | None
    quiz_ends_at: UTCDateTime | None
    review_ends_at: UTCDateTime | None
    settled_at: UTCDateTime | None
    cancel_reason: str | None
    server_time: UTCDateTime  # lets clients correct for clock skew when rendering countdowns
    me: SessionMe


class MyResultRef(CamelModel):
    passed: bool
    net_amount: int


class SessionSummaryOut(CamelModel):
    id: str
    group: GroupRef
    title: str
    status: SessionStatusValue
    mode: Mode
    stake_amount: int
    participant_count: int
    scheduled_for: UTCDateTime | None
    started_at: UTCDateTime | None
    settled_at: UTCDateTime | None
    my_result: MyResultRef | None


# ───────── Todos ─────────


class SessionTodoOut(CamelModel):
    id: str
    title: str
    created_by: UserSummary
    is_done: bool
    completed_by: UserSummary | None
    completed_at: UTCDateTime | None
    created_at: UTCDateTime


class CreateTodo(CamelModel):
    title: str = Field(min_length=1, max_length=200)

    @field_validator("title")
    @classmethod
    def _title(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("cannot be blank")
        return v


class UpdateTodo(CamelModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    is_done: bool | None = None


# ───────── Materials ─────────


class PasteMaterial(CamelModel):
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=100_000)

    @field_validator("title", "text")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("cannot be blank")
        return v


class ApproveMaterial(CamelModel):
    approved: bool


# ───────── Quiz & review ─────────


class QuizOption(CamelModel):
    id: str
    text: str


class QuizQuestionOut(CamelModel):
    id: str
    index: int
    type: Literal["multiple_choice", "short_answer"]
    prompt: str
    options: list[QuizOption] | None
    time_limit_seconds: int


class CurrentQuestion(CamelModel):
    question: QuizQuestionOut | None
    number: int
    total: int
    deadline: UTCDateTime | None
    server_time: UTCDateTime


class QuizAnswerBody(CamelModel):
    question_id: str
    option_id: str | None = None
    text: str | None = Field(default=None, max_length=1000)


class DisputeOut(CamelModel):
    id: str
    question_id: str
    opened_by: UserSummary
    reason: str
    drop_votes: int
    keep_votes: int
    votes_needed: int
    my_vote: Literal["drop", "keep"] | None
    outcome: Literal["open", "nullified", "kept"]


class MyAnswer(CamelModel):
    option_id: str | None
    text: str | None


class QuestionReview(CamelModel):
    question: QuizQuestionOut
    correct_option_id: str | None
    model_answer: str | None
    my_answer: MyAnswer | None
    my_score: float
    flagged: bool
    expired: bool
    feedback: str | None
    nullified: bool
    dispute: DisputeOut | None


class ReviewOut(CamelModel):
    participants: list[ParticipantOut]
    questions: list[QuestionReview]


class OpenDispute(CamelModel):
    question_id: str
    reason: str = Field(min_length=1, max_length=300)


class DisputeVoteBody(CamelModel):
    vote: Literal["drop", "keep"]
