"""Focused deployment checks for settings, public routing and release layout.

All secrets and database paths in this module are non-secret dummy values.
"""
import importlib
import json
import re
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ElementTree
from pathlib import Path
from unittest import mock

from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase, TestCase, override_settings

from backend import settings as project_settings


TEMP_PREFIX = 'ouro-release-layout-'
PROD_DB = 'D:/tmp/' + TEMP_PREFIX + 'dummy/db.sqlite3'
VALID_SECRET = 'dummy-only-not-a-real-secret-A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0'
CSRF_MIDDLEWARE = 'django.middleware.csrf.CsrfViewMiddleware'
VALIDATOR_NAMES = {
    'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    'django.contrib.auth.password_validation.MinimumLengthValidator',
    'django.contrib.auth.password_validation.CommonPasswordValidator',
    'django.contrib.auth.password_validation.NumericPasswordValidator',
}
CONTACT_URL_MARKERS = ('contact.html', '/contact/')
CONTACT_CONTROL_KEYS = (
    'shared.contact.b37456',
    'arena.tell-us-what-you-need.9ef53e',
)
ANCHOR_PATTERN = re.compile(r'<a\b[^>]*>.*?</a>', re.IGNORECASE | re.DOTALL)
HREF_PATTERN = re.compile(r'href="([^"]*)"', re.IGNORECASE)


def repo_root():
    return Path(project_settings.REPO_ROOT)


def manifest_entries():
    manifest = repo_root() / 'package-manifest.json'
    payload = json.loads(manifest.read_text(encoding='utf-8'))
    return payload['files']


def manifest_paths():
    entries = manifest_entries()
    return {
        entry['path']
        for entry in entries
        if isinstance(entry, dict) and isinstance(entry.get('path'), str)
    }


def retained_public_pages():
    root = repo_root()
    pages = [root / '404.html', root / 'arena.html']
    pages.extend(sorted((root / 'news').glob('*.html')))
    return [page for page in pages if page.is_file()]


def production_env(**overrides):
    env = {
        'OURONEX_ENV': 'production',
        'OURONEX_SECRET_KEY': VALID_SECRET,
        'OURONEX_ALLOWED_HOSTS': 'ouro.internal, 10.0.0.5',
        'OURONEX_CSRF_TRUSTED_ORIGINS': 'https://ouro.internal/',
        'OURONEX_DB_PATH': PROD_DB,
        'OURONEX_SQLITE_TIMEOUT_SECONDS': '12',
        'OURONEX_SECURE_HSTS_SECONDS': '31536000',
        'OURONEX_TRUSTED_PROXY_IPS': '127.0.0.1, 10.0.0.9',
        'OURONEX_AUTH_MAX_ATTEMPTS': '3',
        'OURONEX_AUTH_WINDOW_SECONDS': '60',
    }
    env.update(overrides)
    return env


