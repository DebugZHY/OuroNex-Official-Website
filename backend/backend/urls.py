from django.contrib import admin
from django.urls import include, path, re_path

from . import public_site

urlpatterns = [
    path('admin/', admin.site.urls),
    path('health/', public_site.health, name='health'),
    path('', include('accounts.urls')),
    # Only package-manifest.json files[].path entries are readable. This is not
    # a repository-root static handler: every other path returns 404.
    re_path(r'^(?P<path>.*)$', public_site.public_file, name='public-file'),
]
