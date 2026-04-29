"""
Verifica i token JWT di Firebase Auth.
Il frontend manda l'header: Authorization: Bearer <firebase_id_token>
"""

import requests
from django.conf import settings
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from .models import UserProfile


def verify_firebase_token(id_token: str) -> dict:
    """
    Verifica il token Firebase tramite l'endpoint pubblico di Google.
    Restituisce il payload del token (con uid, email, ecc.) o lancia un'eccezione.
    """
    try:
        resp = requests.post(
            f"https://identitytoolkit.googleapis.com/v1/accounts:lookup",
            params={"key": settings.FIREBASE_WEB_API_KEY},
            headers={"Referer": "https://trenibet.com"},
            json={"idToken": id_token},
            timeout=5,
        )
    except requests.RequestException:
        raise AuthenticationFailed("Impossibile verificare il token Firebase.")

    if resp.status_code != 200:
        raise AuthenticationFailed("Token Firebase non valido.")

    data = resp.json()
    users = data.get("users", [])
    if not users:
        raise AuthenticationFailed("Utente non trovato in Firebase.")

    return users[0]  # {'localId': uid, 'email': ..., ...}


class FirebaseAuthentication(BaseAuthentication):
    """
    DRF Authentication backend che verifica il token Firebase.
    Aggiunge automaticamente l'utente al database Django se non esiste.
    """

    def authenticate(self, request):
        auth_header = request.headers.get('Authorization', '')
        
        if not auth_header.startswith('Bearer '):
            return None  # Nessun token → richiesta anonima

        id_token = auth_header.split('Bearer ')[1].strip()
        if not id_token:
            return None

        try:
            firebase_user = verify_firebase_token(id_token)
        except AuthenticationFailed:
            raise
        except Exception:
            raise AuthenticationFailed("Errore durante la verifica del token.")

        uid = firebase_user.get('localId')
        email = firebase_user.get('email', '')
        is_verified = firebase_user.get('emailVerified', False)

        # Recupera l'utente
        user_profile, created = UserProfile.objects.get_or_create(
            uid=uid,
            defaults={
                'nickname': email.split('@')[0],
                'balance': 500,
                'is_email_verified': is_verified,
            }
        )

        # LOGICA DI FERRO:
        # 1. Se Firebase dice che è verificato (is_verified == True), lo mettiamo True nel DB.
        # 2. Se nel DB è già True (magari messo a mano dall'admin), NON lo rimettiamo mai a False.
        if is_verified and not user_profile.is_email_verified:
            user_profile.is_email_verified = True
            user_profile.save()

        # Ritorna una tupla (user, token) come richiesto da DRF
        return (user_profile, id_token)