class ProductionConfigTests(SimpleTestCase):
    def test_valid_production_configuration(self):
        config = project_settings.build_config(production_env())
        self.assertFalse(config['DEBUG'])
        self.assertEqual(config['SECRET_KEY'], VALID_SECRET)
        self.assertEqual(config['ALLOWED_HOSTS'], ['ouro.internal', '10.0.0.5'])
        self.assertEqual(config['CSRF_TRUSTED_ORIGINS'], ['https://ouro.internal'])
        database = config['DATABASES']['default']
        self.assertEqual(database['ENGINE'], 'django.db.backends.sqlite3')
        self.assertEqual(Path(database['NAME']), Path(PROD_DB))
        self.assertEqual(database['OPTIONS']['timeout'], 12.0)
        self.assertEqual(config['OURONEX_DB_PATH'], str(Path(PROD_DB)))
        self.assertTrue(config['SESSION_COOKIE_SECURE'])
        self.assertTrue(config['CSRF_COOKIE_SECURE'])
        self.assertTrue(config['SESSION_COOKIE_HTTPONLY'])
        self.assertEqual(config['SESSION_COOKIE_SAMESITE'], 'Lax')
        self.assertEqual(config['CSRF_COOKIE_SAMESITE'], 'Lax')
        self.assertEqual(config['SECURE_PROXY_SSL_HEADER'], ('HTTP_X_FORWARDED_PROTO', 'https'))
        self.assertTrue(config['SECURE_SSL_REDIRECT'])
        self.assertEqual(config['SECURE_HSTS_SECONDS'], 31536000)
        self.assertEqual(config['OURONEX_TRUSTED_PROXY_IPS'], ('127.0.0.1', '10.0.0.9'))
        self.assertEqual(config['OURONEX_AUTH_MAX_ATTEMPTS'], 3)
        self.assertEqual(config['OURONEX_AUTH_WINDOW_SECONDS'], 60)
        self.assertEqual(config['OURONEX_AUTH_TOKEN_TTL_SECONDS'], 2592000)
        self.assertEqual(config['STATIC_URL'], '/static/')
        public_root = Path(project_settings.REPO_ROOT).parent / 'public'
        self.assertEqual(Path(config['STATIC_SITE_ROOT']), public_root)
        self.assertNotEqual(Path(config['STATIC_ROOT']).resolve(), public_root.resolve())
        self.assertNotIn(public_root.resolve(), {Path(path).resolve() for path in config['STATICFILES_DIRS']})
        self.assertNotIn(
            Path(project_settings.REPO_ROOT).resolve(),
            {Path(path).resolve() for path in config['STATICFILES_DIRS']},
        )
        self.assertIn(CSRF_MIDDLEWARE, config['MIDDLEWARE'])
        self.assertEqual(
            {entry['NAME'] for entry in config['AUTH_PASSWORD_VALIDATORS']},
            VALIDATOR_NAMES,
        )

    def test_development_defaults_are_safe_and_compatible(self):
        config = project_settings.build_config({})
        self.assertTrue(config['DEBUG'])
        self.assertIn('development', config['SECRET_KEY'].lower())
        self.assertEqual(config['ALLOWED_HOSTS'], ['localhost', '127.0.0.1', 'testserver'])
        self.assertEqual(config['CSRF_TRUSTED_ORIGINS'], [])
        database = config['DATABASES']['default']
        self.assertEqual(Path(database['NAME']), Path(project_settings.BASE_DIR) / 'db.sqlite3')
        self.assertEqual(database['OPTIONS']['timeout'], 30.0)
        self.assertFalse(config['SESSION_COOKIE_SECURE'])
        self.assertFalse(config['CSRF_COOKIE_SECURE'])
        self.assertTrue(config['SESSION_COOKIE_HTTPONLY'])
        self.assertEqual(config['SESSION_COOKIE_SAMESITE'], 'Lax')
        self.assertFalse(config['SECURE_SSL_REDIRECT'])
        self.assertIsNone(config['SECURE_PROXY_SSL_HEADER'])
        self.assertEqual(config['SECURE_HSTS_SECONDS'], 0)
        self.assertEqual(config['OURONEX_TRUSTED_PROXY_IPS'], ('127.0.0.1', '::1'))
        self.assertEqual(config['OURONEX_AUTH_MAX_ATTEMPTS'], 10)
        self.assertEqual(config['OURONEX_AUTH_WINDOW_SECONDS'], 300)
        self.assertEqual(config['OURONEX_AUTH_TOKEN_TTL_SECONDS'], 2592000)
        self.assertEqual(config['STATIC_URL'], '/static/')
        self.assertEqual(Path(config['STATIC_SITE_ROOT']), Path(project_settings.REPO_ROOT))

    def test_unknown_environment_is_rejected(self):
        with self.assertRaises(ImproperlyConfigured):
            project_settings.build_config(production_env(OURONEX_ENV='staging'))

    def test_production_requires_secret_key(self):
        env = production_env()
        env.pop('OURONEX_SECRET_KEY')
        with self.assertRaises(ImproperlyConfigured):
            project_settings.build_config(env)

    def test_production_requires_long_secret_key(self):
        with self.assertRaises(ImproperlyConfigured):
            project_settings.build_config(production_env(OURONEX_SECRET_KEY='short'))

    def test_production_rejects_django_insecure_placeholder(self):
        placeholder = 'django-insecure-' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0'
        with self.assertRaises(ImproperlyConfigured):
            project_settings.build_config(production_env(OURONEX_SECRET_KEY=placeholder))

    def test_production_rejects_repeated_low_entropy_secret(self):
        for secret in ('A' * 50, 'AB' * 25, 'ABCD' * 13):
            with self.subTest(secret=secret), self.assertRaises(ImproperlyConfigured):
                project_settings.build_config(production_env(OURONEX_SECRET_KEY=secret))

    def test_production_requires_allowed_hosts(self):
        env = production_env()
        env.pop('OURONEX_ALLOWED_HOSTS')
        with self.assertRaises(ImproperlyConfigured):
            project_settings.build_config(env)

    def test_production_rejects_wildcard_allowed_hosts(self):
        with self.assertRaises(ImproperlyConfigured):
            project_settings.build_config(production_env(OURONEX_ALLOWED_HOSTS='*'))

    def test_production_requires_csrf_trusted_origins(self):
        env = production_env()
        env.pop('OURONEX_CSRF_TRUSTED_ORIGINS')
        with self.assertRaises(ImproperlyConfigured):
            project_settings.build_config(env)

    def test_production_rejects_non_https_csrf_origins(self):
        for origin in ('http://ouro.internal', 'https://ouro.internal/path', 'https://*.internal'):
            with self.subTest(origin=origin), self.assertRaises(ImproperlyConfigured):
                project_settings.build_config(production_env(OURONEX_CSRF_TRUSTED_ORIGINS=origin))

    def test_production_requires_db_path(self):
        env = production_env()
        env.pop('OURONEX_DB_PATH')
        with self.assertRaises(ImproperlyConfigured):
            project_settings.build_config(env)

    def test_production_rejects_relative_db_path(self):
        with self.assertRaises(ImproperlyConfigured):
            project_settings.build_config(production_env(OURONEX_DB_PATH='backend/db.sqlite3'))

    def test_production_rejects_db_path_inside_repository(self):
        inside = str((Path(project_settings.BASE_DIR) / 'db.sqlite3').resolve())
        with self.assertRaises(ImproperlyConfigured):
            project_settings.build_config(production_env(OURONEX_DB_PATH=inside))

    def test_sqlite_timeout_defaults_and_custom(self):
        default = project_settings.build_config({})
        self.assertEqual(default['DATABASES']['default']['OPTIONS']['timeout'], 30.0)
        custom = project_settings.build_config(production_env())
        self.assertEqual(custom['DATABASES']['default']['OPTIONS']['timeout'], 12.0)

    def test_invalid_sqlite_timeout_is_rejected(self):
        for value in ('0', '-1', 'nan', 'not-a-number'):
            with self.subTest(value=value), self.assertRaises(ImproperlyConfigured):
                project_settings.build_config(production_env(OURONEX_SQLITE_TIMEOUT_SECONDS=value))

    def test_hsts_defaults_to_zero_and_configuration_is_optional(self):
        self.assertEqual(project_settings.build_config({})['SECURE_HSTS_SECONDS'], 0)
        env = production_env()
        env.pop('OURONEX_SECURE_HSTS_SECONDS')
        self.assertEqual(project_settings.build_config(env)['SECURE_HSTS_SECONDS'], 0)

    def test_invalid_hsts_is_rejected(self):
        for value in ('-1', 'not-a-number'):
            with self.subTest(value=value), self.assertRaises(ImproperlyConfigured):
                project_settings.build_config(production_env(OURONEX_SECURE_HSTS_SECONDS=value))

    def test_trusted_proxy_defaults_and_custom_values(self):
        default = project_settings.build_config({})
        self.assertEqual(default['OURONEX_TRUSTED_PROXY_IPS'], ('127.0.0.1', '::1'))
        custom = project_settings.build_config(production_env())
        self.assertEqual(custom['OURONEX_TRUSTED_PROXY_IPS'], ('127.0.0.1', '10.0.0.9'))

    def test_invalid_trusted_proxy_is_rejected(self):
        for value in ('127.0.0.1,not-an-ip', '127.0.0.1,,::1'):
            with self.subTest(value=value), self.assertRaises(ImproperlyConfigured):
                project_settings.build_config(production_env(OURONEX_TRUSTED_PROXY_IPS=value))

    def test_auth_throttle_settings_are_bounded_positive_integers(self):
        for name in ('OURONEX_AUTH_MAX_ATTEMPTS', 'OURONEX_AUTH_WINDOW_SECONDS'):
            for value in ('0', '-1', 'not-a-number'):
                with self.subTest(name=name, value=value), self.assertRaises(ImproperlyConfigured):
                    project_settings.build_config(production_env(**{name: value}))

    def test_requirements_pin_django_and_waitress(self):
        requirements = (Path(project_settings.BASE_DIR) / 'requirements.txt').read_text(encoding='utf-8')
        lines = {line.strip() for line in requirements.splitlines() if line.strip() and not line.strip().startswith('#')}
        self.assertIn('Django==6.1.2', lines)
        self.assertIn('waitress==3.0.2', lines)
        self.assertNotIn('gunicorn>=23.0', lines)
        self.assertFalse(any('gunicorn' in line.lower() for line in lines))

    def test_live_settings_enable_csrf_and_password_validation(self):
        self.assertIn(CSRF_MIDDLEWARE, project_settings.MIDDLEWARE)
        self.assertEqual(
            {entry['NAME'] for entry in project_settings.AUTH_PASSWORD_VALIDATORS},
            VALIDATOR_NAMES,
        )

    def test_live_static_settings_do_not_collect_the_repository_root(self):
        self.assertEqual(project_settings.STATIC_URL, '/static/')
        self.assertTrue(project_settings.STATIC_ROOT)
        repo_root = Path(project_settings.STATIC_SITE_ROOT).resolve()
        self.assertNotEqual(Path(project_settings.STATIC_ROOT).resolve(), repo_root)
        self.assertNotIn(repo_root, {Path(path).resolve() for path in project_settings.STATICFILES_DIRS})


