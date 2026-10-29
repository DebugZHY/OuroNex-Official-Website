import json
import secrets
from datetime import timedelta

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
        }})
        self.assertIsNotNone(AuthToken.objects.get(user=self.user).last_used_at)

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
