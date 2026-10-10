import base64
from pathlib import Path

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.auth import get_current_user
from app.db import get_db
from app.errors import ApiError
from app.models.group import GroupMember
from app.models.session import Charity, Participant, SessionStatus, StudySession
from app.models.user import User
from app.schemas.common import ListResponse, Page
from app.schemas.session import (
    ApproveMaterial,
    AssessmentRule,
    CharityOut,
    CreateTodo,
    CurrentQuestion,
    DisputeOut,
    DisputeVoteBody,
    ExtensionVoteBody,
    FinishEarlyBody,
    FocusEventBody,
    MaterialOut,
    OpenDispute,
    PasteMaterial,
    QuizAnswerBody,
    ReadyBody,
    ReviewOut,
    SessionConfig,
    SessionSummaryOut,
    SessionTodoOut,
    StudySessionOut,
    UpdateSessionConfig,
    UpdateTodo,
)
from app.services import groups as groups_service
from app.services import materials, quiz, sessions
from app.services.session_view import charity_out, materials_out, to_session_out, to_summary, todo_out
from app.services.sessions import ACTIVE_STATUSES

router = APIRouter(tags=["sessions"])

Scope = Query("active", pattern="^(active|scheduled|past)$")


def _out(db: Session, s: StudySession, user: User) -> StudySessionOut:
    return to_session_out(db, s, user.id)


def _scope_filter(scope: str):
    if scope == "past":
        return StudySession.status.in_([SessionStatus.SETTLED, SessionStatus.CANCELLED])
    if scope == "scheduled":
        return (StudySession.status == SessionStatus.LOBBY) & StudySession.scheduled_for.is_not(None)
    return StudySession.status.in_(ACTIVE_STATUSES)


def _page(db: Session, query, user: User, limit: int, cursor: str | None) -> Page[SessionSummaryOut]:
    try:
        offset = int(base64.urlsafe_b64decode(cursor.encode()).decode()) if cursor else 0
    except ValueError:
        raise ApiError(400, "bad_request", "Invalid cursor.")
    rows = db.scalars(query.order_by(StudySession.created_at.desc()).offset(offset).limit(limit + 1)).all()
    next_cursor = base64.urlsafe_b64encode(str(offset + limit).encode()).decode() if len(rows) > limit else None
    return Page(items=[to_summary(db, s, user.id) for s in rows[:limit]], next_cursor=next_cursor)


# ───────── Charities ─────────


@router.get("/api/charities", response_model=ListResponse[CharityOut])
def list_charities(db: Session = Depends(get_db)):
    charities = db.scalars(select(Charity).where(Charity.is_active.is_(True)).order_by(Charity.name)).all()
    return ListResponse(items=[charity_out(c) for c in charities])


# ───────── Sessions ─────────


