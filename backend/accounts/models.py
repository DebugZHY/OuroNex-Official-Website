from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
from django.conf import settings
from datetime import timedelta
import hashlib
import secrets
import string


def generate_uid():
    return ''.join(secrets.choice(string.digits) for _ in range(18))


class Profile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    uid = models.CharField(max_length=20, unique=True, default=generate_uid)
    phone = models.CharField(max_length=20, blank=True)
    email_verified = models.BooleanField(default=False)
    avatar_data = models.BinaryField(null=True, blank=True)
    avatar_content_type = models.CharField(max_length=64, blank=True, default='')
    avatar_updated_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.username}'s profile"

    @property
    def has_avatar(self):
        """Whether this profile stores avatar bytes."""
        return bool(self.avatar_data)

    @property
    def avatar_url(self):
        """Versioned avatar URL, or an empty string when no bytes are stored."""
        if not self.avatar_data:
            return ''
        version = int(self.avatar_updated_at.timestamp()) if self.avatar_updated_at else 0
        return f'/profile/avatar/?v={version}'


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


class TokenUsageRecord(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='token_usage_records')
    day = models.DateField()
    model = models.CharField(max_length=120)
    session_id = models.CharField(max_length=200)
    title = models.CharField(max_length=255, blank=True)
    source = models.CharField(max_length=80, default='external')
    calls = models.PositiveBigIntegerField(default=0)
    input_tokens = models.PositiveBigIntegerField(default=0)
    output_tokens = models.PositiveBigIntegerField(default=0)
    cache_write_tokens = models.PositiveBigIntegerField(default=0)
    cache_read_tokens = models.PositiveBigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['day', 'model', 'session_id', 'source']
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'source', 'day', 'model', 'session_id'],
                name='unique_token_usage_record',
            ),
        ]
        indexes = [
            models.Index(fields=['user', 'day'], name='usage_record_user_day'),
            models.Index(fields=['user', 'session_id'], name='usage_record_session'),
        ]

    def __str__(self):
        return f"{self.user.username}: {self.day} {self.model} {self.session_id}"


class AuthToken(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='auth_tokens')
    key_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    last_used_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    @classmethod
    def issue(cls, user):
        raw_token = f"onx_{secrets.token_urlsafe(32)}"
        ttl = timedelta(seconds=settings.OURONEX_AUTH_TOKEN_TTL_SECONDS)
        token = cls.objects.create(
            user=user,
            key_hash=hashlib.sha256(raw_token.encode()).hexdigest(),
            expires_at=timezone.now() + ttl,
        )
        return raw_token, token

    @classmethod
    def verify(cls, raw_token):
        key_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        now = timezone.now()
        token = cls.objects.select_related('user').filter(
            key_hash=key_hash,
            expires_at__gt=now,
            revoked_at__isnull=True,
            user__is_active=True,
        ).first()
        if token is None:
            return None
        token.last_used_at = now
        token.save(update_fields=['last_used_at'])
        return token
