# OuroNex — Deployment Guide

## Local Development (One-Click)

### Windows
```powershell
cd D:\Development\OuroNex-Official-Website
powershell -File scripts\dev.ps1
```

### Linux/Mac
```bash
cd /path/to/OuroNex-Official-Website
cd backend
python manage.py migrate
python manage.py runserver 8000
```

Access:
- Static site: http://localhost:8000/index.html
- Login: http://localhost:8000/login/
- Register: http://localhost:8000/register/
- Dashboard: http://localhost:8000/dashboard/
- Admin: http://localhost:8000/admin/

## Remote Deployment

### Option 1: Single VPS (Simplest)

**Requirements**: Ubuntu 22.04+, Python 3.11+

```bash
# 1. Clone repo
git clone <your-repo> /opt/ouronex
cd /opt/ouronex

# 2. Install dependencies
python3 -m venv venv
source venv/bin/activate
pip install django gunicorn

# 3. Configure production settings
cd backend
# Edit backend/settings.py:
#   DEBUG = False
#   ALLOWED_HOSTS = ['yourdomain.com']
#   SECRET_KEY = '<generate-strong-key>'

# 4. Migrate
python manage.py migrate

# 5. Create admin user
python manage.py createsuperuser

# 6. Collect static
python manage.py collectstatic

# 7. Run with Gunicorn
gunicorn --bind 0.0.0.0:8000 backend.wsgi:application
```

**With Nginx** (recommended):
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /static/ {
        alias /opt/ouronex/backend/staticfiles/;
    }
}
```

**With Systemd** (auto-restart):
```ini
# /etc/systemd/system/ouronex.service
[Unit]
Description=OuroNex
After=network.target

[Service]
User=www-data
WorkingDirectory=/opt/ouronex/backend
ExecStart=/opt/ouronex/venv/bin/gunicorn --bind 127.0.0.1:8000 backend.wsgi:application
Restart=always

[Install]
WantedBy=multi-user.target
```

### Option 2: Docker (Portable)

```dockerfile
# Dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install -r requirements.txt
COPY backend/ .
RUN python manage.py migrate
EXPOSE 8000
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "backend.wsgi:application"]
```

```bash
docker build -t ouronex .
docker run -p 8000:8000 ouronex
```

### Option 3: Platform-as-a-Service

**Railway**:
1. Connect GitHub repo
2. Set build command: `cd backend && pip install -r requirements.txt && python manage.py migrate`
3. Set start command: `cd backend && gunicorn backend.wsgi:application`

**Render**:
1. New Web Service
2. Build command: `cd backend && pip install -r requirements.txt && python manage.py migrate`
3. Start command: `cd backend && gunicorn backend.wsgi:application`

**PythonAnywhere**:
1. Upload code
2. Set WSGI file to `backend.wsgi:application`
3. Add static files mapping

## Application Authentication API

Separately developed applications authenticate through Django rather than reading the SQLite file. The versioned Bearer-token endpoints and response contract are documented in [APPLICATION_AUTH_API.md](APPLICATION_AUTH_API.md).

- `POST /api/v1/auth/login/`
- `GET /api/v1/auth/me/`
- `POST /api/v1/auth/logout/`

Set `OURONEX_AUTH_TOKEN_TTL_SECONDS` to override the default 30-day token lifetime. Run `python manage.py migrate` when deploying this feature.

## Database

**Development**: SQLite (default, no setup)

**Production** (optional):
```python
# settings.py
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': 'ouronex',
        'USER': 'ouronex_user',
        'PASSWORD': 'strong-password',
        'HOST': 'localhost',
        'PORT': '5432',
    }
}
```

## Admin (CMS)

Access: http://yourdomain.com/admin/

Create superuser:
```bash
python manage.py createsuperuser
```

Manage:
- Users (username, email, active status)
- Profiles (UID, phone, verification)
- Plans (Free/Lite/Standard/Professional/Enterprise)
- Subscriptions (active plans, token balances)
- Token Usage (consumption history)

## Security Checklist

- [ ] `DEBUG = False` in production
- [ ] Strong `SECRET_KEY` (use `django.core.management.utils.get_random_secret_key()`)
- [ ] `ALLOWED_HOSTS` set to your domain
- [ ] HTTPS enabled (Let's Encrypt / Cloudflare)
- [ ] CSRF middleware re-enabled (currently disabled for dev)
- [ ] Rate limiting on login/register
- [ ] Regular database backups

## Next Steps

1. **Re-enable CSRF**: Remove `#` from `django.middleware.csrf.CsrfViewMiddleware` in settings.py, add `{% csrf_token %}` back to forms
2. **Email verification**: Add Django's built-in email backend
3. **Payment integration**: Stripe or PayPal for subscriptions
4. **Token metering**: Real usage tracking with API keys
5. **Usage charts**: Chart.js or D3.js for dashboard
