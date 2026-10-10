"""The approved charities list (API_SPEC §6.10). Seeded by migration; also used by tests."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.session import Charity

CHARITIES = [
    {
        "id": "4b1c0f2e-6a0e-4d3e-9c1a-1f2b3c4d5e01",
        "name": "Irish Red Cross",
        "description": "Emergency relief, first aid and community support in Ireland and abroad.",
        "website_url": "https://www.redcross.ie",
    },
    {
        "id": "4b1c0f2e-6a0e-4d3e-9c1a-1f2b3c4d5e02",
        "name": "Doctors Without Borders",
        "description": "Independent medical humanitarian aid where it's needed most.",
        "website_url": "https://www.msf.org",
    },
    {
        "id": "4b1c0f2e-6a0e-4d3e-9c1a-1f2b3c4d5e03",
        "name": "Barnardos Ireland",
        "description": "Supporting children and families to overcome disadvantage.",
        "website_url": "https://www.barnardos.ie",
    },
    {
        "id": "4b1c0f2e-6a0e-4d3e-9c1a-1f2b3c4d5e04",
        "name": "Pieta",
        "description": "Free therapy for people in suicidal distress and those who self-harm.",
        "website_url": "https://www.pieta.ie",
    },
    {
        "id": "4b1c0f2e-6a0e-4d3e-9c1a-1f2b3c4d5e05",
        "name": "Focus Ireland",
        "description": "Working to prevent and end homelessness.",
        "website_url": "https://www.focusireland.ie",
    },
]


def seed_charities(db: Session) -> None:
    existing = set(db.scalars(select(Charity.id)))
    for c in CHARITIES:
        if c["id"] not in existing:
            db.add(Charity(**c, logo_url=None, is_active=True))
