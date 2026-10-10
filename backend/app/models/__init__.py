# Import every model module here so Alembic autogenerate can see them.
from app.models.commerce import Payment, ShopItem, StreakFreezeUse, UserItem  # noqa: F401
from app.models.group import Group, GroupMember  # noqa: F401
from app.models.ledger import LedgerEntry  # noqa: F401
from app.models.productivity import CalendarEvent, GoogleAccount, GoogleSessionEvent, Subtask, Todo  # noqa: F401
from app.models.session import (  # noqa: F401
    AssessmentVote,
    Charity,
    Dispute,
    DisputeVote,
    ExtensionVote,
    Material,
    MaterialApproval,
    Participant,
    QuizAnswer,
    QuizQuestion,
    SessionTodo,
    StudySession,
)
from app.models.social import Friendship, Notification  # noqa: F401
from app.models.user import User  # noqa: F401
