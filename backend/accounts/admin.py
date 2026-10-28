from django.contrib import admin
from .models import Profile, Plan, Subscription, TokenUsage


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'uid', 'phone', 'email_verified', 'created_at']
    search_fields = ['user__username', 'uid', 'phone']
    list_filter = ['email_verified']


@admin.register(Plan)
class PlanAdmin(admin.ModelAdmin):
    list_display = ['name', 'display_name', 'price_monthly', 'price_yearly', 'tokens_monthly', 'is_enterprise']
    list_filter = ['is_enterprise']


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display = ['user', 'plan', 'status', 'started_at', 'expires_at', 'tokens_remaining']
    list_filter = ['status', 'plan']
    search_fields = ['user__username']


@admin.register(TokenUsage)
class TokenUsageAdmin(admin.ModelAdmin):
    list_display = ['user', 'tokens_used', 'recorded_at']
    list_filter = ['recorded_at']
    search_fields = ['user__username']
