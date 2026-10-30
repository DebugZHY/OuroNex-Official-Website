import json
import re
import secrets
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone

from .models import AuthToken, Plan, Profile, Subscription


class AuthApiTests(TestCase):
    def setUp(self):
        self.password = secrets.token_urlsafe(18)
        self.user = User.objects.create_user(
            username='api-user',
            email='api@example.com',
            password=self.password,
        )
        self.profile = Profile.objects.create(user=self.user, phone='+852 0000 0000')
        self.plan = Plan.objects.create(name='free', display_name='Free')
        Subscription.objects.create(user=self.user, plan=self.plan, tokens_remaining=5_000_000)

    def post_json(self, path, payload):
        return self.client.post(path, data=json.dumps(payload), content_type='application/json')

    def test_login_issues_access_token_and_user_contract(self):
        response = self.post_json('/api/v1/auth/login/', {
            'username': 'api-user',
            'password': self.password,
        })

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['token_type'], 'Bearer')
        self.assertGreater(body['expires_in'], 0)
        self.assertTrue(body['access_token'])
        self.assertEqual(body['user'], {
            'uid': self.profile.uid,
            'username': 'api-user',
            'email': 'api@example.com',
            'phone': '+852 0000 0000',
            'plan': 'Free',
            'avatar': None,
        })
        stored_token = AuthToken.objects.get(user=self.user)
        self.assertNotEqual(stored_token.key_hash, body['access_token'])
        self.assertNotIn(body['access_token'], stored_token.key_hash)

    def test_login_rejects_invalid_credentials(self):
        response = self.post_json('/api/v1/auth/login/', {
            'username': 'api-user',
            'password': secrets.token_urlsafe(18),
        })

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()['error']['code'], 'invalid_credentials')
        self.assertEqual(AuthToken.objects.count(), 0)

    def test_login_rejects_malformed_json(self):
        response = self.client.post(
            '/api/v1/auth/login/',
            data='{"username":',
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error']['code'], 'invalid_json')
        self.assertEqual(AuthToken.objects.count(), 0)

    def test_login_requires_a_json_object(self):
        response = self.post_json('/api/v1/auth/login/', [])

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error']['code'], 'invalid_json')
        self.assertEqual(AuthToken.objects.count(), 0)

    def test_me_returns_current_user_for_bearer_token(self):
        login_response = self.post_json('/api/v1/auth/login/', {
            'username': 'api-user',
            'password': self.password,
        })
        raw_token = login_response.json()['access_token']

        response = self.client.get(
            '/api/v1/auth/me/',
            HTTP_AUTHORIZATION=f'Bearer {raw_token}',
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'user': {
            'uid': self.profile.uid,
            'username': 'api-user',
            'email': 'api@example.com',
            'phone': '+852 0000 0000',
            'plan': 'Free',
            'avatar': None,
        }})
        self.assertIsNotNone(AuthToken.objects.get(user=self.user).last_used_at)

    def test_me_accepts_authenticated_django_session_without_bearer(self):
        self.client.force_login(self.user)

        response = self.client.get('/api/v1/auth/me/')

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['user']['username'], 'api-user')
        self.assertEqual(body['user']['uid'], self.profile.uid)
        self.assertEqual(body['user']['plan'], 'Free')
        self.assertIsNone(body['user']['avatar'])

    def test_me_rejects_missing_or_invalid_bearer_token(self):
        for header in (None, 'Bearer onx_invalid_token'):
            with self.subTest(header=header):
                extra = {} if header is None else {'HTTP_AUTHORIZATION': header}
                response = self.client.get('/api/v1/auth/me/', **extra)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.json()['error']['code'], 'invalid_token')

    def test_me_rejects_expired_token(self):
        raw_token, token = AuthToken.issue(self.user)
        token.expires_at = timezone.now() - timedelta(seconds=1)
        token.save(update_fields=['expires_at'])

        response = self.client.get(
            '/api/v1/auth/me/',
            HTTP_AUTHORIZATION=f'Bearer {raw_token}',
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()['error']['code'], 'invalid_token')

    def test_logout_revokes_bearer_token(self):
        raw_token, token = AuthToken.issue(self.user)
        headers = {'HTTP_AUTHORIZATION': f'Bearer {raw_token}'}

        logout_response = self.client.post('/api/v1/auth/logout/', **headers)

        self.assertEqual(logout_response.status_code, 200)
        self.assertEqual(logout_response.json(), {'success': True})
        token.refresh_from_db()
        self.assertIsNotNone(token.revoked_at)
        me_response = self.client.get('/api/v1/auth/me/', **headers)
        self.assertEqual(me_response.status_code, 401)

    def test_auth_endpoints_reject_unsupported_methods(self):
        cases = [
            ('get', '/api/v1/auth/login/'),
            ('post', '/api/v1/auth/me/'),
            ('get', '/api/v1/auth/logout/'),
        ]
        for method, path in cases:
            with self.subTest(method=method, path=path):
                response = getattr(self.client, method)(path)
                self.assertEqual(response.status_code, 405)
                self.assertEqual(response.json()['error']['code'], 'method_not_allowed')

    def test_me_rejects_token_for_inactive_user(self):
        raw_token, _ = AuthToken.issue(self.user)
        self.user.is_active = False
        self.user.save(update_fields=['is_active'])

        response = self.client.get(
            '/api/v1/auth/me/',
            HTTP_AUTHORIZATION=f'Bearer {raw_token}',
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()['error']['code'], 'invalid_token')

    def test_logout_rejects_invalid_bearer_token(self):
        response = self.client.post(
            '/api/v1/auth/logout/',
            HTTP_AUTHORIZATION='Bearer onx_invalid_token',
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()['error']['code'], 'invalid_token')


class TokenUsageApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='usage-user', password='unused')
        self.other_user = User.objects.create_user(username='other-usage-user', password='unused')
        Profile.objects.create(user=self.user)

    def test_dashboard_usage_requires_login_and_renders(self):
        response = self.client.get('/dashboard/usage/')
        self.assertEqual(response.status_code, 302)
        self.assertIn('/login/?next=/dashboard/usage/', response.url)
        self.client.force_login(self.user)
        response = self.client.get('/dashboard/usage/')
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'id="token-usage-board"')
        self.assertContains(response, '/assets/token-usage.js')
        self.assertContains(response, 'href="/dashboard/"')
        dashboard = self.client.get('/dashboard/')
        self.assertContains(dashboard, 'href="/dashboard/usage/"')

    def test_session_get_returns_only_own_ordered_records(self):
        from .models import TokenUsageRecord

        TokenUsageRecord.objects.create(
            user=self.user,
            day='2026-10-29',
            model='model-b',
            session_id='session-b',
            title='Later session',
            calls=2,
            input_tokens=20,
            output_tokens=10,
            cache_write_tokens=4,
            cache_read_tokens=6,
        )
        TokenUsageRecord.objects.create(
            user=self.user,
            day='2026-10-30',
            model='model-a',
            session_id='session-a',
            title='Earlier session',
            calls=3,
            input_tokens=30,
            output_tokens=15,
            cache_write_tokens=5,
            cache_read_tokens=10,
        )
        TokenUsageRecord.objects.create(
            user=self.other_user,
            day='2026-10-30',
            model='private-model',
            session_id='private-session',
            calls=99,
        )
        self.client.force_login(self.user)

        response = self.client.get('/api/v1/usage/')

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['sessionCount'], 2)
        self.assertIn('generatedAt', body)
        self.assertEqual(body['records'], [
            {
                'day': '2026-10-29',
                'model': 'model-b',
                'sessionId': 'session-b',
                'title': 'Later session',
                'calls': 2,
                'input': 20,
                'output': 10,
                'cacheWrite': 4,
                'cacheRead': 6,
                'source': 'external',
            },
            {
                'day': '2026-10-30',
                'model': 'model-a',
                'sessionId': 'session-a',
                'title': 'Earlier session',
                'calls': 3,
                'input': 30,
                'output': 15,
                'cacheWrite': 5,
                'cacheRead': 10,
                'source': 'external',
            },
        ])

    def test_bearer_post_replaces_same_usage_identity(self):
        raw_token, _ = AuthToken.issue(self.user)
        record = {
            'day': '2026-10-30',
            'model': 'sida-pro',
            'sessionId': 'session-1',
            'title': 'Structural review',
            'calls': 4,
            'input': 100,
            'output': 40,
            'cacheWrite': 10,
            'cacheRead': 60,
            'source': 'sida-desktop',
        }

        for calls in (4, 9):
            record['calls'] = calls
            response = self.client.post(
                '/api/v1/usage/',
                data=json.dumps({'records': [record]}),
                content_type='application/json',
                HTTP_AUTHORIZATION=f'Bearer {raw_token}',
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['received'], 1)
            self.assertEqual(response.json()['upserted'], 1)

        stored = self.user.token_usage_records.get()
        self.assertEqual(stored.calls, 9)
        self.assertEqual(stored.source, 'sida-desktop')
        self.assertEqual(self.user.token_usage_records.count(), 1)

    def test_invalid_batch_is_rejected_atomically(self):
        raw_token, _ = AuthToken.issue(self.user)
        valid = {
            'day': '2026-10-30',
            'model': 'sida-pro',
            'sessionId': 'session-1',
            'calls': 1,
            'input': 10,
            'output': 5,
            'cacheWrite': 2,
            'cacheRead': 3,
        }
        invalid = dict(valid, sessionId='session-2', input=-1)

        response = self.client.post(
            '/api/v1/usage/',
            data=json.dumps({'records': [valid, invalid]}),
            content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {raw_token}',
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error']['code'], 'invalid_records')
        self.assertEqual(self.user.token_usage_records.count(), 0)

    def test_usage_rejects_bad_payloads_and_authentication(self):
        raw_token, _ = AuthToken.issue(self.user)
        headers = {'HTTP_AUTHORIZATION': f'Bearer {raw_token}'}
        valid = {
            'day': '2026-10-30',
            'model': 'sida-pro',
            'sessionId': 'session-1',
            'calls': 1,
            'input': 10,
            'output': 5,
            'cacheWrite': 2,
            'cacheRead': 3,
        }
        cases = [
            ([valid], 'invalid_records'),
            ({'records': []}, 'invalid_records'),
            ({'records': [dict(valid, day='2026-02-30')]}, 'invalid_records'),
            ({'records': [dict(valid, calls=True)]}, 'invalid_records'),
            ({'records': [dict(valid, unexpected=1)]}, 'invalid_records'),
            ({'records': [dict(valid, model='   ')]}, 'invalid_records'),
            ({'records': [dict(valid, source='   ')]}, 'invalid_records'),
            ({'records': [dict(valid, input=2**63)]}, 'invalid_records'),
            ({'records': [valid] * 501}, 'invalid_records'),
            ({'records': 'not-an-array'}, 'invalid_records'),
            ({'records': [{k: v for k, v in valid.items() if k != 'model'}]}, 'invalid_records'),
        ]
        for payload, code in cases:
            with self.subTest(payload=payload):
                response = self.client.post(
                    '/api/v1/usage/', data=json.dumps(payload), content_type='application/json', **headers,
                )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()['error']['code'], code)
        malformed = self.client.post(
            '/api/v1/usage/', data='{"records":', content_type='application/json', **headers,
        )
        self.assertEqual(malformed.status_code, 400)
        self.assertEqual(malformed.json()['error']['code'], 'invalid_json')
        session_only = self.client.post(
            '/api/v1/usage/', data=json.dumps({'records': [valid]}), content_type='application/json',
        )
        self.assertEqual(session_only.status_code, 401)
        anonymous_get = self.client.get('/api/v1/usage/')
        self.assertEqual(anonymous_get.status_code, 401)
        unsupported = self.client.put('/api/v1/usage/', **headers)
        self.assertEqual(unsupported.status_code, 405)
        self.assertEqual(self.user.token_usage_records.count(), 0)

    def test_demo_seed_is_idempotent_and_preserves_users_and_legacy_usage(self):
        from django.core.management import call_command
        from .models import TokenUsage

        legacy = TokenUsage.objects.create(user=self.user, tokens_used=123)
        original_user_count = User.objects.count()

        for _ in range(2):
            call_command('seed_token_usage_demo', username=self.user.username, days=7, verbosity=0)

        self.assertEqual(User.objects.count(), original_user_count)
        self.assertEqual(self.user.token_usage_records.count(), 42)
        self.assertEqual(set(self.user.token_usage_records.values_list('source', flat=True)), {'demo'})
        self.assertEqual(self.other_user.token_usage_records.count(), 0)
        legacy.refresh_from_db()
        self.assertEqual(legacy.tokens_used, 123)

