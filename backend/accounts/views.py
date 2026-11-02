from django.shortcuts import render, redirect
from django.contrib.auth import login, logout, authenticate, update_session_auth_hash
from django.contrib.auth.models import User
from django.contrib.auth.decorators import login_required
from django.contrib.auth.password_validation import validate_password
from django.contrib import messages
from django.core.exceptions import ValidationError
from django.http import Http404, HttpResponse
from django.utils import timezone
from django.utils.http import url_has_allowed_host_and_scheme
from django.db import models
from django.views.decorators.http import require_GET, require_POST
from . import security
from .models import Profile, Plan, Subscription, TokenUsage
import random
import string

CAPTCHA_QUESTION_KEY = 'account_captcha_question'
CAPTCHA_ANSWER_KEY = 'account_captcha_answer'
LOGIN_REDIRECT_NAME = 'dashboard'
AVATAR_MAX_BYTES = 2 * 1024 * 1024
AVATAR_FILENAMES = {
    'image/png': 'avatar.png',
    'image/jpeg': 'avatar.jpg',
    'image/webp': 'avatar.webp',
}


def generate_captcha():
    """生成简单数学验证码"""
    a = random.randint(1, 20)
    b = random.randint(1, 20)
    op = random.choice(['+', '-'])
    if op == '+':
        answer = a + b
    else:
        answer = a - b
        if answer < 0:
            a, b = b, a
            answer = a - b
    question = f"{a} {op} {b} = ?"
    return question, str(answer)


def issue_captcha(request):
    """Create a captcha and keep its expected answer in the session only."""
    question, answer = generate_captcha()
    request.session[CAPTCHA_QUESTION_KEY] = question
    request.session[CAPTCHA_ANSWER_KEY] = answer
    return question


def captcha_question(request):
    return request.session.get(CAPTCHA_QUESTION_KEY, '')


def render_register(request, status=200):
    return render(request, 'accounts/register.html', {
        'captcha_question': captcha_question(request),
    }, status=status)


def password_policy_errors(password, user=None):
    """Return Django validator messages for a candidate password."""
    try:
        validate_password(password, user=user)
    except ValidationError as exc:
        return list(exc.messages)
    return []


def safe_next_target(request, fallback=LOGIN_REDIRECT_NAME):
    """Only follow next targets on an allowed host and scheme."""
    target = request.POST.get('next') or request.GET.get('next') or ''
    if target and url_has_allowed_host_and_scheme(
        target,
        allowed_hosts={request.get_host()},
        require_https=request.is_secure(),
    ):
        return target
    return fallback


def throttled(request, scope, template, username=None):
    messages.error(request, 'Too many attempts. Please try again later.')
    response = render(request, template, {
        'captcha_question': captcha_question(request),
    }, status=429)
    if username is None:
        retry_after = security.retry_after_seconds(scope, request)
    else:
        retry_after = security.login_retry_after_seconds(scope, request, username)
    response['Retry-After'] = str(retry_after)
    return response


def failed_registration(request):
    security.record_failure(security.REGISTER_SCOPE, request)
    issue_captcha(request)
    return render_register(request)


def register(request):
    if request.method == 'POST':
        if security.is_throttled(security.REGISTER_SCOPE, request):
            issue_captcha(request)
            return throttled(request, security.REGISTER_SCOPE, 'accounts/register.html')

        username = request.POST.get('username', '').strip()
        email = request.POST.get('email', '').strip()
        phone = request.POST.get('phone', '').strip()
        password = request.POST.get('password', '')
        password2 = request.POST.get('password2', '')
        captcha_answer = request.POST.get('captcha', '').strip()
        captcha_expected = request.session.pop(CAPTCHA_ANSWER_KEY, None)

        if not username or not password:
            messages.error(request, 'Username and password are required.')
            return failed_registration(request)

        if password != password2:
            messages.error(request, 'Passwords do not match.')
            return failed_registration(request)

        if captcha_expected is None or captcha_answer != captcha_expected:
            messages.error(request, 'Incorrect verification code.')
            return failed_registration(request)

        if User.objects.filter(username=username).exists():
            messages.error(request, 'Username already taken.')
            return failed_registration(request)

        if email and User.objects.filter(email=email).exists():
            messages.error(request, 'Email already registered.')
            return failed_registration(request)

        candidate = User(username=username, email=email)
        policy_errors = password_policy_errors(password, user=candidate)
        if policy_errors:
            for message in policy_errors:
                messages.error(request, message)
            return failed_registration(request)

        user = User.objects.create_user(username=username, email=email, password=password)
        Profile.objects.create(user=user, phone=phone)

        # 自动分配 Free 套餐
        free_plan, _ = Plan.objects.get_or_create(
            name='free',
            defaults={
                'display_name': 'Free',
                'price_monthly': 0,
                'price_yearly': 0,
                'tokens_monthly': 5_000_000,
                'features': ['5M tokens/month', 'Basic models', 'Community support'],
            }
        )
        Subscription.objects.create(user=user, plan=free_plan, tokens_remaining=5_000_000)

        login(request, user)
        return redirect(LOGIN_REDIRECT_NAME)

    # GET: 生成验证码（答案只保存在 session 中）
    issue_captcha(request)
    return render_register(request)


