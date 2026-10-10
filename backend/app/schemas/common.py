from datetime import UTC, datetime
from typing import Annotated, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, PlainSerializer
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Base for every request/response schema: snake_case in Python, camelCase in JSON."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


def _to_iso_z(dt: datetime) -> str:
    if dt.tzinfo is not None:
        dt = dt.astimezone(UTC).replace(tzinfo=None)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


# Datetimes are stored as naive UTC and always serialized as "2026-10-10T14:03:00Z".
UTCDateTime = Annotated[datetime, PlainSerializer(_to_iso_z, return_type=str)]

T = TypeVar("T")


class ListResponse(CamelModel, Generic[T]):
    items: list[T]


class Page(CamelModel, Generic[T]):
    items: list[T]
    next_cursor: str | None
