"""Single-user password login.

The password comes from SLIDECAST_PASSWORD. Logging in sets a long-lived,
HttpOnly cookie holding an HMAC of the password, so the installed app stays
signed in, and changing the password signs every device out.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time
from collections import defaultdict, deque

from fastapi import Request, Response
from fastapi.responses import JSONResponse, RedirectResponse

COOKIE = "slidecast_session"
COOKIE_MAX_AGE = 365 * 24 * 3600
# Paths reachable without logging in: the login page and what an installed app
# needs to show its icon before sign-in.
PUBLIC = {"/login", "/login.html", "/api/login", "/manifest.webmanifest", "/sw.js", "/favicon.ico"}
PUBLIC_PREFIXES = ("/icons/",)
MAX_FAILURES = 5
FAILURE_WINDOW = 15 * 60

PASSWORD = os.environ.get("SLIDECAST_PASSWORD", "")
SECRET = os.environ.get("SLIDECAST_SECRET") or secrets.token_hex(32)  # random secret: sessions end on restart
AUTH_DISABLED = os.environ.get("SLIDECAST_NO_AUTH") == "1"

_failures: dict[str, deque] = defaultdict(deque)


def _token() -> str:
    return hmac.new(SECRET.encode(), b"slidecast-v1:" + PASSWORD.encode(), hashlib.sha256).hexdigest()


def is_authed(request: Request) -> bool:
    if AUTH_DISABLED:
        return True
    cookie = request.cookies.get(COOKIE, "")
    return bool(PASSWORD) and hmac.compare_digest(cookie, _token())


def _is_https(request: Request) -> bool:
    # Behind `tailscale serve` the original scheme arrives in X-Forwarded-Proto.
    return request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"


def check_password(request: Request, password: str) -> Response:
    ip = request.client.host if request.client else "?"
    now = time.time()
    fails = _failures[ip]
    while fails and fails[0] < now - FAILURE_WINDOW:
        fails.popleft()
    if len(fails) >= MAX_FAILURES:
        return JSONResponse({"detail": "Too many attempts. Try again in a few minutes."}, status_code=429)
    if not PASSWORD:
        return JSONResponse({"detail": "No password is set on the server (SLIDECAST_PASSWORD)."}, status_code=503)
    if not hmac.compare_digest(password.encode(), PASSWORD.encode()):
        fails.append(now)
        return JSONResponse({"detail": "Wrong password."}, status_code=401)
    fails.clear()
    resp = JSONResponse({"ok": True})
    resp.set_cookie(COOKIE, _token(), max_age=COOKIE_MAX_AGE, httponly=True, samesite="lax",
                    secure=_is_https(request), path="/")
    return resp


def logout() -> Response:
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(COOKIE, path="/")
    return resp


async def middleware(request: Request, call_next):
    path = request.url.path
    if path in PUBLIC or path.startswith(PUBLIC_PREFIXES) or is_authed(request):
        return await call_next(request)
    if path.startswith("/api/"):
        return JSONResponse({"detail": "Please sign in."}, status_code=401)
    return RedirectResponse("/login")
