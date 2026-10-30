"""Authentication and account-security regression tests.

Behaviours under test:
- session POST forms carry working CSRF tokens; logout is POST-only;
- registration/password-change run Django password validators;
- the captcha answer lives only in the session, never in HTML;
- login ``next`` redirects are validated;
- failed web/API login and registration attempts are throttled via cache buckets;
  a successful login clears only its own account bucket, never aggregate failures;
- Bearer API response schemas stay backward compatible.
"""
import importlib
import json
import re
import unittest
from unittest import mock

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import Client, RequestFactory, TestCase, modify_settings, override_settings

from . import security
from .models import Profile

CSRF_MIDDLEWARE = 'django.middleware.csrf.CsrfViewMiddleware'
CSRF_ONLY = modify_settings(MIDDLEWARE={'append': CSRF_MIDDLEWARE})

PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

TOKEN_RE = re.compile(r'name="csrfmiddlewaretoken" value="([^"]+)"')


def make_user(username='alice', password='Str0ng-Pass-9x'):
    user = User.objects.create_user(username=username, email='', password=password)
    Profile.objects.create(user=user)
    return user


def csrf_client(testcase):
    """A CSRF-enforcing client created under the temporarily enabled middleware."""
    return Client(enforce_csrf_checks=True)


def token_from(response):
    match = TOKEN_RE.search(response.content.decode('utf-8'))
    return match.group(1) if match else None


@CSRF_ONLY
class SessionCsrfTests(TestCase):
    def test_anonymous_session_forms_render_a_csrf_token(self):
        client = csrf_client(self)
        for path in ('/login/', '/register/'):
            with self.subTest(path=path):
                response = client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertIsNotNone(token_from(response), 'missing CSRF token on %s' % path)

    def test_authenticated_session_forms_render_a_csrf_token(self):
        make_user()
        client = csrf_client(self)
        client.force_login(User.objects.get(username='alice'))
        for path in ('/profile/', '/profile/security/'):
            with self.subTest(path=path):
                response = client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertIsNotNone(token_from(response), 'missing CSRF token on %s' % path)

    def test_login_post_without_csrf_token_is_rejected(self):
        make_user()
        client = csrf_client(self)
        response = client.post('/login/', {'username': 'alice', 'password': 'wrong'})
        self.assertEqual(response.status_code, 403)

    def test_login_post_with_csrf_token_authenticates(self):
        make_user()
        client = csrf_client(self)
        token = token_from(client.get('/login/'))
        self.assertIsNotNone(token)
        response = client.post(
            '/login/',
            {'username': 'alice', 'password': 'Str0ng-Pass-9x', 'csrfmiddlewaretoken': token},
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response['Location'], '/dashboard/')

    def test_profile_post_without_csrf_token_is_rejected(self):
        make_user()
        client = csrf_client(self)
        client.force_login(User.objects.get(username='alice'))
        response = client.post('/profile/', {'username': 'alice'})
        self.assertEqual(response.status_code, 403)

    def test_logout_is_post_only(self):
        make_user()
        client = csrf_client(self)
        user = User.objects.get(username='alice')
        client.force_login(user)
        self.assertEqual(client.get('/logout/').status_code, 405)
        self.assertTrue(Client().get('/logout/').status_code == 405)

    def test_logout_post_requires_csrf_token(self):
        make_user()
        client = csrf_client(self)
        client.force_login(User.objects.get(username='alice'))
        response = client.post('/logout/')
        self.assertEqual(response.status_code, 403)

    def test_logout_post_with_csrf_token_ends_the_session(self):
        make_user()
        client = csrf_client(self)
        client.force_login(User.objects.get(username='alice'))
        token = token_from(client.get('/dashboard/'))
        self.assertIsNotNone(token)
        response = client.post('/logout/', {'csrfmiddlewaretoken': token})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response['Location'], '/login/')
        self.assertEqual(client.get('/dashboard/').status_code, 302)

    def test_sidebar_sign_out_is_a_post_form_and_no_longer_a_get_link(self):
        make_user()
        client = csrf_client(self)
        client.force_login(User.objects.get(username='alice'))
        html = client.get('/dashboard/').content.decode('utf-8')
        self.assertNotIn('<a href="/logout/"', html)
        self.assertIsNotNone(
            re.search(r'<form[^>]*action="/logout/"[^>]*method="post"', html)
            or re.search(r'<form[^>]*method="post"[^>]*action="/logout/"', html),
            'sidebar must submit POST to /logout/',
        )
        self.assertNotIn('name="csrfmiddlewaretoken" value=""', html)