class AccountShellTests(TestCase):
    """Regression tests for the unified account shell: shared topbar, sidebar and public nav."""

    PAGES = (
        '/dashboard/',
        '/dashboard/usage/',
        '/profile/',
        '/profile/security/',
        '/pricing/',
    )
    PUBLIC_DESTINATIONS = (
        '/index.html#sida',
        '/index.html#price',
        '/index.html#business',
        '/index.html#about',
    )

    def setUp(self):
        self.password = secrets.token_urlsafe(18)
        self.user = User.objects.create_user(
            username='shell-user',
            email='shell@example.com',
            password=self.password,
        )
        self.profile = Profile.objects.create(user=self.user, phone='+852 1234 5678')
        self.plan = Plan.objects.create(
            name='professional',
            display_name='Professional',
            price_monthly=49,
            price_yearly=490,
            tokens_monthly=20_000_000,
            features=['20M tokens/month', 'All models'],
        )
        self.subscription = Subscription.objects.create(
            user=self.user,
            plan=self.plan,
            status='active',
            tokens_remaining=7_500_000,
            expires_at=timezone.now() + timedelta(days=30),
        )
        self.client.force_login(self.user)

    def render(self, path):
        response = self.client.get(path)
        self.assertEqual(response.status_code, 200, 'expected HTTP 200 from %s' % path)
        return response.content.decode('utf-8')

    def test_authenticated_pages_render_shared_shell_and_public_nav(self):
        for path in self.PAGES:
            with self.subTest(page=path):
                html = self.render(path)
                self.assertTrue('/assets/account.css' in html, 'missing /assets/account.css on %s' % path)
                self.assertTrue('/assets/ouronex-mark.svg' in html, 'missing /assets/ouronex-mark.svg on %s' % path)
                self.assertTrue('href="/index.html"' in html, 'missing Home logo link on %s' % path)
                for target in self.PUBLIC_DESTINATIONS:
                    self.assertTrue(
                        'href="%s"' % target in html,
                        'missing public destination %s on %s' % (target, path),
                    )

    def test_authenticated_pages_share_shell_classes(self):
        for path in self.PAGES:
            with self.subTest(page=path):
                html = self.render(path)
                self.assertIsNotNone(
                    re.search(r'<body[^>]*class="[^"]*\baccount-page\b', html),
                    'missing body.account-page on %s' % path,
                )
                self.assertTrue('account-topbar' in html, 'missing shared topbar on %s' % path)
                self.assertTrue('class="sidebar"' in html, 'missing shared sidebar on %s' % path)

    def test_each_page_has_one_usage_sidebar_link_and_no_legacy_anchor(self):
        for path in self.PAGES:
            with self.subTest(page=path):
                html = self.render(path)
                self.assertEqual(
                    html.count('href="/dashboard/usage/"'),
                    1,
                    'expected exactly one /dashboard/usage/ link on %s' % path,
                )
                self.assertNotIn('/dashboard/#usage', html, 'legacy #usage anchor still on %s' % path)

    def test_dashboard_retires_the_legacy_usage_card(self):
        html = self.render('/dashboard/')
        self.assertFalse('id="usage"' in html, 'dashboard must not render the legacy id="usage" card')
        self.assertTrue('kpi-grid' in html, 'dashboard lost its KPI grid')
        self.assertTrue('Quick Actions' in html, 'dashboard lost its Quick Actions')

    def test_usage_sidebar_item_is_active_only_on_the_usage_page(self):
        import re

        for path in self.PAGES:
            with self.subTest(page=path):
                html = self.render(path)
                anchors = re.findall(r'<a\b[^>]*href="/dashboard/usage/"[^>]*>', html)
                self.assertEqual(len(anchors), 1, 'expected exactly one usage anchor on %s' % path)
                anchor = anchors[0]
                active = (
                    'aria-current="page"' in anchor
                    or re.search(r'class="[^"]*\bactive\b[^"]*"', anchor) is not None
                )
                if path == '/dashboard/usage/':
                    self.assertTrue(active, 'usage item must be active on /dashboard/usage/')
                else:
                    self.assertFalse(active, 'usage item must not be active on %s' % path)

