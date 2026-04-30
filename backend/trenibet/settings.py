"""
Treni.bet — Django Settings
"""

import environ
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DEBUG=(bool, False),
)

environ.Env.read_env(BASE_DIR / '.env')

SECRET_KEY = env('SECRET_KEY')

DEBUG = env('DEBUG', default=False)

ALLOWED_HOSTS = env.list('ALLOWED_HOSTS', default=['trenibet.com', 'www.trenibet.com', 'localhost', '127.0.0.1'])

# Importante per Cloudflare Tunnel
CSRF_TRUSTED_ORIGINS = [
    'https://*.trycloudflare.com',
    'https://trenibet.com',
    'https://www.trenibet.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
]

# ---- APPS ----
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # Terze parti
    'rest_framework',
    'corsheaders',
    # Nostra app
    'api',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',   # DEVE essere prima di tutto
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'trenibet.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'trenibet.wsgi.application'

# ---- DATABASE ----
# Usa SQLite in locale, PostgreSQL in produzione (Railway setta DATABASE_URL automaticamente)
DATABASES = {
    'default': env.db('DATABASE_URL', default=f'sqlite:///{BASE_DIR / "db.sqlite3"}')
}

# ---- CORS ----
CORS_ALLOW_ALL_ORIGINS = env.bool('CORS_ALLOW_ALL', default=False)
CORS_ALLOWED_ORIGINS = [
    'https://trenibet.com',
    'https://www.trenibet.com',
]

# ---- CELERY (Bet Resolver in background) ----
# Redis è usato come broker per Celery.
# In locale: installa Redis con `brew install redis` o `sudo apt install redis`
# Su Railway: aggiungi un servizio Redis
CELERY_BROKER_URL = env('REDIS_URL', default='redis://localhost:6379/0')
CELERY_RESULT_BACKEND = env('REDIS_URL', default='redis://localhost:6379/0')
CELERY_BEAT_SCHEDULE = {
    'resolve-bets-every-60s': {
        'task': 'api.tasks.resolve_bets',
        'schedule': 60.0,  # ogni 60 secondi, come in server.js
    },
}

# ---- STATIC FILES ----
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

# ---- CACHE (Redis condiviso per i workers) ----
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": env('REDIS_URL', default='redis://localhost:6379/0'),
    }
}

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# ---- FIREBASE (per Auth — manteniamo Firebase solo per autenticazione) ----
# Le credenziali del tuo progetto Firebase (usate per verificare i token JWT)
FIREBASE_PROJECT_ID = env('FIREBASE_PROJECT_ID', default='trenibet')
FIREBASE_WEB_API_KEY = env('FIREBASE_WEB_API_KEY', default='')
FIREBASE_AUTH_DOMAIN = env('FIREBASE_AUTH_DOMAIN', default='')
FIREBASE_STORAGE_BUCKET = env('FIREBASE_STORAGE_BUCKET', default='')
FIREBASE_MESSAGING_SENDER_ID = env('FIREBASE_MESSAGING_SENDER_ID', default='')
FIREBASE_APP_ID = env('FIREBASE_APP_ID', default='')
FIREBASE_MEASUREMENT_ID = env('FIREBASE_MEASUREMENT_ID', default='')

# ---- SECURITY (per Cloudflare) ----
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
USE_X_FORWARDED_HOST = True
TIME_ZONE = 'Europe/Rome'
USE_I18N = True
USE_TZ = True