class ReleaseRootDatabaseTests(SimpleTestCase):
    def _release_layout(self):
        base = Path(tempfile.mkdtemp(dir='D:/tmp', prefix=TEMP_PREFIX))
        release = base / 'releases' / 'r1'
        app = release / 'app'
        public = release / 'public'
        (app / 'backend').mkdir(parents=True)
        public.mkdir(parents=True)
        current = base / 'current'
        subprocess.run(
            ['cmd.exe', '/c', 'mklink', '/J', str(current), str(release)],
            check=True,
            capture_output=True,
        )

        def cleanup():
            if current.exists():
                subprocess.run(['cmd.exe', '/c', 'rmdir', str(current)], check=False, capture_output=True)
            shutil.rmtree(base, ignore_errors=True)

        self.addCleanup(cleanup)
        return base, release, app, public, current

    def test_release_root_and_public_database_paths_are_rejected(self):
        base, release, app, public, current = self._release_layout()
        paths = {
            'public': public / 'db.sqlite3',
            'release-root': release / 'db.sqlite3',
            'current-public': current / 'public' / 'db.sqlite3',
            'current-release-root': current / 'db.sqlite3',
        }
        self.assertEqual(
            (current / 'public' / 'db.sqlite3').resolve(),
            (public / 'db.sqlite3').resolve(),
        )
        with mock.patch.object(project_settings, 'REPO_ROOT', app):
            for label, database_path in paths.items():
                with self.subTest(label=label), self.assertRaises(ImproperlyConfigured):
                    project_settings.build_config(production_env(OURONEX_DB_PATH=str(database_path)))

    def test_external_shared_data_database_path_is_accepted(self):
        base, release, app, public, current = self._release_layout()
        external = base / 'shared' / 'data' / 'db.sqlite3'
        with mock.patch.object(project_settings, 'REPO_ROOT', app):
            config = project_settings.build_config(production_env(OURONEX_DB_PATH=str(external)))
        self.assertEqual(Path(config['DATABASES']['default']['NAME']), external.resolve())