def login_view(request):
    if request.user.is_authenticated:
        return redirect(LOGIN_REDIRECT_NAME)

    if request.method == 'POST':
        username = request.POST.get('username', '').strip()
        password = request.POST.get('password', '')

        if security.is_login_throttled(security.WEB_LOGIN_SCOPE, request, username):
            return throttled(
                request, security.WEB_LOGIN_SCOPE, 'accounts/login.html', username
            )

        user = authenticate(request, username=username, password=password)
        if user is not None:
            security.clear_login_success(security.WEB_LOGIN_SCOPE, request, username)
            login(request, user)
            return redirect(safe_next_target(request))

        security.record_login_failure(security.WEB_LOGIN_SCOPE, request, username)
        messages.error(request, 'Invalid username or password.')

    return render(request, 'accounts/login.html')


@require_POST
def logout_view(request):
    logout(request)
    return redirect('login')


def detect_avatar_content_type(data):
    """Return the image type of the given bytes, or '' when unsupported."""
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png'
    if data.startswith(b'\xff\xd8\xff'):
        return 'image/jpeg'
    if len(data) >= 12 and data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'image/webp'
    return ''


@login_required
def dashboard(request):
    """Send existing dashboard links to the merged profile page."""
    return redirect('profile')


@login_required
def token_usage(request):
    subscription = Subscription.objects.select_related('plan').filter(user=request.user).first()
    profile = getattr(request.user, 'profile', None)
    return render(request, 'accounts/token_usage.html', {'subscription': subscription, 'profile': profile})


def account_overview(user):
    """Build the account context: profile, active subscription and token total."""
    profile = user.profile
    subscription = user.subscriptions.filter(status='active').select_related('plan').first()
    token_usage = user.token_usages.aggregate(total=models.Sum('tokens_used'))['total'] or 0
    return {
        'user': user,
        'profile': profile,
        'subscription': subscription,
        'token_usage': token_usage,
    }


def store_avatar(request, profile):
    """Validate the uploaded image by magic bytes and store it on the profile."""
    upload = request.FILES.get('avatar')
    if upload is None:
        messages.error(request, 'Choose an image file to upload.')
        return redirect('profile')

    # Reject declared sizes before touching the payload, then confirm by reading
    # one byte past the limit so a stream cannot smuggle extra data past us.
    if upload.size and upload.size > AVATAR_MAX_BYTES:
        messages.error(request, 'Image must be 2 MB or smaller.')
        return redirect('profile')

    data = upload.read(AVATAR_MAX_BYTES + 1)
    if not data:
        messages.error(request, 'Choose an image file to upload.')
        return redirect('profile')
    if len(data) > AVATAR_MAX_BYTES:
        messages.error(request, 'Image must be 2 MB or smaller.')
        return redirect('profile')

    content_type = detect_avatar_content_type(data)
    if not content_type:
        messages.error(request, 'Image must be a PNG, JPEG or WebP file.')
        return redirect('profile')

    profile.avatar_data = data
    profile.avatar_content_type = content_type
    profile.avatar_updated_at = timezone.now()
    profile.save(update_fields=['avatar_data', 'avatar_content_type', 'avatar_updated_at'])
    messages.success(request, 'Avatar updated.')
    return redirect('profile')


@login_required
@require_GET
def avatar_view(request):
    """Serve the signed-in user's stored avatar bytes."""
    profile = getattr(request.user, 'profile', None)
    if profile is None or not profile.avatar_data:
        raise Http404('No avatar stored.')

    content_type = profile.avatar_content_type or 'application/octet-stream'
    response = HttpResponse(bytes(profile.avatar_data), content_type=content_type)
    response['Content-Disposition'] = 'inline; filename="%s"' % AVATAR_FILENAMES.get(
        content_type, 'avatar'
    )
    response['X-Content-Type-Options'] = 'nosniff'
    response['Cache-Control'] = 'private, no-store'
    return response


@login_required
def profile_view(request):
    profile = request.user.profile
    if request.method == 'POST':
        if request.POST.get('action') == 'avatar':
            return store_avatar(request, profile)

        username = request.POST.get('username', '').strip()
        email = request.POST.get('email', '').strip()
        phone = request.POST.get('phone', '').strip()

        if username and username != request.user.username:
            if User.objects.filter(username=username).exists():
                messages.error(request, 'Username already taken.')
            else:
                request.user.username = username
                request.user.save()
                messages.success(request, 'Username updated.')

        if email and email != request.user.email:
            request.user.email = email
            request.user.save()
            messages.success(request, 'Email updated.')

        if phone != profile.phone:
            profile.phone = phone
            profile.save()
            messages.success(request, 'Phone updated.')

        return redirect('profile')

    return render(request, 'accounts/profile.html', account_overview(request.user))


@login_required
def security_view(request):
    if request.method == 'POST':
        action = request.POST.get('action')

        if action == 'change_password':
            old_password = request.POST.get('old_password', '')
            new_password = request.POST.get('new_password', '')
            new_password2 = request.POST.get('new_password2', '')

            policy_errors = password_policy_errors(new_password, user=request.user)

            if not request.user.check_password(old_password):
                messages.error(request, 'Current password is incorrect.')
            elif new_password != new_password2:
                messages.error(request, 'New passwords do not match.')
            elif len(new_password) < 6:
                messages.error(request, 'Password must be at least 6 characters.')
            elif policy_errors:
                for message in policy_errors:
                    messages.error(request, message)
            else:
                request.user.set_password(new_password)
                request.user.save()
                update_session_auth_hash(request, request.user)
                messages.success(request, 'Password changed successfully.')
                return redirect('security')

        elif action == 'delete_account':
            password = request.POST.get('password', '')
            if request.user.check_password(password):
                request.user.delete()
                messages.success(request, 'Account deleted.')
                return redirect('login')
            else:
                messages.error(request, 'Incorrect password.')

    return render(request, 'accounts/security.html', {'user': request.user, 'profile': getattr(request.user, 'profile', None)})
