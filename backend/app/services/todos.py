"""Personal to-dos with subtasks, priority and tags (API_SPEC §6.11)."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import ApiError, not_found
from app.models.productivity import Subtask, Todo
from app.models.user import User
from app.schemas.productivity import CreateTodo, SubtaskOut, TodoOut, UpdateSubtask, UpdateTodo
from app.services import friends
from app.timeutil import utc_now

PRIORITY_ORDER = {"high": 0, "medium": 1, "low": 2}
MAX_SUBTASKS = 30


def to_out(t: Todo) -> TodoOut:
    return TodoOut(
        id=t.id,
        title=t.title,
        notes=t.notes,
        priority=t.priority,
        tags=list(t.tags or []),
        due_at=t.due_at,
        is_done=t.is_done,
        completed_at=t.completed_at,
        visibility=t.visibility,
        subtasks=[SubtaskOut(id=s.id, title=s.title, is_done=s.is_done) for s in t.subtasks],
        created_at=t.created_at,
    )


def _sort_key(t: Todo):
    # Open first; then by due date (none last), priority, newest
    return (t.is_done, t.due_at is None, t.due_at or t.created_at, PRIORITY_ORDER[t.priority], -t.created_at.timestamp())


def list_todos(db: Session, user_id: str, is_done: bool | None, tag: str | None, priority: str | None, friends_only: bool = False) -> list[TodoOut]:
    query = select(Todo).where(Todo.user_id == user_id)
    if is_done is not None:
        query = query.where(Todo.is_done.is_(is_done))
    if priority:
        query = query.where(Todo.priority == priority)
    if friends_only:
        query = query.where(Todo.visibility == "friends")
    todos = list(db.scalars(query))
    if tag:
        tag = tag.strip().lower().lstrip("#")
        todos = [t for t in todos if tag in (t.tags or [])]
    return [to_out(t) for t in sorted(todos, key=_sort_key)]


def list_friend_todos(db: Session, me: User, user_id: str) -> list[TodoOut]:
    if user_id != me.id and not friends.are_friends(db, me.id, user_id):
        raise ApiError(403, "forbidden", "You can only see your friends' to-dos.")
    return list_todos(db, user_id, is_done=None, tag=None, priority=None, friends_only=user_id != me.id)


def _get(db: Session, me: User, todo_id: str) -> Todo:
    t = db.get(Todo, todo_id)
    if t is None or t.user_id != me.id:
        raise not_found("To-do")
    return t


def create(db: Session, me: User, data: CreateTodo) -> Todo:
    t = Todo(
        user_id=me.id,
        title=data.title,
        notes=(data.notes or "").strip() or None,
        priority=data.priority,
        tags=data.tags,
        due_at=data.due_at,
        visibility=data.visibility,
        created_at=utc_now(),
    )
    for i, s in enumerate(data.subtasks):
        t.subtasks.append(Subtask(title=s.title, position=i))
    db.add(t)
    db.commit()
    return t


def update(db: Session, me: User, todo_id: str, data: UpdateTodo) -> Todo:
    t = _get(db, me, todo_id)
    changes = data.model_dump(exclude_unset=True)
    if changes.get("title") is not None:
        t.title = changes["title"].strip() or t.title
    if "notes" in changes:
        t.notes = (changes["notes"] or "").strip() or None
    if changes.get("priority"):
        t.priority = changes["priority"]
    if changes.get("tags") is not None:
        t.tags = changes["tags"]
    if "due_at" in changes:
        t.due_at = changes["due_at"]
    if changes.get("visibility"):
        t.visibility = changes["visibility"]
    if changes.get("is_done") is not None and changes["is_done"] != t.is_done:
        t.is_done = changes["is_done"]
        t.completed_at = utc_now() if t.is_done else None
    db.commit()
    return t


def delete(db: Session, me: User, todo_id: str) -> None:
    db.delete(_get(db, me, todo_id))
    db.commit()


def add_subtask(db: Session, me: User, todo_id: str, title: str) -> Subtask:
    t = _get(db, me, todo_id)
    if len(t.subtasks) >= MAX_SUBTASKS:
        raise ApiError(409, "conflict", f"A to-do can have at most {MAX_SUBTASKS} subtasks.")
    s = Subtask(title=title.strip(), position=(max((x.position for x in t.subtasks), default=-1) + 1))
    t.subtasks.append(s)
    db.commit()
    return s


def _get_subtask(t: Todo, subtask_id: str) -> Subtask:
    s = next((x for x in t.subtasks if x.id == subtask_id), None)
    if s is None:
        raise not_found("Subtask")
    return s


def update_subtask(db: Session, me: User, todo_id: str, subtask_id: str, data: UpdateSubtask) -> Todo:
    t = _get(db, me, todo_id)
    s = _get_subtask(t, subtask_id)
    if data.title is not None:
        s.title = data.title.strip() or s.title
    if data.is_done is not None:
        s.is_done = data.is_done
    db.commit()
    return t


def delete_subtask(db: Session, me: User, todo_id: str, subtask_id: str) -> Todo:
    t = _get(db, me, todo_id)
    t.subtasks.remove(_get_subtask(t, subtask_id))
    db.commit()
    return t
