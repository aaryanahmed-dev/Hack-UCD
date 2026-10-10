"""Study material: uploads, pasted notes, text extraction and approvals (API_SPEC §6.6)."""

import io
import logging
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy.orm import Session

from app import config
from app.errors import ApiError, not_found
from app.models.session import Material, MaterialApproval, SessionStatus, StudySession
from app.models.user import User
from app.schemas.session import PasteMaterial
from app.services.realtime import manager
from app.services.sessions import _require_participant, _require_status, _unready_all
from app.timeutil import utc_now

logger = logging.getLogger(__name__)

# extension -> canonical mime type
ALLOWED = {
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}


def extract_text(data: bytes, ext: str) -> str:
    """Best-effort plain text from a document. Returns '' when nothing readable is found."""
    if ext in (".txt", ".md"):
        for encoding in ("utf-8-sig", "utf-16", "latin-1"):
            try:
                return data.decode(encoding)
            except UnicodeDecodeError:
                continue
        return ""
    if ext == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        return "\n\n".join((page.extract_text() or "") for page in reader.pages)
    if ext == ".docx":
        import docx

        document = docx.Document(io.BytesIO(data))
        parts = [p.text for p in document.paragraphs]
        for table in document.tables:
            for row in table.rows:
                parts.append(" | ".join(cell.text for cell in row.cells))
        return "\n".join(parts)
    if ext == ".pptx":
        from pptx import Presentation

        deck = Presentation(io.BytesIO(data))
        slides = []
        for i, slide in enumerate(deck.slides, start=1):
            texts = [shape.text_frame.text for shape in slide.shapes if shape.has_text_frame]
            slides.append(f"Slide {i}:\n" + "\n".join(t for t in texts if t.strip()))
        return "\n\n".join(slides)
    return ""


def _check_can_add(s: StudySession, user: User) -> None:
    _require_status(s, SessionStatus.LOBBY, action="add material")
    _require_participant(s, user)
    if len(s.materials) >= config.MAX_MATERIALS_PER_SESSION:
        raise ApiError(409, "conflict", f"A session can have at most {config.MAX_MATERIALS_PER_SESSION} materials.")


def _add(db: Session, s: StudySession, user: User, material: Material) -> Material:
    material.approvals.append(MaterialApproval(user_id=user.id))  # uploader approves their own
    s.materials.append(material)
    _unready_all(s)
    db.commit()
    manager.notify_session(s.id)
    return material


async def read_upload(file: UploadFile) -> tuple[str, str, bytes]:
    """Validate and read an upload: (filename, extension, bytes)."""
    filename = Path(file.filename or "upload").name[:200]
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED:
        raise ApiError(415, "unsupported_file_type", "Upload a PDF, Word (.docx), PowerPoint (.pptx), .txt or .md file.")
    data = await file.read(config.MAX_UPLOAD_BYTES + 1)
    if len(data) > config.MAX_UPLOAD_BYTES:
        raise ApiError(413, "file_too_large", "Files can be at most 20 MB.")
    if not data:
        raise ApiError(422, "validation_error", "That file is empty.", [{"field": "file", "message": "empty"}])
    return filename, ext, data


def add_file(db: Session, s: StudySession, user: User, filename: str, ext: str, data: bytes) -> Material:
    _check_can_add(s, user)
    material = Material(
        session_id=s.id, uploaded_by=user.id, kind="file", title=filename,
        mime_type=ALLOWED[ext], size_bytes=len(data), text_status="processing", uploaded_at=utc_now(),
    )
    db.add(material)
    db.flush()  # assigns the id used for the storage path

    folder = Path(config.UPLOAD_DIR) / s.id
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{material.id}{ext}"
    path.write_bytes(data)
    material.storage_path = str(path)

    try:
        text = extract_text(data, ext).strip()
    except Exception:
        logger.exception("Text extraction failed for %s", filename)
        text = ""
    material.extracted_text = text or None
    material.text_status = "ready" if len(text) >= 20 else "failed"
    return _add(db, s, user, material)


def add_text(db: Session, s: StudySession, user: User, data: PasteMaterial) -> Material:
    _check_can_add(s, user)
    material = Material(
        session_id=s.id, uploaded_by=user.id, kind="text", title=data.title, mime_type="text/plain",
        size_bytes=len(data.text.encode()), extracted_text=data.text, text_status="ready", uploaded_at=utc_now(),
    )
    return _add(db, s, user, material)


def get_material(s: StudySession, material_id: str) -> Material:
    material = next((m for m in s.materials if m.id == material_id), None)
    if material is None:
        raise not_found("Material")
    return material


def set_approval(db: Session, s: StudySession, user: User, material_id: str, approved: bool) -> Material:
    _require_status(s, SessionStatus.LOBBY, action="approve material")
    p = _require_participant(s, user)
    material = get_material(s, material_id)
    existing = next((a for a in material.approvals if a.user_id == user.id), None)
    if approved and existing is None:
        material.approvals.append(MaterialApproval(user_id=user.id))
    elif not approved and existing is not None:
        material.approvals.remove(existing)
        p.is_ready = False
    db.commit()
    manager.notify_session(s.id)
    return material


def delete_material(db: Session, s: StudySession, user: User, material_id: str) -> None:
    _require_status(s, SessionStatus.LOBBY, action="remove material")
    material = get_material(s, material_id)
    if material.uploaded_by != user.id and s.host_id != user.id:
        raise ApiError(403, "forbidden", "Only the uploader or the host can remove this.")
    if material.storage_path:
        Path(material.storage_path).unlink(missing_ok=True)
    s.materials.remove(material)
    _unready_all(s)
    db.commit()
    manager.notify_session(s.id)