class PublicSitePathTests(SimpleTestCase):
    def setUp(self):
        self.public_site = importlib.import_module('backend.public_site')

    def test_normalize_accepts_manifest_style_paths(self):
        for value in ('index.html', 'assets/site.css', 'news/sample-hong-kong-gba.html'):
            with self.subTest(value=value):
                self.assertEqual(self.public_site.normalize_public_path(value), value)

    def test_normalize_rejects_traversal_absolute_and_private_paths(self):
        for value in (
            '', None, '/index.html', '../backend/db.sqlite3', 'assets/../settings.py',
            'assets\\site.css', 'C:/Windows/win.ini', '//host/share', '.git/config',
            'assets//site.css', 'assets/site.css/', '%2e%2e/backend/db.sqlite3',
            'index.html\x00', 'index.html?x=1', 'index.html#fragment',
        ):
            with self.subTest(value=value):
                self.assertIsNone(self.public_site.normalize_public_path(value))

    def test_manifest_loader_ignores_unsafe_entries(self):
        directory = Path(tempfile.mkdtemp(dir='D:/tmp', prefix=TEMP_PREFIX))
        self.addCleanup(shutil.rmtree, directory, ignore_errors=True)
        manifest = directory / 'package-manifest.json'
        manifest.write_text(json.dumps({'files': [
            {'path': 'index.html'},
            {'path': 'assets/site.css'},
            {'path': '../backend/db.sqlite3'},
            {'path': '/etc/passwd'},
            {'path': 'assets\\site.css'},
            {'path': '.git/config'},
            {'path': ''},
            {'not-path': 'index.html'},
            'not-an-object',
        ]}), encoding='utf-8')
        allowed = self.public_site.load_public_paths(manifest)
        self.assertEqual(allowed, frozenset({'index.html', 'assets/site.css'}))

    def test_manifest_loader_fails_closed_on_missing_or_malformed_files(self):
        directory = Path(tempfile.mkdtemp(dir='D:/tmp', prefix=TEMP_PREFIX))
        self.addCleanup(shutil.rmtree, directory, ignore_errors=True)
        self.assertEqual(self.public_site.load_public_paths(directory / 'missing.json'), frozenset())
        malformed = directory / 'malformed.json'
        malformed.write_text('{not json', encoding='utf-8')
        self.assertEqual(self.public_site.load_public_paths(malformed), frozenset())
        wrong_shape = directory / 'wrong-shape.json'
        wrong_shape.write_text('{"files": "index.html"}', encoding='utf-8')
        self.assertEqual(self.public_site.load_public_paths(wrong_shape), frozenset())


