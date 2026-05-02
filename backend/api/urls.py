from django.urls import path
from . import views

urlpatterns = [
    # ---- Proxy Viaggiatreno ----
    path('partenze/<str:codice>/', views.partenze),
    path('arrivi/<str:codice>/', views.arrivi),
    path('treno/<str:cod_origine>/<str:numero>/<str:data>/', views.treno),
    path('stazioni/<str:query>/', views.stazioni),
    path('cercatreno/<str:numero>/', views.cerca_treno),
    path('health/', views.health),
    path('firebase-config/', views.firebase_config),

    # ---- Auth (gestita dal backend) ----
    path('auth/register/', views.register),
    path('auth/login/', views.login),
    path('auth/google/', views.google_login),
    path('auth/refresh/', views.token_refresh),
    path('auth/reset-password/', views.reset_password),
    path('auth/resend-verification/', views.resend_verification),

    # ---- Utente ----
    path('user/', views.user_profile),

    # ---- Scommesse ----
    path('bets/active/', views.active_bets),
    path('bets/past/', views.past_bets),
    path('bets/place/', views.place_bet),
    path('bets/stats/', views.global_bet_stats),
    path('bets/odds/<str:train_id>/', views.get_odds),
    path('bets/wins/', views.global_wins),
    path('bets/distribution/<str:train_id>/', views.train_bet_distribution),

    # ---- Leaderboard ----
    path('leaderboard/', views.leaderboard),
]

#╰─ cloudflared tunnel run --url http://localhost:3000 trenibet-tunnel