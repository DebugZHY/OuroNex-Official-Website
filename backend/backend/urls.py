from django.contrib import admin
from django.urls import path, include, re_path
from django.views.generic import RedirectView
from django.views.static import serve
from django.conf import settings

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', RedirectView.as_view(url='/login/', permanent=False)),
    path('', include('accounts.urls')),
    # Serve static site files (index.html, pricing.html, assets/, etc.)
    re_path(r'^(?P<path>.*)$', serve, {'document_root': settings.STATIC_SITE_ROOT}),
]