class HomeOnePageTests(TestCase):
    """Static checks for the one-page Home consolidation and the five retired pages."""

    HOME_SECTIONS = ('home', 'sida', 'price', 'business', 'about')
    RETIRED_PAGES = ('news.html', 'platform.html', 'pricing.html', 'business.html', 'about-us.html')
    TEAM_MEMBERS = ('Jake Chan', 'Haoyi Zhang', 'Ir Prof. Siwei Liu')

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.site_root = Path(settings.STATIC_SITE_ROOT)
        cls.index_html = (cls.site_root / 'index.html').read_text(encoding='utf-8')

    def nav_primary_block(self):
        match = re.search(
            r'<(\w+)[^>]*class="[^"]*\bnav-primary\b[^"]*"[^>]*>(.*?)</\1>',
            self.index_html,
            re.S,
        )
        self.assertIsNotNone(match, 'index.html has no .nav-primary navigation block')
        return match.group(2)

    def test_home_has_five_ordered_sections(self):
        section_tags = re.findall(r'<section\b[^>]*\bdata-home-section\b[^>]*>', self.index_html)
        self.assertEqual(len(section_tags), 5, 'expected five sections carrying data-home-section')
        section_ids = [re.search(r'\bid="([^"]+)"', tag).group(1) for tag in section_tags]
        self.assertEqual(section_ids, list(self.HOME_SECTIONS))
        main_tag = re.search(r'<main\b[^>]*>', self.index_html)
        self.assertIsNotNone(main_tag, 'index.html has no <main> element')
        self.assertIn('id="main"', main_tag.group(0))
        self.assertIn('home-scroll', main_tag.group(0))
        for section_id in self.HOME_SECTIONS:
            with self.subTest(section=section_id):
                self.assertTrue('id="%s"' % section_id in self.index_html, 'missing #%s section' % section_id)

    def test_home_nav_has_exactly_four_section_anchors(self):
        block = self.nav_primary_block()
        hrefs = re.findall(r'<a\b[^>]*href="([^"]*)"', block)
        self.assertEqual(hrefs, ['#sida', '#price', '#business', '#about'])
        nav_text = re.sub(r'<[^>]+>', ' ', block).lower()
        self.assertFalse('news' in nav_text, 'navigation still offers News')
        self.assertFalse('contact' in nav_text, 'navigation still offers Contact')

    def test_home_lists_the_five_plans_including_enterprise(self):
        labels = [label for _value, label in Plan.PLAN_CHOICES]
        self.assertEqual(len(labels), 5)
        self.assertIn('Enterprise', labels)
        missing = [label for label in labels if label not in self.index_html]
        self.assertEqual(missing, [], 'plan names missing from index.html: %s' % missing)

    def test_home_names_the_requested_team_members(self):
        for name in self.TEAM_MEMBERS:
            with self.subTest(member=name):
                self.assertTrue(name in self.index_html, 'missing team member %r' % name)

    def test_retired_page_files_are_deleted(self):
        existing = [name for name in self.RETIRED_PAGES if (self.site_root / name).exists()]
        self.assertEqual(existing, [], 'retired pages still on disk: %s' % existing)

    def test_retired_page_routes_return_404(self):
        for name in self.RETIRED_PAGES:
            with self.subTest(page=name):
                response = self.client.get('/' + name)
                self.assertEqual(response.status_code, 404, '/%s should not be routed' % name)

    def test_retained_pages_have_no_legacy_page_links(self):
        pattern = re.compile(
            r'href="(?:\./|/)?(news|platform|pricing|business|about-us)\.html(?:[#?][^"]*)?"',
            re.I,
        )
        offenders = []
        for page in sorted(self.site_root.glob('*.html')):
            if page.name in self.RETIRED_PAGES:
                continue
            found = pattern.findall(page.read_text(encoding='utf-8'))
            if found:
                offenders.append((page.name, sorted(set(found))))
        self.assertEqual(offenders, [], 'legacy page links remain: %s' % offenders)

    def test_sitemap_has_only_retained_canonical_pages(self):
        from xml.etree import ElementTree

        root = ElementTree.parse(self.site_root / 'sitemap.xml').getroot()
        locations = [(node.text or '').strip() for node in root.findall('{http://www.sitemaps.org/schemas/sitemap/0.9}url/{http://www.sitemaps.org/schemas/sitemap/0.9}loc')]
        retired = {'https://ouronex.com/' + name for name in self.RETIRED_PAGES}
        self.assertFalse(retired.intersection(locations), 'sitemap lists deleted pages')
        self.assertEqual(locations.count('https://ouronex.com/'), 1, 'Home must have one canonical sitemap entry')
        for location in locations:
            path = location.removeprefix('https://ouronex.com/').split('#', 1)[0].split('?', 1)[0]
            if path.endswith('.html'):
                self.assertTrue((self.site_root / path).is_file(), 'sitemap target missing: %s' % location)