class CaptchaSessionTests(TestCase):
    def test_captcha_answer_is_never_rendered_into_html(self):
        with mock.patch(
            'accounts.views.generate_captcha',
            return_value=('1 + 424241 = ?', '424242'),
        ):
            response = Client().get('/register/')
        html = response.content.decode('utf-8')
        self.assertIn('1 + 424241 = ?', html)
        self.assertNotIn('424242', html)
        self.assertNotIn('captcha_expected', html)

    def test_registration_accepts_the_session_captcha_answer(self):
        with mock.patch(
            'accounts.views.generate_captcha',
            return_value=('1 + 424241 = ?', '424242'),
        ):
            client = Client()
            client.get('/register/')
            response = client.post('/register/', {
                'username': 'bob',
                'email': 'bob@example.com',
                'phone': '',
                'password': 'Str0ng-Pass-9x',
                'password2': 'Str0ng-Pass-9x',
                'captcha': '424242',
            })
        self.assertEqual(response.status_code, 302)
        self.assertTrue(User.objects.filter(username='bob').exists())

    def test_registration_rejects_a_wrong_captcha_answer(self):
        with mock.patch(
            'accounts.views.generate_captcha',
            return_value=('1 + 424241 = ?', '424242'),
        ):
            client = Client()
            client.get('/register/')
            response = client.post('/register/', {
                'username': 'bob',
                'email': '',
                'phone': '',
                'password': 'Str0ng-Pass-9x',
                'password2': 'Str0ng-Pass-9x',
                'captcha': '000000',
                'captcha_expected': '424242',
            })
        self.assertEqual(response.status_code, 200)
        self.assertFalse(User.objects.filter(username='bob').exists())
        self.assertIn('Incorrect verification code.', response.content.decode('utf-8'))


@override_settings(AUTH_PASSWORD_VALIDATORS=PASSWORD_VALIDATORS)
class PasswordValidationTests(TestCase):
    def test_registration_rejects_a_weak_password(self):
        with mock.patch(
            'accounts.views.generate_captcha',
            return_value=('2 + 3 = ?', '5'),
        ):
            client = Client()
            client.get('/register/')
            response = client.post('/register/', {
                'username': 'bob',
                'email': '',
                'phone': '',
                'password': '12345678',
                'password2': '12345678',
                'captcha': '5',
                # Legacy hidden field: the pre-change view needed it, the new view ignores it.
                'captcha_expected': '5',
            })
        self.assertEqual(response.status_code, 200)
        self.assertFalse(User.objects.filter(username='bob').exists())
        self.assertTrue(
            b'password' in response.content.lower(),
            'weak-password rejection must be reported to the user',
        )

    def test_password_change_rejects_a_weak_password(self):
        make_user()
        client = Client()
        client.force_login(User.objects.get(username='alice'))
        response = client.post('/profile/security/', {
            'action': 'change_password',
            'old_password': 'Str0ng-Pass-9x',
            'new_password': '12345678',
            'new_password2': '12345678',
        })
        self.assertEqual(response.status_code, 200)
        user = User.objects.get(username='alice')
        self.assertTrue(user.check_password('Str0ng-Pass-9x'))

    def test_password_change_still_accepts_a_strong_password(self):
        make_user()
        client = Client()
        client.force_login(User.objects.get(username='alice'))
        response = client.post('/profile/security/', {
            'action': 'change_password',
            'old_password': 'Str0ng-Pass-9x',
            'new_password': 'N3w-Str0ng-Pass!',
            'new_password2': 'N3w-Str0ng-Pass!',
        })
        self.assertEqual(response.status_code, 302)
        user = User.objects.get(username='alice')
        self.assertTrue(user.check_password('N3w-Str0ng-Pass!'))


class LoginRedirectTests(TestCase):
    def _login(self, query):
        User.objects.get_or_create(username='alice')[0].set_password('Str0ng-Pass-9x')
        user = User.objects.get(username='alice')
        user.set_password('Str0ng-Pass-9x')
        user.save()
        response = Client().post('/login/?next=%s' % query, {'username': 'alice', 'password': 'Str0ng-Pass-9x'})
        return response

    def test_login_next_rejects_offsite_redirect(self):
        for target in ('https://evil.example/', '//evil.example/', 'http://evil.example/x'):
            with self.subTest(target=target):
                response = self._login(target)
                self.assertEqual(response.status_code, 302)
                self.assertEqual(response['Location'], '/dashboard/')

    def test_login_next_accepts_a_local_path(self):
        response = self._login('/profile/')
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response['Location'], '/profile/')


