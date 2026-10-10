from datetime import UTC, date, datetime


def utc_now() -> datetime:
    """Naive UTC datetime — all datetimes are stored in MySQL as naive UTC."""
    return datetime.now(UTC).replace(tzinfo=None)


def age_on(dob: date, today: date) -> int:
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def is_adult(dob: date) -> bool:
    return age_on(dob, utc_now().date()) >= 18
