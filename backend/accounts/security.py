"""Failed-attempt throttling and forwarded-client addressing.

Django settings take precedence over environment variables so the module also
works in standalone account tests.
"""
import hashlib
import os

from django.conf import settings
from django.core.cache import cache

DEFAULT_MAX_ATTEMPTS = 10
DEFAULT_WINDOW_SECONDS = 300
DEFAULT_TRUSTED_PROXY_IPS = ('127.0.0.1', '::1')
KEY_PREFIX = 'ouronex:auth-throttle'

WEB_LOGIN_SCOPE = 'web-login'
API_LOGIN_SCOPE = 'api-login'
REGISTER_SCOPE = 'register'


def configured(name, default=None):
    """Read a Django setting first, then its environment fallback."""
    value = getattr(settings, name, None)
    if value is None or value == '':
        value = os.environ.get(name)
    if value is None or value == '':
        return default
    return value


def _positive_int(name, default):
    raw = configured(name)
    if raw is None:
        return default
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default


def max_attempts():
    return _positive_int('OURONEX_AUTH_MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS)


def window_seconds():
    return _positive_int('OURONEX_AUTH_WINDOW_SECONDS', DEFAULT_WINDOW_SECONDS)


def trusted_proxy_ips():
    raw = configured('OURONEX_TRUSTED_PROXY_IPS')
    if raw is None:
        return DEFAULT_TRUSTED_PROXY_IPS
    if isinstance(raw, str):
        items = tuple(part.strip() for part in raw.split(',') if part.strip())
    else:
        items = tuple(str(part).strip() for part in raw if str(part).strip())
    return items or DEFAULT_TRUSTED_PROXY_IPS


def client_ip(request):
    """Client address, honouring X-Forwarded-For only from trusted proxies."""
    remote = (request.META.get('REMOTE_ADDR') or '').strip()
    forwarded = (request.META.get('HTTP_X_FORWARDED_FOR') or '').strip()
    if forwarded and remote and remote in trusted_proxy_ips():
        candidate = forwarded.split(',')[0].strip()
        if candidate:
            return candidate
    return remote or 'unknown'


def throttle_key(scope, ip):
    """Opaque cache key: the client address never appears in clear text."""
    digest = hashlib.sha256(('%s|%s' % (scope, ip)).encode('utf-8')).hexdigest()
    return '%s:%s:%s' % (KEY_PREFIX, scope, digest)


def _key(scope, request):
    return throttle_key(scope, client_ip(request))


def attempt_count(scope, request):
    return int(cache.get(_key(scope, request)) or 0)


def is_throttled(scope, request):
    return attempt_count(scope, request) >= max_attempts()


def _ttl(key):
    getter = getattr(cache, 'ttl', None)
    if callable(getter):
        try:
            ttl = getter(key)
        except Exception:  # pragma: no cover - backends without TTL support
            return None
        if isinstance(ttl, int) and ttl > 0:
            return ttl
    return None


def retry_after_seconds(scope, request):
    ttl = _ttl(_key(scope, request))
    if ttl is not None:
        return ttl
    return window_seconds()


def _increment(key):
    cache.add(key, 0, window_seconds())
    try:
        cache.incr(key)
    except ValueError:
        cache.set(key, 1, window_seconds())
    return int(cache.get(key) or 0)


def record_failure(scope, request):
    return _increment(_key(scope, request))


def normalize_username(username):
    """Usernames are compared case-insensitively and without outer whitespace."""
    return str(username or '').strip().casefold()


def account_key(scope, request, username):
    """Bucket for one account seen from one address: scope + address + username."""
    return throttle_key(
        '%s:account' % scope,
        '%s|%s' % (client_ip(request), normalize_username(username)),
    )


def account_attempt_count(scope, request, username):
    return int(cache.get(account_key(scope, request, username)) or 0)


def is_login_throttled(scope, request, username):
    """A login is refused when either the address bucket or the account bucket is full."""
    return (
        attempt_count(scope, request) >= max_attempts()
        or account_attempt_count(scope, request, username) >= max_attempts()
    )


def record_login_failure(scope, request, username):
    """Every failed login counts against both the address and the account bucket."""
    record_failure(scope, request)
    _increment(account_key(scope, request, username))
    return attempt_count(scope, request)


def clear_login_success(scope, request, username):
    """A success releases only its own account bucket; the address bucket keeps counting."""
    cache.delete(account_key(scope, request, username))


def login_retry_after_seconds(scope, request, username):
    if account_attempt_count(scope, request, username) >= max_attempts():
        ttl = _ttl(account_key(scope, request, username))
        if ttl is not None:
            return ttl
    return retry_after_seconds(scope, request)