@override_settings(
    OURONEX_AUTH_MAX_ATTEMPTS=3,
    OURONEX_AUTH_WINDOW_SECONDS=300,
    OURONEX_TRUSTED_PROXY_IPS='127.0.0.1,::1',
)
class ThrottleTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def _api_login(self, password='wrong'):
        return Client().post(
            '/api/v1/auth/login/',
            data=json.dumps({'username': 'alice', 'password': password}),
            content_type='application/json',
        )

    def _web_login(self, password='wrong'):
        return Client().post('/login/', {'username': 'alice', 'password': password})

    def test_security_module_hashes_the_throttle_key(self):
        security = importlib.import_module('accounts.security')
        key = security.throttle_key('web-login', '203.0.113.7')
        self.assertEqual(key, security.throttle_key('web-login', '203.0.113.7'))
        self.assertNotIn('203.0.113.7', key)
        self.assertNotEqual(key, security.throttle_key('api-login', '203.0.113.7'))

    def test_web_login_returns_429_with_retry_after(self):
        make_user()
        for _ in range(3):
            self.assertEqual(self._web_login().status_code, 200)
        response = self._web_login()
        self.assertEqual(response.status_code, 429)
        self.assertTrue(int(response['Retry-After']) > 0)

    def _request(self):
        return RequestFactory().post('/login/', {'username': 'alice'})

    def test_successful_web_login_clears_only_its_account_bucket(self):
        make_user()
        self._web_login()
        self._web_login()
        ok = self._web_login('Str0ng-Pass-9x')
        self.assertEqual(ok.status_code, 302)
        request = self._request()
        self.assertEqual(security.attempt_count(security.WEB_LOGIN_SCOPE, request), 2)
        self.assertEqual(
            security.account_attempt_count(security.WEB_LOGIN_SCOPE, request, 'alice'), 0
        )
        self.assertEqual(self._web_login().status_code, 200)
        self.assertEqual(self._web_login().status_code, 429)

    def test_web_success_of_another_account_does_not_unlock_a_victim(self):
        make_user()
        make_user('bob', 'Other-Pass-9x')
        self.assertEqual(self._web_login().status_code, 200)
        self.assertEqual(self._web_login().status_code, 200)
        own = Client().post('/login/', {'username': 'bob', 'password': 'Other-Pass-9x'})
        self.assertEqual(own.status_code, 302)
        self.assertEqual(self._web_login().status_code, 200)
        self.assertEqual(self._web_login().status_code, 429)

    def test_either_bucket_can_block_a_web_login(self):
        make_user()
        request = self._request()
        cache.set(
            security.account_key(security.WEB_LOGIN_SCOPE, request, 'alice'),
            security.max_attempts(),
            security.window_seconds(),
        )
        self.assertEqual(security.attempt_count(security.WEB_LOGIN_SCOPE, request), 0)
        response = self._web_login()
        self.assertEqual(response.status_code, 429)
        self.assertTrue(int(response['Retry-After']) > 0)

    def test_account_bucket_normalizes_the_username(self):
        request = self._request()
        self.assertEqual(
            security.account_key(security.API_LOGIN_SCOPE, request, '  Alice '),
            security.account_key(security.API_LOGIN_SCOPE, request, 'alice'),
        )
        self.assertNotIn('alice', security.account_key(security.API_LOGIN_SCOPE, request, 'alice'))

    def test_success_keeps_other_usernames_account_failures(self):
        make_user()
        for _ in range(2):
            self.assertEqual(
                Client().post('/login/', {'username': 'carol', 'password': 'wrong'}).status_code,
                200,
            )
        self.assertEqual(self._web_login('Str0ng-Pass-9x').status_code, 302)
        request = self._request()
        self.assertEqual(
            security.account_attempt_count(security.WEB_LOGIN_SCOPE, request, 'carol'), 2
        )
        self.assertEqual(
            security.account_attempt_count(security.WEB_LOGIN_SCOPE, request, 'alice'), 0
        )
        self.assertEqual(security.attempt_count(security.WEB_LOGIN_SCOPE, request), 2)

    def test_api_login_returns_429_with_retry_after(self):
        make_user()
        for _ in range(3):
            self.assertEqual(self._api_login().status_code, 401)
        response = self._api_login()
        self.assertEqual(response.status_code, 429)
        self.assertTrue(int(response['Retry-After']) > 0)
        payload = response.json()
        self.assertEqual(payload['error']['code'], 'too_many_requests')
        self.assertNotIn('alice', payload['error']['message'])

    def test_successful_api_login_clears_only_its_account_bucket(self):
        make_user()
        self._api_login()
        self._api_login()
        ok = self._api_login('Str0ng-Pass-9x')
        self.assertEqual(ok.status_code, 200)
        request = self._request()
        self.assertEqual(security.attempt_count(security.API_LOGIN_SCOPE, request), 2)
        self.assertEqual(
            security.account_attempt_count(security.API_LOGIN_SCOPE, request, 'alice'), 0
        )
        self.assertEqual(self._api_login().status_code, 401)
        self.assertEqual(self._api_login().status_code, 429)

    def test_api_success_of_another_account_does_not_unlock_a_victim(self):
        make_user()
        make_user('bob', 'Other-Pass-9x')
        self.assertEqual(self._api_login().status_code, 401)
        self.assertEqual(self._api_login().status_code, 401)
        own = Client().post(
            '/api/v1/auth/login/',
            data=json.dumps({'username': 'bob', 'password': 'Other-Pass-9x'}),
            content_type='application/json',
        )
        self.assertEqual(own.status_code, 200)
        self.assertEqual(self._api_login().status_code, 401)
        self.assertEqual(self._api_login().status_code, 429)

    def test_throttled_api_response_keeps_the_contract_schema(self):
        make_user()
        for _ in range(3):
            self._api_login()
        response = self._api_login()
        self.assertEqual(response.status_code, 429)
        self.assertEqual(set(response.json()), {'error'})
        self.assertEqual(set(response.json()['error']), {'code', 'message'})
        self.assertEqual(response.json()['error']['code'], 'too_many_requests')
        self.assertTrue(int(response['Retry-After']) > 0)
        self.assertNotIn('retry_after', response.json()['error'])

    def test_registration_returns_429_with_retry_after(self):
        with override_settings(OURONEX_AUTH_MAX_ATTEMPTS=2):
            for _ in range(2):
                response = Client().post('/register/', {
                    'username': 'bob',
                    'password': 'Str0ng-Pass-9x',
                    'password2': 'Str0ng-Pass-9x',
                    'captcha': '000000',
                })
                self.assertEqual(response.status_code, 200)
            response = Client().post('/register/', {
                'username': 'bob',
                'password': 'Str0ng-Pass-9x',
                'password2': 'Str0ng-Pass-9x',
                'captcha': '000000',
            })
        self.assertEqual(response.status_code, 429)
        self.assertTrue(int(response['Retry-After']) > 0)

    def test_trusted_proxy_rule_uses_forwarded_for_only_from_trusted_peers(self):
        security = importlib.import_module('accounts.security')

        class FakeRequest:
            META = {'REMOTE_ADDR': '127.0.0.1', 'HTTP_X_FORWARDED_FOR': '198.51.100.9, 10.0.0.1'}

        class UntrustedRequest:
            META = {'REMOTE_ADDR': '203.0.113.50', 'HTTP_X_FORWARDED_FOR': '198.51.100.9'}

        self.assertEqual(security.client_ip(FakeRequest()), '198.51.100.9')
        self.assertEqual(security.client_ip(UntrustedRequest()), '203.0.113.50')


class BearerSchemaCompatibilityTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def test_login_success_schema_is_unchanged(self):
        make_user()
        response = Client().post(
            '/api/v1/auth/login/',
            data=json.dumps({'username': 'alice', 'password': 'Str0ng-Pass-9x'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(
            set(payload),
            {'access_token', 'token_type', 'expires_in', 'user'},
        )
        self.assertEqual(payload['token_type'], 'Bearer')
        self.assertEqual(
            set(payload['user']),
            {'uid', 'username', 'email', 'phone', 'plan', 'avatar'},
        )

    def test_invalid_credentials_message_stays_generic(self):
        make_user()
        response = Client().post(
            '/api/v1/auth/login/',
            data=json.dumps({'username': 'alice', 'password': 'wrong'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()['error']['code'], 'invalid_credentials')
        self.assertEqual(response.json()['error']['message'], 'Invalid username or password.')


if __name__ == '__main__':
    unittest.main()