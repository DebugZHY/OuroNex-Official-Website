import json

from django.contrib.auth import authenticate
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .models import AuthToken


def api_error(code, message, status):
    return JsonResponse({'error': {'code': code, 'message': message}}, status=status)


def serialize_user(user):
    profile = getattr(user, 'profile', None)
    subscription = user.subscriptions.filter(status='active').select_related('plan').first()
    return {
        'uid': profile.uid if profile else None,
        'username': user.username,
        'email': user.email,
        'phone': profile.phone if profile else '',
        'plan': subscription.plan.display_name if subscription else None,
    }


@csrf_exempt
def login(request):
    if request.method != 'POST':
        return api_error('method_not_allowed', 'Use POST for this endpoint.', 405)
    try:
        payload = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return api_error('invalid_json', 'Request body must be valid JSON.', 400)
    if not isinstance(payload, dict):
        return api_error('invalid_json', 'Request body must be a JSON object.', 400)
    user = authenticate(
        request,
        username=payload.get('username'),
        password=payload.get('password'),
    )
    if user is None:
        return api_error('invalid_credentials', 'Invalid username or password.', 401)
    raw_token, token = AuthToken.issue(user)
    return JsonResponse({
        'access_token': raw_token,
        'token_type': 'Bearer',
        'expires_in': max(0, int((token.expires_at - timezone.now()).total_seconds())),
        'user': serialize_user(user),
    })


def me(request):
    if request.method != 'GET':
        return api_error('method_not_allowed', 'Use GET for this endpoint.', 405)
    raw_token = request.headers.get('Authorization', '').removeprefix('Bearer ')
    token = AuthToken.verify(raw_token)
    if token is None:
        return api_error('invalid_token', 'A valid Bearer token is required.', 401)
    return JsonResponse({'user': serialize_user(token.user)})


@csrf_exempt
def logout(request):
    if request.method != 'POST':
        return api_error('method_not_allowed', 'Use POST for this endpoint.', 405)
    raw_token = request.headers.get('Authorization', '').removeprefix('Bearer ')
    token = AuthToken.verify(raw_token)
    if token is None:
        return api_error('invalid_token', 'A valid Bearer token is required.', 401)
    token.revoked_at = timezone.now()
    token.save(update_fields=['revoked_at'])
    return JsonResponse({'success': True})
