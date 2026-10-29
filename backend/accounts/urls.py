from django.urls import path
from . import api, views

urlpatterns = [
    path('api/v1/auth/login/', api.login, name='api-login'),
    path('api/v1/auth/me/', api.me, name='api-me'),
    path('api/v1/auth/logout/', api.logout, name='api-logout'),
    path('register/', views.register, name='register'),
    path('login/', views.login_view, name='login'),
    path('logout/', views.logout_view, name='logout'),
    path('dashboard/', views.dashboard, name='dashboard'),
    path('profile/', views.profile_view, name='profile'),
    path('profile/security/', views.security_view, name='security'),
    path('pricing/', views.pricing_view, name='pricing'),
]
