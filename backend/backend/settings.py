"""OuroNex Django settings.

Development keeps convenient local defaults. Production fails closed when
required deployment values are absent or unsafe.
"""
import ipaddress
import math
import os
from pathlib import Path
from urllib.parse import urlsplit

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent

# Clearly marked local-only fallback. Production requires OURONEX_SECRET_KEY.
DEV_SECRET_KEY = 'django-insecure-ouronex-local-development-only-do-not-deploy'
DEV_ALLOWED_HOSTS = ['localhost', '127.0.0.1', 'testserver']
VALIDATOR_NAMES = (
    'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    'django.contrib.auth.password_validation.MinimumLengthValidator',
    'django.contrib.auth.password_validation.CommonPasswordValidator',
    'django.contrib.auth.password_validation.NumericPasswordValidator',
)
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_DIRS = [BASE_DIR / 'static']
# Production serves the public package next to the app tree; development
# serves the repository tree. Only the app manifest allowlist selects files.
PUBLIC_ROOT = REPO_ROOT.parent / 'public'


def _env_value(environ, name, default=None):
    raw = environ.get(name)
    if raw is None:
        return default
    if not isinstance(raw, str):
        raw = str(raw)
    value = raw.strip()
    return value if value else default


def _required(environ, name):
    value = _env_value(environ, name)
    if not value:
        raise ImproperlyConfigured('%s is required in production.' % name)
    return value


def _csv_parts(raw):
    # Keep empty segments so a typo such as "a,,b" fails closed.
    return [part.strip() for part in raw.split(',')]


def _parse_hosts(raw):
    hosts = _csv_parts(raw)
    if not hosts or any(not host for host in hosts):
        raise ImproperlyConfigured('OURONEX_ALLOWED_HOSTS contains an empty host.')
    if any('*' in host for host in hosts):
        raise ImproperlyConfigured('OURONEX_ALLOWED_HOSTS must not contain wildcards.')
    return hosts


def _parse_origins(raw):
    origins = []
    seen = set()
    for origin in _csv_parts(raw):
        if not origin:
            raise ImproperlyConfigured('OURONEX_CSRF_TRUSTED_ORIGINS contains an empty origin.')
        if '*' in origin:
            raise ImproperlyConfigured('OURONEX_CSRF_TRUSTED_ORIGINS must not contain wildcards.')
        parsed = urlsplit(origin)
        if parsed.scheme != 'https' or not parsed.netloc or parsed.path not in ('', '/'):
            raise ImproperlyConfigured(
                'OURONEX_CSRF_TRUSTED_ORIGINS entries must be HTTPS origins without paths.'
            )
        if parsed.query or parsed.fragment or parsed.username or parsed.password:
            raise ImproperlyConfigured(
                'OURONEX_CSRF_TRUSTED_ORIGINS entries must be plain HTTPS origins.'
            )
        normalized = '%s://%s' % (parsed.scheme, parsed.netloc)
        if normalized not in seen:
            seen.add(normalized)
            origins.append(normalized)
    if not origins:
        raise ImproperlyConfigured('OURONEX_CSRF_TRUSTED_ORIGINS must not be empty.')
    return origins


def _parse_proxy_ips(raw):
    proxies = []
    for value in _csv_parts(raw):
        if not value:
            raise ImproperlyConfigured('OURONEX_TRUSTED_PROXY_IPS contains an empty entry.')
        try:
            proxies.append(str(ipaddress.ip_address(value)))
        except ValueError as error:
            raise ImproperlyConfigured(
                'OURONEX_TRUSTED_PROXY_IPS contains an invalid IP address.'
            ) from error
    if not proxies:
        raise ImproperlyConfigured('OURONEX_TRUSTED_PROXY_IPS must not be empty.')
    return tuple(proxies)


def _positive_int(environ, name, default):
    raw = _env_value(environ, name)
    if raw is None:
        return default
    try:
        value = int(raw, 10)
    except (TypeError, ValueError) as error:
        raise ImproperlyConfigured('%s must be a positive integer.' % name) from error
    if value <= 0:
        raise ImproperlyConfigured('%s must be a positive integer.' % name)
    return value


def _nonnegative_int(environ, name, default):
    raw = _env_value(environ, name)
    if raw is None:
        return default
    try:
        value = int(raw, 10)
    except (TypeError, ValueError) as error:
        raise ImproperlyConfigured('%s must be a nonnegative integer.' % name) from error
    if value < 0:
        raise ImproperlyConfigured('%s must be a nonnegative integer.' % name)
    return value


def _positive_float(environ, name, default):
    raw = _env_value(environ, name)
    if raw is None:
        return default
    try:
        value = float(raw)
    except (TypeError, ValueError) as error:
        raise ImproperlyConfigured('%s must be a positive number.' % name) from error
    if not math.isfinite(value) or value <= 0:
        raise ImproperlyConfigured('%s must be a positive number.' % name)
    return value