class ReleaseLayoutTests(TestCase):
    def test_public_package_is_served_from_app_manifest(self):
        base = Path(tempfile.mkdtemp(dir='D:/tmp', prefix=TEMP_PREFIX))
        self.addCleanup(shutil.rmtree, base, ignore_errors=True)
        current = base / 'current'
        app_root = current / 'app'
        app_backend = app_root / 'backend'
        public_root = current / 'public'
        (public_root / 'assets').mkdir(parents=True)
        app_backend.mkdir(parents=True)
        (app_root / 'index.html').write_text('APP PACKAGE PAGE', encoding='utf-8')
        (public_root / 'index.html').write_text('PUBLIC PACKAGE PAGE', encoding='utf-8')
        (public_root / 'assets' / 'site.css').write_text('public package css', encoding='utf-8')
        (app_root / 'package-manifest.json').write_text(json.dumps({'files': [
            {'path': 'index.html'},
            {'path': 'assets/site.css'},
        ]}), encoding='utf-8')
        (app_backend / 'db.sqlite3').write_text('not a real database', encoding='utf-8')

        public_site = importlib.import_module('backend.public_site')
        with override_settings(BASE_DIR=app_backend, STATIC_SITE_ROOT=public_root):
            self.assertEqual(public_site.public_manifest_path(), app_root / 'package-manifest.json')
            root = self.client.get('/')
            self.assertEqual(root.status_code, 200)
            content = b''.join(root.streaming_content)
            self.assertIn(b'PUBLIC PACKAGE PAGE', content)
            self.assertNotIn(b'APP PACKAGE PAGE', content)
            asset = self.client.get('/assets/site.css')
            self.assertEqual(asset.status_code, 200)
            self.assertEqual(b''.join(asset.streaming_content), b'public package css')
            for private in ('/backend/db.sqlite3', '/package-manifest.json'):
                with self.subTest(private=private):
                    self.assertEqual(self.client.head(private).status_code, 404)
            self.assertEqual(self.client.head('/../backend/db.sqlite3').status_code, 404)


