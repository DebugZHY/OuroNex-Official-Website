import base64

from django.contrib.auth.models import User
from django.contrib.messages import get_messages
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase

from .api import serialize_user
from .models import Plan, Profile, Subscription, TokenUsage

PNG_1X1 = base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH'
    '/q842iQAAAABJRU5ErkJggg=='
)
JPEG_BYTES = b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9'
WEBP_BYTES = b'RIFF\x24\x00\x00\x00WEBPVP8 \x18\x00\x00\x00\x30\x01\x00\x9d\x01\x2a\x01\x00\x01\x00'
SVG_BYTES = b'<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'
MAX_BYTES = 2 * 1024 * 1024


def message_texts(response):
    return [str(item) for item in get_messages(response.wsgi_request)]


def upload(payload, name='avatar.png', content_type='image/png'):
    return SimpleUploadedFile(name, payload, content_type=content_type)


class ProfileTestBase(TestCase):
    def setUp(self):
        self.password = 'Str0ng-Pass-9x'
        self.user = User.objects.create_user(
            username='profile-user',
            email='profile@example.com',
            password=self.password,
        )
        self.profile = Profile.objects.create(user=self.user, phone='+852 1234 5678')
        self.plan = Plan.objects.create(name='free', display_name='Free')
        self.subscription = Subscription.objects.create(
            user=self.user,
            plan=self.plan,
            status='active',
            tokens_remaining=4321,
        )
        TokenUsage.objects.create(user=self.user, tokens_used=7)
        TokenUsage.objects.create(user=self.user, tokens_used=5)
        self.client.force_login(self.user)

    def post_avatar(self, payload, name='avatar.png', content_type='image/png'):
        return self.client.post(
            '/profile/',
            {'action': 'avatar', 'avatar': upload(payload, name, content_type)},
        )

    def store_valid_avatar(self):
        response = self.post_avatar(PNG_1X1)
        self.assertEqual(response.status_code, 302)
        self.profile.refresh_from_db()
        return self.profile.avatar_data


class DashboardCompatibilityTests(ProfileTestBase):
    def test_dashboard_redirects_to_profile(self):
        response = self.client.get('/dashboard/')
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response['Location'], '/profile/')

    def test_dashboard_requires_login(self):
        self.client.logout()
        response = self.client.get('/dashboard/')
        self.assertEqual(response.status_code, 302)
        self.assertIn('/login/?next=/dashboard/', response['Location'])

    def test_usage_route_is_unchanged(self):
        response = self.client.get('/dashboard/usage/')
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'id="token-usage-board"')

    def test_profile_context_carries_the_merged_dashboard_data(self):
        response = self.client.get('/profile/')
        self.assertEqual(response.status_code, 200)
        context = response.context
        self.assertEqual(context['user'], self.user)
        self.assertEqual(context['profile'], self.profile)
        self.assertEqual(context['subscription'], self.subscription)
        self.assertEqual(context['subscription'].plan.display_name, 'Free')
        self.assertEqual(context['token_usage'], 12)

    def test_profile_context_without_subscription_and_usage(self):
        other = User.objects.create_user(username='quiet-user', password=self.password)
        Profile.objects.create(user=other)
        self.client.force_login(other)
        response = self.client.get('/profile/')
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.context['subscription'])
        self.assertEqual(response.context['token_usage'], 0)


class ProfileUpdateTests(ProfileTestBase):
    def test_post_without_action_updates_details_and_redirects(self):
        response = self.client.post('/profile/', {
            'username': 'renamed-user',
            'email': 'renamed@example.com',
            'phone': '+852 9999 0000',
        })
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response['Location'], '/profile/')

        self.user.refresh_from_db()
        self.profile.refresh_from_db()
        self.assertEqual(self.user.username, 'renamed-user')
        self.assertEqual(self.user.email, 'renamed@example.com')
        self.assertEqual(self.profile.phone, '+852 9999 0000')
        self.assertIn('Username updated.', message_texts(response))
        self.assertIn('Email updated.', message_texts(response))
        self.assertIn('Phone updated.', message_texts(response))

    def test_taken_username_is_rejected_and_profile_is_kept(self):
        User.objects.create_user(username='taken-user', password=self.password)
        response = self.client.post('/profile/', {'username': 'taken-user'})
        self.assertEqual(response.status_code, 302)
        self.user.refresh_from_db()
        self.assertEqual(self.user.username, 'profile-user')
        self.assertIn('Username already taken.', message_texts(response))


