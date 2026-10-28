from django.shortcuts import render, redirect
from django.contrib.auth import login, logout, authenticate, update_session_auth_hash
from django.contrib.auth.models import User
from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.utils import timezone
from django.db import models
from .models import Profile, Plan, Subscription, TokenUsage
import random
import string


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


def register(request):
    if request.method == 'POST':
        username = request.POST.get('username', '').strip()
        email = request.POST.get('email', '').strip()
        phone = request.POST.get('phone', '').strip()
        password = request.POST.get('password', '')
        password2 = request.POST.get('password2', '')
        captcha_answer = request.POST.get('captcha', '').strip()
        captcha_expected = request.POST.get('captcha_expected', '')

        if not username or not password:
            messages.error(request, 'Username and password are required.')
            return render(request, 'accounts/register.html')

        if password != password2:
            messages.error(request, 'Passwords do not match.')
            return render(request, 'accounts/register.html')

        if captcha_answer != captcha_expected:
            messages.error(request, 'Incorrect verification code.')
            return render(request, 'accounts/register.html')

        if User.objects.filter(username=username).exists():
            messages.error(request, 'Username already taken.')
            return render(request, 'accounts/register.html')

        if email and User.objects.filter(email=email).exists():
            messages.error(request, 'Email already registered.')
            return render(request, 'accounts/register.html')

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
        return redirect('dashboard')

    # GET: 生成验证码
    question, answer = generate_captcha()
    return render(request, 'accounts/register.html', {'captcha_question': question, 'captcha_expected': answer})


def login_view(request):
    if request.user.is_authenticated:
        return redirect('dashboard')

    if request.method == 'POST':
        username = request.POST.get('username', '').strip()
        password = request.POST.get('password', '')

        user = authenticate(request, username=username, password=password)
        if user is not None:
            login(request, user)
            next_url = request.GET.get('next', 'dashboard')
            return redirect(next_url)
        else:
            messages.error(request, 'Invalid username or password.')

    return render(request, 'accounts/login.html')


def logout_view(request):
    logout(request)
    return redirect('login')


@login_required
def dashboard(request):
    profile = request.user.profile
    subscription = request.user.subscriptions.filter(status='active').first()
    token_usage = request.user.token_usages.aggregate(total=models.Sum('tokens_used'))['total'] or 0
    return render(request, 'accounts/dashboard.html', {
        'user': request.user,
        'profile': profile,
        'subscription': subscription,
        'token_usage': token_usage,
    })


@login_required
def profile_view(request):
    profile = request.user.profile
    if request.method == 'POST':
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

    return render(request, 'accounts/profile.html', {'user': request.user, 'profile': profile})


@login_required
def security_view(request):
    if request.method == 'POST':
        action = request.POST.get('action')

        if action == 'change_password':
            old_password = request.POST.get('old_password', '')
            new_password = request.POST.get('new_password', '')
            new_password2 = request.POST.get('new_password2', '')

            if not request.user.check_password(old_password):
                messages.error(request, 'Current password is incorrect.')
            elif new_password != new_password2:
                messages.error(request, 'New passwords do not match.')
            elif len(new_password) < 6:
                messages.error(request, 'Password must be at least 6 characters.')
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

    return render(request, 'accounts/security.html', {'user': request.user})


@login_required
def pricing_view(request):
    plans = Plan.objects.all().order_by('price_monthly')
    current_subscription = request.user.subscriptions.filter(status='active').first()
    return render(request, 'accounts/pricing.html', {
        'plans': plans,
        'current_subscription': current_subscription,
    })
