import json
import re
from datetime import date

from django.contrib.auth import authenticate
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.db import transaction

from .models import AuthToken, TokenUsageRecord


def api_error(code, message, status):
    return JsonResponse({'error': {'code': code, 'message': message}}, status=status)


def serialize_user(user):
    profile = getattr(user, 'profile', None)
    subscription = user.subscriptions.filter(status='active').select_related('plan').first()
    # avatar stays None until a compatible profile attribute supplies a URL; no model change.
    avatar = None
    if profile is not None:
        candidate = getattr(profile, 'avatar', None) or getattr(profile, 'avatar_url', None)
        if isinstance(candidate, str) and candidate.strip():
            avatar = candidate.strip()
    return {
        'uid': profile.uid if profile else None,
        'username': user.username,
        'email': user.email,
        'phone': profile.phone if profile else '',
        'plan': subscription.plan.display_name if subscription else None,
        'avatar': avatar,
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
    # A dashboard session is enough on its own; Bearer tokens keep working for integrations.
    if request.user.is_authenticated:
        return JsonResponse({'user': serialize_user(request.user)})
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


def serialize_usage_record(record):
    return {
        'day': record.day.isoformat(),
        'model': record.model,
        'sessionId': record.session_id,
        'title': record.title,
        'calls': record.calls,
        'input': record.input_tokens,
        'output': record.output_tokens,
        'cacheWrite': record.cache_write_tokens,
        'cacheRead': record.cache_read_tokens,
        'source': record.source,
    }


def validate_usage_records(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get('records'), list):
        raise ValueError('records must be an array containing 1 to 500 records.')
    records = payload['records']
    if not 1 <= len(records) <= 500:
        raise ValueError('records must contain 1 to 500 records.')
    required = {'day', 'model', 'sessionId', 'calls', 'input', 'output', 'cacheWrite', 'cacheRead'}
    allowed = required | {'title', 'source'}
    counters = ('calls', 'input', 'output', 'cacheWrite', 'cacheRead')
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            raise ValueError(f'records[{index}] must be an object.')
        if not required.issubset(record) or set(record) - allowed:
            raise ValueError(f'records[{index}] has missing or unsupported fields.')
        for field, maximum in (('model', 120), ('sessionId', 200), ('source', 80)):
            value = record.get(field, 'external')
            if not isinstance(value, str) or not value.strip() or len(value) > maximum:
                raise ValueError(f'records[{index}].{field} is invalid.')
        title = record.get('title', '')
        if not isinstance(title, str) or len(title) > 255:
            raise ValueError(f'records[{index}].title is invalid.')
        day = record['day']
        if not isinstance(day, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', day):
            raise ValueError(f'records[{index}].day must use YYYY-MM-DD.')
        try:
            date.fromisoformat(day)
        except ValueError as error:
            raise ValueError(f'records[{index}].day is not a valid date.') from error
        for field in counters:
            value = record[field]
            if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 2**63 - 1:
                raise ValueError(f'records[{index}].{field} must be a non-negative integer.')
    return records


@csrf_exempt
def usage(request):
    if request.method == 'GET':
        if request.user.is_authenticated:
            user = request.user
        else:
            raw_token = request.headers.get('Authorization', '').removeprefix('Bearer ')
            token = AuthToken.verify(raw_token)
            if token is None:
                return api_error('invalid_token', 'A valid session or Bearer token is required.', 401)
            user = token.user
        records = user.token_usage_records.all()
        return JsonResponse({
            'records': [serialize_usage_record(record) for record in records],
            'generatedAt': timezone.now().isoformat(),
            'sessionCount': records.values('session_id').distinct().count(),
        })

    if request.method != 'POST':
        return api_error('method_not_allowed', 'Use GET or POST for this endpoint.', 405)
    raw_token = request.headers.get('Authorization', '').removeprefix('Bearer ')
    token = AuthToken.verify(raw_token)
    if token is None:
        return api_error('invalid_token', 'A valid Bearer token is required.', 401)
    try:
        payload = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return api_error('invalid_json', 'Request body must be valid JSON.', 400)
    try:
        records = validate_usage_records(payload)
    except ValueError as error:
        return api_error('invalid_records', str(error), 400)
    with transaction.atomic():
        for record in records:
            source = record.get('source', 'external')
            token.user.token_usage_records.update_or_create(
                source=source,
                day=record['day'],
                model=record['model'],
                session_id=record['sessionId'],
                defaults={
                    'title': record.get('title', ''),
                    'calls': record['calls'],
                    'input_tokens': record['input'],
                    'output_tokens': record['output'],
                    'cache_write_tokens': record['cacheWrite'],
                    'cache_read_tokens': record['cacheRead'],
                },
            )
    return JsonResponse({
        'success': True,
        'received': len(records),
        'upserted': len(records),
        'generatedAt': timezone.now().isoformat(),
    })
