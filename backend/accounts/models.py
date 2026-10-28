from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
import secrets
import string


def generate_uid():
    return ''.join(secrets.choice(string.digits) for _ in range(18))


class Profile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    uid = models.CharField(max_length=20, unique=True, default=generate_uid)
    phone = models.CharField(max_length=20, blank=True)
    email_verified = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.username}'s profile"


class Plan(models.Model):
    PLAN_CHOICES = [
        ('free', 'Free'),
        ('lite', 'Lite'),
        ('standard', 'Standard'),
        ('professional', 'Professional'),
        ('enterprise', 'Enterprise'),
    ]
    name = models.CharField(max_length=20, choices=PLAN_CHOICES, unique=True)
    display_name = models.CharField(max_length=50)
    price_monthly = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    price_yearly = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    tokens_monthly = models.BigIntegerField(default=0)  # 每月 token 额度
    features = models.JSONField(default=list)  # 功能列表
    is_enterprise = models.BooleanField(default=False)

    def __str__(self):
        return self.display_name


class Subscription(models.Model):
    STATUS_CHOICES = [
        ('active', 'Active'),
        ('expired', 'Expired'),
        ('cancelled', 'Cancelled'),
    ]
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='subscriptions')
    plan = models.ForeignKey(Plan, on_delete=models.CASCADE)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='active')
    started_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    tokens_remaining = models.BigIntegerField(default=0)

    def __str__(self):
        return f"{self.user.username} — {self.plan.display_name} ({self.status})"

    def is_active(self):
        return self.status == 'active' and (self.expires_at is None or self.expires_at > timezone.now())


class TokenUsage(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='token_usages')
    tokens_used = models.BigIntegerField(default=0)
    recorded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.user.username}: {self.tokens_used} tokens"