@router.post("/api/groups/{group_id}/sessions", response_model=StudySessionOut, status_code=201)
def create_session(group_id: str, data: SessionConfig, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _out(db, sessions.create_session(db, user, group_id, data), user)


@router.get("/api/groups/{group_id}/sessions", response_model=Page[SessionSummaryOut])
def list_group_sessions(
    group_id: str,
    scope: str = Scope,
    limit: int = Query(20, ge=1, le=100),
    cursor: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    groups_service.get_membership(db, group_id, user)
    query = select(StudySession).where(StudySession.group_id == group_id, _scope_filter(scope))
    return _page(db, query, user, limit, cursor)


@router.get("/api/sessions", response_model=Page[SessionSummaryOut])
def list_my_sessions(
    scope: str = Scope,
    limit: int = Query(20, ge=1, le=100),
    cursor: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    mine = select(Participant.session_id).where(Participant.user_id == user.id)
    my_groups = select(GroupMember.group_id).where(GroupMember.user_id == user.id)
    query = select(StudySession).where(
        StudySession.id.in_(mine), StudySession.group_id.in_(my_groups), _scope_filter(scope)
    )
    return _page(db, query, user, limit, cursor)


@router.get("/api/sessions/{session_id}", response_model=StudySessionOut)
def get_session(session_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _out(db, sessions.get_session(db, session_id, user), user)


@router.patch("/api/sessions/{session_id}", response_model=StudySessionOut)
def update_session(session_id: str, data: UpdateSessionConfig, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = sessions.get_session_for_update(db, session_id, user)
    return _out(db, sessions.update_config(db, s, user, data), user)


@router.delete("/api/sessions/{session_id}", status_code=204)
def cancel_session(session_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sessions.cancel(db, sessions.get_session_for_update(db, session_id, user), user)
    return Response(status_code=204)


@router.post("/api/sessions/{session_id}/join", response_model=StudySessionOut)
def join_session(session_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = sessions.get_session_for_update(db, session_id, user)
    return _out(db, sessions.join(db, s, user), user)


@router.post("/api/sessions/{session_id}/leave", status_code=204)
def leave_session(session_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sessions.leave(db, sessions.get_session_for_update(db, session_id, user), user)
    return Response(status_code=204)


@router.put("/api/sessions/{session_id}/assessment-vote", response_model=StudySessionOut)
def vote_assessment(session_id: str, data: AssessmentRule, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = sessions.get_session_for_update(db, session_id, user)
    return _out(db, sessions.vote_assessment(db, s, user, data), user)


@router.post("/api/sessions/{session_id}/ready", response_model=StudySessionOut)
def set_ready(session_id: str, data: ReadyBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = sessions.get_session_for_update(db, session_id, user)
    return _out(db, sessions.set_ready(db, s, user, data.is_ready), user)


@router.post("/api/sessions/{session_id}/start", response_model=StudySessionOut)
def start_session(session_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = sessions.get_session_for_update(db, session_id, user)
    return _out(db, sessions.start(db, s, user), user)


@router.post("/api/sessions/{session_id}/extension-vote", response_model=StudySessionOut)
def vote_extension(session_id: str, data: ExtensionVoteBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = sessions.get_session_for_update(db, session_id, user)
    return _out(db, sessions.vote_extension(db, s, user, data.extend), user)


@router.post("/api/sessions/{session_id}/finish-early", response_model=StudySessionOut)
def finish_early(session_id: str, data: FinishEarlyBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = sessions.get_session_for_update(db, session_id, user)
    return _out(db, sessions.set_finish_early(db, s, user, data.wants_to_finish), user)


@router.post("/api/sessions/{session_id}/focus-events", status_code=204)
def focus_event(session_id: str, data: FocusEventBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sessions.get_session(db, session_id, user)
    sessions.update_focus(db, session_id, user.id, data.state)
    return Response(status_code=204)


# ───────── Shared to-dos ─────────


@router.get("/api/sessions/{session_id}/todos", response_model=ListResponse[SessionTodoOut])
def list_todos(session_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return ListResponse(items=sessions.list_todos(db, sessions.get_session(db, session_id, user)))


@router.post("/api/sessions/{session_id}/todos", response_model=SessionTodoOut, status_code=201)
def create_todo(session_id: str, data: CreateTodo, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = sessions.get_session(db, session_id, user)
    return todo_out(sessions.create_todo(db, s, user, data))


@router.patch("/api/sessions/{session_id}/todos/{todo_id}", response_model=SessionTodoOut)
def update_todo(session_id: str, todo_id: str, data: UpdateTodo, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = sessions.get_session(db, session_id, user)
    return todo_out(sessions.update_todo(db, s, user, todo_id, data))


@router.delete("/api/sessions/{session_id}/todos/{todo_id}", status_code=204)
def delete_todo(session_id: str, todo_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sessions.delete_todo(db, sessions.get_session(db, session_id, user), user, todo_id)
    return Response(status_code=204)


# ───────── Materials ─────────


def _material_out(s: StudySession, material_id: str) -> MaterialOut:
    return next(m for m in materials_out(s) if m.id == material_id)


@router.post("/api/sessions/{session_id}/materials", response_model=MaterialOut, status_code=201)
async def upload_material(session_id: str, file: UploadFile = File(...), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    filename, ext, data = await materials.read_upload(file)

    def save() -> MaterialOut:  # DB + text extraction are blocking: keep them off the event loop
        s = sessions.get_session_for_update(db, session_id, user)
        material = materials.add_file(db, s, user, filename, ext, data)
        return _material_out(s, material.id)

    return await run_in_threadpool(save)


@router.post("/api/sessions/{session_id}/materials/text", response_model=MaterialOut, status_code=201)
def paste_material(session_id: str, data: PasteMaterial, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = sessions.get_session_for_update(db, session_id, user)
    material = materials.add_text(db, s, user, data)
    return _material_out(s, material.id)


@router.get("/api/sessions/{session_id}/materials/{material_id}/content")
def material_content(session_id: str, material_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = sessions.get_session(db, session_id, user)
    if s.participant(user.id) is None:
        raise ApiError(403, "forbidden", "You're not taking part in this session.")
    m = materials.get_material(s, material_id)
    if m.kind == "file" and m.storage_path and Path(m.storage_path).is_file():
        return FileResponse(m.storage_path, media_type=m.mime_type, filename=m.title)
    return PlainTextResponse(m.extracted_text or "")


@router.post("/api/sessions/{session_id}/materials/{material_id}/approve", response_model=MaterialOut)
def approve_material(session_id: str, material_id: str, data: ApproveMaterial, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = sessions.get_session_for_update(db, session_id, user)
    materials.set_approval(db, s, user, material_id, data.approved)
    return _material_out(s, material_id)


@router.delete("/api/sessions/{session_id}/materials/{material_id}", status_code=204)
def delete_material(session_id: str, material_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    materials.delete_material(db, sessions.get_session_for_update(db, session_id, user), user, material_id)
    return Response(status_code=204)


# ───────── Quiz & review ─────────


@router.get("/api/sessions/{session_id}/quiz/current", response_model=CurrentQuestion)
def current_question(session_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = sessions.get_session_for_update(db, session_id, user)
    return quiz.current_question(db, s, user)


@router.post("/api/sessions/{session_id}/quiz/answers", response_model=CurrentQuestion)
def submit_answer(session_id: str, data: QuizAnswerBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = sessions.get_session_for_update(db, session_id, user)
    return quiz.submit_answer(db, s, user, data.question_id, data.option_id, data.text)


@router.get("/api/sessions/{session_id}/review", response_model=ReviewOut)
def get_review(session_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return quiz.get_review(db, sessions.get_session(db, session_id, user), user)


@router.post("/api/sessions/{session_id}/disputes", response_model=DisputeOut, status_code=201)
def open_dispute(session_id: str, data: OpenDispute, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = sessions.get_session_for_update(db, session_id, user)
    return quiz.open_dispute(db, s, user, data.question_id, data.reason)


@router.post("/api/sessions/{session_id}/disputes/{dispute_id}/vote", response_model=DisputeOut)
def vote_dispute(session_id: str, dispute_id: str, data: DisputeVoteBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = sessions.get_session_for_update(db, session_id, user)
    return quiz.vote_dispute(db, s, user, dispute_id, data.vote)


@router.post("/api/sessions/{session_id}/review/done", status_code=204)
def review_done(session_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    quiz.review_done(db, sessions.get_session_for_update(db, session_id, user), user)
    return Response(status_code=204)