class AvatarUploadTests(ProfileTestBase):
    def test_png_upload_round_trip(self):
        response = self.post_avatar(PNG_1X1)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response['Location'], '/profile/')
        self.assertIn('Avatar updated.', message_texts(response))

        self.profile.refresh_from_db()
        self.assertEqual(bytes(self.profile.avatar_data), PNG_1X1)
        self.assertEqual(self.profile.avatar_content_type, 'image/png')
        self.assertIsNotNone(self.profile.avatar_updated_at)
        self.assertTrue(self.profile.has_avatar)
        self.assertTrue(self.profile.avatar_url.startswith('/profile/avatar/?v='))
        self.assertEqual(
            self.profile.avatar_url,
            '/profile/avatar/?v=%d' % int(self.profile.avatar_updated_at.timestamp()),
        )

        served = self.client.get(self.profile.avatar_url)
        self.assertEqual(served.status_code, 200)
        self.assertEqual(served.content, PNG_1X1)
        self.assertEqual(served['Content-Type'], 'image/png')
        self.assertEqual(served['X-Content-Type-Options'], 'nosniff')
        self.assertTrue(
            'no-store' in served['Cache-Control'] or 'no-cache' in served['Cache-Control'],
            served['Cache-Control'],
        )
        self.assertTrue(served['Cache-Control'].startswith('private'), served['Cache-Control'])
        self.assertTrue(served['Content-Disposition'].startswith('inline;'), served['Content-Disposition'])

    def test_png_accepted_with_misleading_filename_and_mime(self):
        response = self.post_avatar(PNG_1X1, name='notes.txt', content_type='text/plain')
        self.assertEqual(response.status_code, 302)
        self.profile.refresh_from_db()
        self.assertEqual(bytes(self.profile.avatar_data), PNG_1X1)
        self.assertEqual(self.profile.avatar_content_type, 'image/png')

    def test_jpeg_and_webp_magic_are_accepted(self):
        for payload, expected in (
            (JPEG_BYTES, 'image/jpeg'),
            (WEBP_BYTES, 'image/webp'),
        ):
            with self.subTest(content_type=expected):
                response = self.post_avatar(payload)
                self.assertEqual(response.status_code, 302)
                self.profile.refresh_from_db()
                self.assertEqual(self.profile.avatar_content_type, expected)
                self.assertEqual(bytes(self.profile.avatar_data), payload)

    def test_svg_upload_is_rejected_and_old_avatar_is_kept(self):
        original = self.store_valid_avatar()
        original_stamp = self.profile.avatar_updated_at

        response = self.post_avatar(SVG_BYTES, name='avatar.svg', content_type='image/svg+xml')
        self.assertEqual(response.status_code, 302)
        self.assertIn('Image must be a PNG, JPEG or WebP file.', message_texts(response))

        self.profile.refresh_from_db()
        self.assertEqual(bytes(self.profile.avatar_data), original)
        self.assertEqual(self.profile.avatar_content_type, 'image/png')
        self.assertEqual(self.profile.avatar_updated_at, original_stamp)

    def test_text_and_empty_uploads_are_rejected(self):
        original = self.store_valid_avatar()

        text_response = self.post_avatar(b'not an image at all', name='notes.txt', content_type='text/plain')
        self.assertEqual(text_response.status_code, 302)
        self.assertIn('Image must be a PNG, JPEG or WebP file.', message_texts(text_response))

        empty_response = self.post_avatar(b'', name='empty.png')
        self.assertEqual(empty_response.status_code, 302)
        self.assertIn('Choose an image file to upload.', message_texts(empty_response))

        missing_response = self.client.post('/profile/', {'action': 'avatar'})
        self.assertEqual(missing_response.status_code, 302)
        self.assertIn('Choose an image file to upload.', message_texts(missing_response))

        self.profile.refresh_from_db()
        self.assertEqual(bytes(self.profile.avatar_data), original)

    def test_oversize_upload_is_rejected_and_old_avatar_is_kept(self):
        original = self.store_valid_avatar()
        oversize = PNG_1X1 + b'\x00' * (MAX_BYTES + 1 - len(PNG_1X1))
        self.assertEqual(len(oversize), MAX_BYTES + 1)

        response = self.post_avatar(oversize)
        self.assertEqual(response.status_code, 302)
        self.assertIn('Image must be 2 MB or smaller.', message_texts(response))

        self.profile.refresh_from_db()
        self.assertEqual(bytes(self.profile.avatar_data), original)

    def test_upload_at_the_size_limit_is_accepted(self):
        payload = PNG_1X1 + b'\x00' * (MAX_BYTES - len(PNG_1X1))
        self.assertEqual(len(payload), MAX_BYTES)

        response = self.post_avatar(payload)
        self.assertEqual(response.status_code, 302)
        self.profile.refresh_from_db()
        self.assertEqual(len(bytes(self.profile.avatar_data)), MAX_BYTES)

    def test_upload_requires_login(self):
        self.client.logout()
        response = self.client.post('/profile/', {'action': 'avatar', 'avatar': upload(PNG_1X1)})
        self.assertEqual(response.status_code, 302)
        self.assertIn('/login/?next=/profile/', response['Location'])
        self.profile.refresh_from_db()
        self.assertFalse(self.profile.avatar_data)


