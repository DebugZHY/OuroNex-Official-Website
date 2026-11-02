from django.urls import path
from . import api, views

urlpatterns = [
    path('api/v1/auth/login/', api.login, name='api-login'),
    path('api/v1/auth/me/', api.me, name='api-me'),
    path('api/v1/auth/logout/', api.logout, name='api-logout'),
    path('api/v1/usage/', api.usage, name='api-usage'),
    path('register/', views.register, name='register'),
    path('login/', views.login_view, name='login'),
    path('logout/', views.logout_view, name='logout'),
    path('dashboard/', views.dashboard, name='dashboard'),
    path('dashboard/usage/', views.token_usage, name='token-usage'),
    path('profile/', views.profile_view, name='profile'),
    path('profile/avatar/', views.avatar_view, name='profile-avatar'),
    path('profile/security/', views.security_view, name='security'),
]
