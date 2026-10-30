"""Manifest-allowlisted public site files.

Files are resolved from the configured public package root; the allowlist is
read from the app repository manifest. Only manifest paths are readable. Root
maps to index.html, and private, traversal or unknown paths return 404.
"""
import json
import mimetypes
from pathlib import Path
from urllib.parse import unquote

from django.conf import settings
from django.http import FileResponse, Http404, JsonResponse
from django.views.decorators.http import require_safe

MANIFEST_NAME = 'package-manifest.json'
MAX_PATH_LENGTH = 2048
INDEX_PATH = 'index.html'


def app_root():
    return Path(settings.BASE_DIR).resolve().parent


def public_root():
    root = getattr(settings, 'STATIC_SITE_ROOT', None)
    return Path(root).resolve() if root is not None else app_root()


def public_manifest_path():
    return app_root() / MANIFEST_NAME


def _has_control_characters(value):
    return any(ord(character) < 32 or ord(character) == 127 for character in value)


def normalize_public_path(raw):
    """Return a safe manifest-relative path, or None for anything suspicious."""
    if not isinstance(raw, str):
        return None
    if not raw or len(raw) > MAX_PATH_LENGTH:
        return None
    try:
        value = unquote(raw)
    except (UnicodeError, ValueError):
        return None
    if not value or len(value) > MAX_PATH_LENGTH:
        return None
    if value.startswith('/') or '\\' in value or ':' in value:
        return None
    if '?' in value or '#' in value or _has_control_characters(value):
        return None
    parts = value.split('/')
    if any(not part or part in ('.', '..') or part.startswith('.') for part in parts):
        return None
    return '/'.join(parts)


def load_public_paths(manifest_path=None):
    """Read the manifest allowlist. Any read/shape error fails closed."""
    path = Path(manifest_path) if manifest_path is not None else public_manifest_path()
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, UnicodeError, ValueError, TypeError):
        return frozenset()
    files = data.get('files') if isinstance(data, dict) else None
    if not isinstance(files, list):
        return frozenset()
    allowed = set()
    for entry in files:
        if not isinstance(entry, dict):
            continue
        normalized = normalize_public_path(entry.get('path'))
        if normalized:
            allowed.add(normalized)
    return frozenset(allowed)


@require_safe
def public_file(request, path=''):
    requested = normalize_public_path(path or INDEX_PATH)
    if not requested or requested not in load_public_paths():
        raise Http404('Public file is not allowlisted.')

    root = public_root()
    try:
        candidate = (root / requested).resolve()
    except (OSError, RuntimeError):
        raise Http404('Public file is unavailable.')
    if not candidate.is_relative_to(root) or not candidate.is_file():
        raise Http404('Public file is unavailable.')

    content_type = mimetypes.guess_type(candidate.name)[0] or 'application/octet-stream'
    try:
        handle = candidate.open('rb')
    except OSError:
        raise Http404('Public file is unavailable.')
    return FileResponse(handle, content_type=content_type)


@require_safe
def health(request):
    return JsonResponse({'status': 'ok'})