class AvatarServingTests(ProfileTestBase):
    def test_missing_avatar_returns_404(self):
        response = self.client.get('/profile/avatar/')
        self.assertEqual(response.status_code, 404)

    def test_avatar_requires_login(self):
        self.client.logout()
        response = self.client.get('/profile/avatar/')
        self.assertEqual(response.status_code, 302)
        self.assertIn('/login/?next=/profile/avatar/', response['Location'])

    def test_avatar_is_get_only(self):
        self.store_valid_avatar()
        self.assertEqual(self.client.post('/profile/avatar/').status_code, 405)
        self.assertEqual(self.client.head('/profile/avatar/').status_code, 405)

    def test_avatar_is_private_to_its_owner(self):
        self.store_valid_avatar()
        other = User.objects.create_user(username='other-user', password=self.password)
        other_profile = Profile.objects.create(user=other)
        other_profile.avatar_data = JPEG_BYTES
        other_profile.avatar_content_type = 'image/jpeg'
        other_profile.save(update_fields=['avatar_data', 'avatar_content_type'])

        mine = self.client.get('/profile/avatar/')
        self.assertEqual(mine.content, PNG_1X1)

        self.client.force_login(other)
        theirs = self.client.get('/profile/avatar/')
        self.assertEqual(theirs.content, JPEG_BYTES)
        self.assertEqual(theirs['Content-Type'], 'image/jpeg')


class AvatarApiTests(ProfileTestBase):
    def test_user_without_avatar_serializes_none(self):
        self.assertIsNone(serialize_user(self.user)['avatar'])
        self.assertEqual(self.profile.avatar_url, '')

    def test_serialize_user_reports_the_versioned_avatar_url(self):
        self.store_valid_avatar()
        payload = serialize_user(self.user)
        self.assertEqual(set(payload), {'uid', 'username', 'email', 'phone', 'plan', 'avatar'})
        self.assertEqual(payload['avatar'], self.profile.avatar_url)
        self.assertTrue(payload['avatar'].startswith('/profile/avatar/?v='))

    def test_me_endpoint_exposes_the_avatar_url(self):
        self.store_valid_avatar()
        response = self.client.get('/api/v1/auth/me/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['user']['avatar'], self.profile.avatar_url)
