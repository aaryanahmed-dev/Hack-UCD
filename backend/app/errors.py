import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)


class UnhandledErrorMiddleware(BaseHTTPMiddleware):
    """Turn crashes into the standard 500 error body *inside* the CORS middleware.

    Starlette's own last-resort handler runs outside CORS, so browsers would see a response
    without CORS headers and report it as a network failure instead of a server error.
    Must be added before CORSMiddleware so CORS wraps it.
    """

    async def dispatch(self, request: Request, call_next):
        try:
            return await call_next(request)
        except Exception:
            logger.exception("Unhandled error on %s %s", request.method, request.url.path)
            return _error_response(500, "internal_error", "Something went wrong.")


class ApiError(Exception):
    """Raise for every expected error; rendered as {"error": {code, message, details}} (API_SPEC §3.5)."""

    def __init__(self, status: int, code: str, message: str, details=None):
        self.status = status
        self.code = code
        self.message = message
        self.details = details


def not_found(what: str = "Resource") -> ApiError:
    return ApiError(404, "not_found", f"{what} not found.")


def _error_response(status: int, code: str, message: str, details=None) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message, "details": details}},
    )


_HTTP_CODES = {
    400: "bad_request",
    401: "unauthenticated",
    403: "forbidden",
    404: "not_found",
    405: "bad_request",
    413: "file_too_large",
    415: "unsupported_file_type",
    429: "rate_limited",
}


def _field_name(loc) -> str:
    # ("body", "displayName") -> "displayName"; ("query", "limit") -> "limit"
    parts = [str(p) for p in loc if p not in ("body", "query", "path", "header")]
    return ".".join(parts) or "body"


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def handle_api_error(request: Request, exc: ApiError):
        return _error_response(exc.status, exc.code, exc.message, exc.details)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, exc: RequestValidationError):
        details = [{"field": _field_name(e["loc"]), "message": e["msg"]} for e in exc.errors()]
        return _error_response(422, "validation_error", "Some fields are invalid.", details)

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(request: Request, exc: StarletteHTTPException):
        code = _HTTP_CODES.get(exc.status_code, "internal_error" if exc.status_code >= 500 else "bad_request")
        message = exc.detail if isinstance(exc.detail, str) else "Request failed."
        return _error_response(exc.status_code, code, message)

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception):
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return _error_response(500, "internal_error", "Something went wrong.")