class PublicSitePageTests(TestCase):
    def test_root_serves_index_html_directly(self):
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response['Content-Type'].startswith('text/html'))
        self.assertIn(b'home-scroll', b''.join(response.streaming_content))

    def test_manifest_allowlisted_pages_and_assets_are_served(self):
        for path, content_type in (
            ('/index.html', 'text/html'),
            ('/arena.html', 'text/html'),
            ('/assets/site.css', 'text/css'),
        ):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response['Content-Type'].startswith(content_type))

    def test_health_returns_a_minimal_non_sensitive_json_response(self):
        response = self.client.get('/health/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'status': 'ok'})
        body = response.content.decode('utf-8').lower()
        for forbidden in ('secret', 'password', 'sqlite', 'allowed_hosts', 'ouronex_'):
            self.assertNotIn(forbidden, body)

    def test_private_files_are_not_served(self):
        for path in (
            '/backend/db.sqlite3',
            '/backend/backend/settings.py',
            '/.git/config',
            '/docs/APPLICATION_AUTH_API.md',
            '/package-manifest.json',
            '/start-local.cmd',
        ):
            with self.subTest(path=path):
                response = self.client.head(path)
                self.assertEqual(response.status_code, 404, '%s exposed' % path)

    def test_existing_files_not_in_the_manifest_are_not_served(self):
        for path in ('/start-local.cmd', '/package-manifest.json'):
            with self.subTest(path=path):
                self.assertEqual(self.client.head(path).status_code, 404)

    def test_retired_pages_return_404(self):
        for page in (
            'news.html', 'platform.html', 'pricing.html', 'business.html', 'about-us.html',
            'contact.html', 'contact/',
        ):
            with self.subTest(page=page):
                self.assertEqual(self.client.get('/' + page).status_code, 404, page)

    def test_retired_contact_urls_return_404_for_every_method_probe(self):
        for path in ('/contact.html', '/contact/', '/contact/index.html', '/contact'):
            with self.subTest(path=path):
                self.assertEqual(self.client.head(path).status_code, 404, path)

    def test_traversal_and_unknown_paths_return_404(self):
        for path in (
            '/../backend/db.sqlite3',
            '/%2e%2e/backend/db.sqlite3',
            '/assets/../../backend/db.sqlite3',
            '/%2e%2e%2fbackend%2fdb.sqlite3',
            '/..%2fbackend%2fdb.sqlite3',
            '/assets/%2e%2e/%2e%2e/backend/db.sqlite3',
            '/C:/Windows/win.ini',
            '/not-a-real-page',
            '/assets/',
        ):
            with self.subTest(path=path):
                response = self.client.head(path)
                self.assertEqual(response.status_code, 404, '%s returned %s' % (path, response.status_code))

    def test_temporary_manifest_is_the_only_allowlist(self):
        public_site = importlib.import_module('backend.public_site')
        directory = Path(tempfile.mkdtemp(dir='D:/tmp', prefix=TEMP_PREFIX))
        self.addCleanup(shutil.rmtree, directory, ignore_errors=True)
        manifest = directory / 'package-manifest.json'
        manifest.write_text(json.dumps({'files': [
            {'path': 'index.html'},
            {'path': '../backend/db.sqlite3'},
        ]}), encoding='utf-8')
        with mock.patch.object(public_site, 'public_manifest_path', return_value=manifest):
            self.assertEqual(self.client.get('/').status_code, 200)
            self.assertEqual(self.client.get('/arena.html').status_code, 404)
            self.assertEqual(self.client.head('/backend/db.sqlite3').status_code, 404)

    def test_missing_manifest_fails_closed(self):
        public_site = importlib.import_module('backend.public_site')
        missing = Path('D:/tmp') / (TEMP_PREFIX + 'missing-manifest.json')
        with mock.patch.object(public_site, 'public_manifest_path', return_value=missing):
            self.assertEqual(self.client.get('/').status_code, 404)
            self.assertEqual(self.client.get('/assets/site.css').status_code, 404)
            self.assertEqual(self.client.get('/health/').status_code, 200)

    def test_public_views_are_get_or_head_only(self):
        self.assertEqual(self.client.post('/health/').status_code, 405)
        self.assertEqual(self.client.post('/').status_code, 405)


class SitemapAndManifestIntegrityTests(SimpleTestCase):
    def test_sitemap_omits_the_retired_contact_page(self):
        sitemap = (repo_root() / 'sitemap.xml').read_text(encoding='utf-8')
        self.assertNotIn('contact', sitemap.lower())

    def test_sitemap_entries_are_manifest_listed_public_files(self):
        sitemap = (repo_root() / 'sitemap.xml').read_text(encoding='utf-8')
        root = ElementTree.fromstring(sitemap)
        locations = [
            element.text.strip()
            for element in root.iter()
            if element.tag.endswith('loc') and element.text and element.text.strip()
        ]
        self.assertGreaterEqual(len(locations), 9)
        self.assertIn('https://ouronex.com/', locations)
        allowed = manifest_paths()
        for location in locations:
            with self.subTest(location=location):
                self.assertTrue(location.startswith('https://ouronex.com/'), location)
                relative = location.split('ouronex.com/', 1)[1].strip('/') or 'index.html'
                self.assertIn(relative, allowed)
                self.assertTrue((repo_root() / relative).is_file(), relative)

    def test_manifest_omits_the_retired_contact_page_and_has_no_duplicates(self):
        entries = manifest_entries()
        paths = [entry['path'] for entry in entries if isinstance(entry, dict) and entry.get('path')]
        self.assertEqual(len(paths), len(set(paths)))
        self.assertEqual(len(paths), len(entries))
        retired = [
            path for path in paths
            if path == 'contact.html' or path.endswith('/contact.html') or path.startswith('contact/')
        ]
        self.assertEqual(retired, [])


class RetainedContactControlTests(SimpleTestCase):
    def test_owned_public_pages_do_not_reference_the_retired_contact_url(self):
        pages = retained_public_pages()
        self.assertGreaterEqual(len(pages), 9)
        for page in pages:
            with self.subTest(page=page.name):
                text = page.read_text(encoding='utf-8')
                for marker in CONTACT_URL_MARKERS:
                    self.assertNotIn(marker, text)

    # arena.html keeps its own in-page "Tell us what you need" link; everywhere else the
    # legacy alert anchor is retired in favour of the data-coming-soon buttons.
    LEGACY_ALERT_LINKS = {'arena.html': 1}

    def test_waiting_list_controls_are_coming_soon_buttons(self):
        for page in retained_public_pages():
            text = page.read_text(encoding='utf-8')
            with self.subTest(page=page.name):
                legacy = [
                    tag for tag in ANCHOR_PATTERN.findall(text)
                    if any(key in tag for key in CONTACT_CONTROL_KEYS)
                ]
                self.assertEqual(len(legacy), self.LEGACY_ALERT_LINKS.get(page.name, 0), legacy)
                for anchor in legacy:
                    href = HREF_PATTERN.search(anchor)
                    self.assertIsNotNone(href, anchor)
                    self.assertNotIn('contact', href.group(1).lower(), anchor)
                self.assertGreaterEqual(
                    text.count('data-coming-soon'), 1,
                    'the page must ask through a coming-soon button',
                )