def _database_path(environ, production):
    raw = _env_value(environ, 'OURONEX_DB_PATH')
    if raw is None:
        if production:
            raise ImproperlyConfigured('OURONEX_DB_PATH is required in production.')
        return BASE_DIR / 'db.sqlite3'
    path = Path(raw).expanduser()
    if not path.is_absolute():
        raise ImproperlyConfigured('OURONEX_DB_PATH must be an absolute path.')
    path = path.resolve()
    if production and path.is_relative_to(REPO_ROOT.parent):
        raise ImproperlyConfigured('OURONEX_DB_PATH must be outside the release root (app and public).')
    return path


def build_config(environ=None):
    """Build the environment-dependent settings.

    Kept as a pure function so production fail-closed behavior can be tested
    without reloading Django or touching a database.
    """
    env = os.environ if environ is None else environ
    mode = _env_value(env, 'OURONEX_ENV', 'development').lower()
    if mode not in ('development', 'production'):
        raise ImproperlyConfigured('OURONEX_ENV must be development or production.')
    production = mode == 'production'

    if production:
        secret_key = _required(env, 'OURONEX_SECRET_KEY')
        if len(secret_key) < 50:
            raise ImproperlyConfigured('OURONEX_SECRET_KEY must be at least 50 characters.')
        if secret_key.startswith('django-insecure-'):
            raise ImproperlyConfigured('OURONEX_SECRET_KEY must not be a development placeholder.')
        if len(set(secret_key)) < 5:
            raise ImproperlyConfigured('OURONEX_SECRET_KEY must have sufficient character diversity.')
        allowed_hosts = _parse_hosts(_required(env, 'OURONEX_ALLOWED_HOSTS'))
        csrf_origins = _parse_origins(_required(env, 'OURONEX_CSRF_TRUSTED_ORIGINS'))
    else:
        secret_key = _env_value(env, 'OURONEX_SECRET_KEY', DEV_SECRET_KEY)
        raw_hosts = _env_value(env, 'OURONEX_ALLOWED_HOSTS')
        allowed_hosts = _parse_hosts(raw_hosts) if raw_hosts else list(DEV_ALLOWED_HOSTS)
        raw_origins = _env_value(env, 'OURONEX_CSRF_TRUSTED_ORIGINS')
        csrf_origins = _parse_origins(raw_origins) if raw_origins else []

    database_path = _database_path(env, production)
    public_site_root = PUBLIC_ROOT if production else REPO_ROOT
    timeout = _positive_float(env, 'OURONEX_SQLITE_TIMEOUT_SECONDS', 30.0)
    hsts = _nonnegative_int(env, 'OURONEX_SECURE_HSTS_SECONDS', 0)
    proxies = _parse_proxy_ips(_env_value(env, 'OURONEX_TRUSTED_PROXY_IPS', '127.0.0.1,::1'))
    auth_attempts = _positive_int(env, 'OURONEX_AUTH_MAX_ATTEMPTS', 10)
    auth_window = _positive_int(env, 'OURONEX_AUTH_WINDOW_SECONDS', 300)
    token_ttl = _positive_int(env, 'OURONEX_AUTH_TOKEN_TTL_SECONDS', 2592000)

    return {
        'OURONEX_ENV': mode,
        'DEBUG': not production,
        'SECRET_KEY': secret_key,
        'ALLOWED_HOSTS': allowed_hosts,
        'CSRF_TRUSTED_ORIGINS': csrf_origins,
        'DATABASES': {
            'default': {
                'ENGINE': 'django.db.backends.sqlite3',
                'NAME': database_path,
                'OPTIONS': {'timeout': timeout},
            },
        },
        'OURONEX_DB_PATH': str(database_path),
        'OURONEX_SQLITE_TIMEOUT_SECONDS': timeout,
        'OURONEX_SECURE_HSTS_SECONDS': hsts,
        'OURONEX_TRUSTED_PROXY_IPS': proxies,
        'OURONEX_AUTH_MAX_ATTEMPTS': auth_attempts,
        'OURONEX_AUTH_WINDOW_SECONDS': auth_window,
        'OURONEX_AUTH_TOKEN_TTL_SECONDS': token_ttl,
        'STATIC_URL': STATIC_URL,
        'STATIC_ROOT': STATIC_ROOT,
        'STATICFILES_DIRS': STATICFILES_DIRS,
        'STATIC_SITE_ROOT': public_site_root,
        'MIDDLEWARE': MIDDLEWARE,
        'AUTH_PASSWORD_VALIDATORS': [{'NAME': name} for name in VALIDATOR_NAMES],
        'SESSION_COOKIE_SECURE': production,
        'CSRF_COOKIE_SECURE': production,
        'SESSION_COOKIE_HTTPONLY': True,
        'SESSION_COOKIE_SAMESITE': 'Lax',
        'CSRF_COOKIE_SAMESITE': 'Lax',
        'SECURE_PROXY_SSL_HEADER': ('HTTP_X_FORWARDED_PROTO', 'https') if production else None,
        'SECURE_SSL_REDIRECT': production,
        'SECURE_HSTS_SECONDS': hsts,
    }


CONFIG = build_config()
globals().update(CONFIG)

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'accounts',
]

ROOT_URLCONF = 'backend.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'backend.wsgi.application'

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Login/Logout
LOGIN_REDIRECT_URL = '/dashboard/'
LOGOUT_REDIRECT_URL = '/'
LOGIN_URL = '/login/'
