"""
Treni.bet — Django Views
"""

import time
import uuid
from datetime import datetime
import requests
from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.http import HttpResponse
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from django.utils import timezone
from .models import UserProfile, Bet
from .serializers import UserProfileSerializer, BetSerializer, LeaderboardSerializer
from .firebase_auth import FirebaseAuthentication

VT_BASE = "http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno"
FIREBASE_REST_URL = "https://identitytoolkit.googleapis.com/v1/accounts"


# ============================================================
# PROXY — Viaggiatreno
# ============================================================

def proxy_request(vt_path):
    url = f"{VT_BASE}{vt_path}"
    try:
        resp = requests.get(url, timeout=10)
        return HttpResponse(
            resp.content,
            content_type=resp.headers.get("content-type", "application/json"),
            status=resp.status_code,
        )
    except requests.RequestException as e:
        return HttpResponse(
            f'{{"error": "Errore Viaggiatreno", "details": "{str(e)}"}}',
            content_type="application/json",
            status=500,
        )


@api_view(["GET"])
@permission_classes([AllowAny])
def partenze(request, codice):
    ts = requests.utils.quote(time.strftime("%a %b %d %Y %H:%M:%S GMT+0000", time.gmtime()))
    return proxy_request(f"/partenze/{codice}/{ts}")


@api_view(["GET"])
@permission_classes([AllowAny])
def arrivi(request, codice):
    ts = requests.utils.quote(time.strftime("%a %b %d %Y %H:%M:%S GMT+0000", time.gmtime()))
    return proxy_request(f"/arrivi/{codice}/{ts}")


@api_view(["GET"])
@permission_classes([AllowAny])
def treno(request, cod_origine, numero, data):
    return proxy_request(f"/andamentoTreno/{cod_origine}/{numero}/{data}")


@api_view(["GET"])
@permission_classes([AllowAny])
def stazioni(request, query):
    return proxy_request(f"/autocompletaStazione/{requests.utils.quote(query)}")


@api_view(["GET"])
@permission_classes([AllowAny])
def cerca_treno(request, numero):
    return proxy_request(f"/cercaNumeroTrenoTrenoAutocomplete/{numero}")


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    return Response({"status": "ok", "timestamp": time.time()})


# ============================================================
# AUTH — tutto gestito dal backend
# ============================================================

def _firebase_rest(endpoint: str, payload: dict) -> dict:
    """Chiama le API REST di Firebase Auth e traduce gli errori in italiano."""
    resp = requests.post(
        f"{FIREBASE_REST_URL}:{endpoint}",
        params={"key": settings.FIREBASE_WEB_API_KEY},
        headers={"Referer": "https://trenibet.com"},
        json=payload,
        timeout=10,
    )
    data = resp.json()
    if resp.status_code != 200:
        error_code = data.get("error", {}).get("message", "ERRORE_SCONOSCIUTO")
        messaggi = {
            "EMAIL_EXISTS":             "Email già registrata.",
            "EMAIL_NOT_FOUND":          "Email non trovata.",
            "INVALID_PASSWORD":         "Password non corretta.",
            "INVALID_LOGIN_CREDENTIALS":"Email o password non corretti.",
            "INVALID_EMAIL":            "Email non valida.",
            "WEAK_PASSWORD : Password should be at least 6 characters":
                                        "La password deve essere di almeno 6 caratteri.",
            "TOO_MANY_ATTEMPTS_TRY_LATER": "Troppi tentativi. Riprova tra qualche minuto.",
            "USER_DISABLED":            "Account disabilitato.",
            "USER_NOT_FOUND":           "Utente non trovato.",
        }
        raise ValueError(messaggi.get(error_code, f"Errore: {error_code}"))
    return data


@api_view(["POST"])
@permission_classes([AllowAny])
def register(request):
    """
    POST /api/auth/register/
    Body: { "email": "...", "password": "...", "nickname": "..." }
    """
    email    = request.data.get("email", "").strip().lower()
    password = request.data.get("password", "")
    nickname = request.data.get("nickname", "").strip() or email.split("@")[0]

    if not email or not password:
        return Response({"error": "Email e password obbligatori."}, status=400)

    try:
        firebase_data = _firebase_rest("signUp", {
            "email": email,
            "password": password,
            "returnSecureToken": True,
        })
    except ValueError as e:
        return Response({"error": str(e)}, status=400)

    uid           = firebase_data["localId"]
    id_token      = firebase_data["idToken"]
    refresh_token = firebase_data["refreshToken"]

    user_profile, created = UserProfile.objects.get_or_create(
        uid=uid,
        defaults={
            "nickname": nickname, 
            "balance": 500,
            "last_daily_bonus": timezone.now().date()
        },
    )

    # Assicurati che lo stato di verifica sia aggiornato (Solo da False a True)
    is_verified = firebase_data.get("emailVerified", False)
    if is_verified and not user_profile.is_email_verified:
        user_profile.is_email_verified = True
        user_profile.save()

    # Chiedi a Firebase di inviare l'email di verifica
    try:
        _firebase_rest("sendOobCode", {
            "requestType": "VERIFY_EMAIL",
            "idToken": id_token
        })
    except Exception as e:
        print(f"Errore invio email verifica: {e}")

    return Response({
        "token":        id_token,
        "refreshToken": refresh_token,
        "user":         UserProfileSerializer(user_profile).data,
    }, status=201)


@api_view(["POST"])
@permission_classes([AllowAny])
def login(request):
    """
    POST /api/auth/login/
    Body: { "email": "...", "password": "..." }
    """
    email    = request.data.get("email", "").strip().lower()
    password = request.data.get("password", "")

    if not email or not password:
        return Response({"error": "Email e password obbligatori."}, status=400)

    try:
        firebase_data = _firebase_rest("signInWithPassword", {
            "email": email,
            "password": password,
            "returnSecureToken": True,
        })
    except ValueError as e:
        return Response({"error": str(e)}, status=400)

    uid           = firebase_data["localId"]
    id_token      = firebase_data["idToken"]
    refresh_token = firebase_data["refreshToken"]

    user_profile, created = UserProfile.objects.get_or_create(
        uid=uid,
        defaults={"nickname": email.split("@")[0], "balance": 500},
    )

    # Assicurati che lo stato di verifica sia aggiornato (Solo da False a True)
    is_verified = firebase_data.get("emailVerified", False)
    if is_verified and not user_profile.is_email_verified:
        user_profile.is_email_verified = True
        user_profile.save()

    # Bonus giornaliero
    bonus_granted = user_profile.check_daily_bonus()

    return Response({
        "token":        id_token,
        "refreshToken": refresh_token,
        "user":         UserProfileSerializer(user_profile).data,
        "bonus_granted": bonus_granted,
    })

@api_view(["POST"])
@permission_classes([AllowAny])
def google_login(request):
    """
    POST /api/auth/google/
    Body: { "idToken": "..." }
    Verifica il token Firebase Google e logga l'utente.
    """
    from .firebase_auth import verify_firebase_token
    id_token = request.data.get("idToken")
    
    if not id_token:
        return Response({"error": "idToken obbligatorio."}, status=400)

    try:
        # Usa la funzione di verifica già presente nel progetto
        firebase_user = verify_firebase_token(id_token)
        uid = firebase_user.get('localId')
        email = firebase_user.get('email', '')
        
        # Recupera o crea il profilo utente locale
        user_profile, created = UserProfile.objects.get_or_create(
            uid=uid,
            defaults={
                "nickname": firebase_user.get('displayName') or email.split("@")[0], 
                "balance": 500,
                "is_email_verified": firebase_user.get('emailVerified', False)
            },
        )
        
        # Sincronizza lo stato di verifica se l'utente esisteva già (Solo da False a True)
        is_verified = firebase_user.get('emailVerified', False)
        if is_verified and not user_profile.is_email_verified:
            user_profile.is_email_verified = True
            user_profile.save()

        # Bonus giornaliero
        bonus_granted = user_profile.check_daily_bonus()

        # Fix #10: Il frontend invia anche il refreshToken dal popup Google
        refresh_token = request.data.get("refreshToken", "")

        return Response({
            "token": id_token,
            "refreshToken": refresh_token,
            "user": UserProfileSerializer(user_profile).data,
            "bonus_granted": bonus_granted,
        })

    except Exception as e:
        return Response({"error": f"Errore verifica Google: {str(e)}"}, status=401)


def _exchange_google_token_for_firebase_session(id_token):
    """
    Scambia un ID token Google (già verificato) per un refresh token Firebase.
    Usa l'endpoint verifyCustomToken con l'idToken originale.
    """
    try:
        # Ottieni dati utente dal token
        resp = requests.post(
            f"{FIREBASE_REST_URL}:lookup",
            params={"key": settings.FIREBASE_WEB_API_KEY},
            json={"idToken": id_token},
            timeout=5,
        )
        if resp.status_code != 200:
            return None, None
        
        data = resp.json()
        users = data.get("users", [])
        if not users:
            return None, None
        
        # Il token Google Firebase include già un refresh token se fatto via signInWithIdp
        # Ma se non c'è, generiamo una sessione usando signInWithPassword non è possibile.
        # Workaround: restituiamo il token e un placeholder, il frontend
        # gestirà la re-autenticazione con Google popup se scade.
        return id_token, None
    except Exception:
        return id_token, None


@api_view(["POST"])
@permission_classes([AllowAny])
def token_refresh(request):
    """
    POST /api/auth/refresh/
    Body: { "refreshToken": "..." }
    Rinnova il token scaduto automaticamente.
    """
    refresh = request.data.get("refreshToken", "")
    if not refresh:
        return Response({"error": "refreshToken obbligatorio."}, status=400)

    try:
        resp = requests.post(
            "https://securetoken.googleapis.com/v1/token",
            params={"key": settings.FIREBASE_WEB_API_KEY},
            headers={"Referer": "https://trenibet.com"},
            json={"grant_type": "refresh_token", "refresh_token": refresh},
            timeout=10,
        )
        data = resp.json()
        if resp.status_code != 200:
            return Response({"error": "Sessione scaduta. Effettua di nuovo il login."}, status=401)

        return Response({
            "token":        data["id_token"],
            "refreshToken": data["refresh_token"],
        })
    except Exception as e:
        return Response({"error": str(e)}, status=401)


@api_view(["POST"])
@permission_classes([AllowAny])
def reset_password(request):
    """
    POST /api/auth/reset-password/
    Body: { "email": "..." }
    """
    email = request.data.get("email", "").strip().lower()
    if not email:
        return Response({"error": "Email obbligatoria."}, status=400)

    try:
        _firebase_rest("sendOobCode", {
            "requestType": "PASSWORD_RESET",
            "email": email,
        })
        return Response({"message": "Email di reset inviata. Controlla la tua casella."})
    except ValueError as e:
        return Response({"error": str(e)}, status=400)


@api_view(["POST"])
@authentication_classes([FirebaseAuthentication])
@permission_classes([IsAuthenticated])
def resend_verification(request):
    """
    POST /api/auth/resend-verification/
    """
    try:
        # Il token viene estratto automaticamente da FirebaseAuthentication
        id_token = request.auth
        
        if not id_token:
            return Response({"error": "Sessione non valida."}, status=401)
            
        _firebase_rest("sendOobCode", {
            "requestType": "VERIFY_EMAIL",
            "idToken": id_token
        })
        return Response({"message": "Email di verifica reinviata con successo."})
    except Exception as e:
        return Response({"error": f"Errore invio email: {str(e)}"}, status=400)


# ============================================================
# UTENTE
# ============================================================

@api_view(["GET", "POST"])
@authentication_classes([FirebaseAuthentication])
@permission_classes([IsAuthenticated])
def user_profile(request):
    # Forza il ricaricamento dei dati dal database per essere sicuri al 100%
    user = UserProfile.objects.get(uid=request.user.uid)
    
    # Bonus giornaliero
    bonus_granted = user.check_daily_bonus()
    
    if request.method == "GET":
        resp_data = UserProfileSerializer(user).data
        resp_data["bonus_granted"] = bonus_granted
        return Response(resp_data)
    
    nickname = request.data.get("nickname", "").strip()
    if nickname:
        user.nickname = nickname
        user.save()
    
    resp_data = UserProfileSerializer(user).data
    resp_data["bonus_granted"] = bonus_granted
    return Response(resp_data)


# ============================================================
# SCOMMESSE
# ============================================================

@api_view(["GET"])
@authentication_classes([FirebaseAuthentication])
@permission_classes([IsAuthenticated])
def active_bets(request):
    bets = request.user.bets.filter(status=Bet.STATUS_ACTIVE)
    return Response(BetSerializer(bets, many=True).data)


@api_view(["GET"])
@authentication_classes([FirebaseAuthentication])
@permission_classes([IsAuthenticated])
def past_bets(request):
    bets = request.user.bets.exclude(status=Bet.STATUS_ACTIVE).order_by("-resolved_at")
    return Response(BetSerializer(bets, many=True).data)


@api_view(["GET"])
@permission_classes([AllowAny])
def global_wins(request):
    """
    Ritorna le ultime scommesse vinte globalmente per la bacheca.
    """
    wins = Bet.objects.filter(status='won').order_by('-resolved_at')[:30]
    data = []
    from datetime import datetime
    for w in wins:
        # Converti il timestamp ms in data leggibile
        date_str = ""
        if w.resolved_at:
            date_str = datetime.fromtimestamp(w.resolved_at / 1000.0).strftime("%d/%m %H:%M")
            
        data.append({
            'username': w.user.nickname,
            'trainNumber': w.train_number,
            'amount': w.amount,
            'odds': w.odds,
            'won_amount': round(w.amount * w.odds, 2),
            'date': date_str,
            'predictedDelay': w.predicted_delay
        })
    return Response(data)


@api_view(["POST"])
@authentication_classes([FirebaseAuthentication])
@permission_classes([IsAuthenticated])
def place_bet(request):
    user   = request.user
    data   = request.data
    
    amount_raw = str(data.get("amount", "0")).strip()
    import re
    if not re.match(r'^[1-9]\d*$', amount_raw):
        return Response({"error": "Importo non valido. Usa solo numeri interi (es. 25)."}, status=400)
    
    amount = int(amount_raw)

    if not user.is_email_verified:
        return Response({"error": "Devi verificare la tua email per poter scommettere. Controlla la tua casella di posta!"}, status=403)

    if amount <= 0:
        return Response({"error": "Importo non valido."}, status=400)
    if user.balance < amount:
        return Response({"error": "Token insufficienti."}, status=400)

    predicted_delay = int(request.data.get("predictedDelay", 0))
    if predicted_delay > 400:
        return Response({"error": "Il ritardo massimo scommettibile è di 400 minuti."}, status=400)

    train_id = data.get("trainId", "")
    if user.bets.filter(train_id=train_id, status=Bet.STATUS_ACTIVE).exists():
        return Response({"error": "Hai già una scommessa attiva su questo treno."}, status=400)

    # Standardizzazione dati per chiave cache
    clean_train_id = str(train_id).strip()
    clean_delay = int(float(predicted_delay or 0))

    # Fix: Recupera la quota BLOCCATA dalla cache invece di ricalcolarla
    from django.core.cache import cache
    cache_key = f"odds_lock:{user.id}:{clean_train_id}:{clean_delay}"
    server_odds = cache.get(cache_key)

    # Log di debug su file
    with open("backend_debug.log", "a") as f:
        f.write(f"[{datetime.now()}] GET: user={user.id} key={cache_key} result={server_odds}\n")

    if server_odds is None:
        return Response({
            "error": "Quota scaduta o non valida. Clicca su 'Calcola Quota' per aggiornare.",
            "debug_key": cache_key # Temporaneo per debug
        }, status=400)

    with transaction.atomic():
        user.balance -= amount
        user.save()
        bet = Bet.objects.create(
            user=user,
            bet_id=f"bet_{uuid.uuid4().hex[:16]}",
            train_id=train_id,
            train_number=data.get("trainNumber", ""),
            train_route=data.get("trainRoute", ""),
            predicted_delay=int(data.get("predictedDelay", 0)),
            amount=amount,
            odds=server_odds,
            station_code=data.get("stationCode", ""),
            data_partenza=str(data.get("dataPartenza", "")),
            scheduled_departure=int(data.get("scheduledDeparture", 0)),
            scheduled_arrival=int(data.get("scheduledArrival", 0)),
            placed_at=int(data.get("placedAt", int(time.time() * 1000))),
        )

    return Response(BetSerializer(bet).data, status=201)


def _calculate_server_odds(train_id, predicted_delay=None):
    """
    Calcola le odds lato server basandosi sui dati reali del treno.
    Identica alla logica del frontend ma non manipolabile.
    """
    try:
        parts = train_id.split('-') if train_id else []
        if len(parts) < 3:
            return 2.0
        
        numero = parts[0]
        cod_origine = parts[1]
        data_partenza = '-'.join(parts[2:])
        
        url = f"{VT_BASE}/andamentoTreno/{cod_origine}/{numero}/{data_partenza}"
        resp = requests.get(url, timeout=8)
        if resp.status_code != 200:
            return 2.0
        
        train_data = resp.json()
        category = (train_data.get('compTipologiaTreno') or train_data.get('categoria') or '').strip().upper()
        delay = train_data.get('ritardo', 0) or 0
        if delay < 0:
            delay = 0
        
        # Sincronizza logica con frontend
        odds = 2.0
        cat = category.upper()
        if any(x in cat for x in ['FR', 'FRECCIA', 'FA', 'FB']):
            odds -= 0.5
        elif any(x in cat for x in ['REG', 'RV', 'REGIONALE', 'VELOCE']):
            odds += 0.8
        elif any(x in cat for x in ['IC', 'INTERCITY']):
            odds += 0.3
        
        if delay > 60:
            odds -= 0.4
        elif delay == 0:
            odds += 0.5
        
        # Fattore fermate rimanenti (stessa logica del frontend)
        fermate = train_data.get('fermate', [])
        if fermate:
            # Calcolo fermate mancanti semplificato per il server
            last_detection = (train_data.get('stazioneUltimoRilevamento') or '').strip().upper()
            last_index = -1
            for i, f in enumerate(fermate):
                if (f.get('stazione') or '').strip().upper() == last_detection or (f.get('effettivo') or 0) > 0:
                    last_index = i
            
            missing_stops = max(0, len(fermate) - 1 - last_index)
            stop_factor = (missing_stops - 10) * 0.05
            odds += max(-1.0, min(1.0, stop_factor))

        # NUOVO: Fattore Pool (ogni 200 token la quota scende di 0.05)
        from django.db.models import Sum
        pool = Bet.objects.filter(train_id=train_id, status='active').aggregate(Sum('amount'))['amount__sum'] or 0
        if pool > 0:
            pool_factor = (pool / 200) * 0.05
            odds -= min(1.0, float(pool_factor))

        # NUOVO: Fattore "Tempo all'Arrivo" (Ultimi 20 minuti) con fuso orario corretto
        try:
            # Cerchiamo l'orario di arrivo finale (all'ultima fermata)
            sch_arr_str = train_data.get('compOrarioArrivoZeroEffettivo')
            
            # Se non c'è, proviamo a prenderlo dall'ultima fermata della lista
            if not sch_arr_str and fermate:
                sch_arr_str = fermate[-1].get('programmata') or fermate[-1].get('orarioArrivo')

            if sch_arr_str:
                import pytz
                from datetime import datetime, timedelta
                
                tz = pytz.timezone('Europe/Rome')
                now = datetime.now(tz)
                
                # Parsing orario (HH:mm)
                parts = sch_arr_str.split(':')
                if len(parts) >= 2:
                    arr_h, arr_m = int(parts[0]), int(parts[1])
                    arr_dt = now.replace(hour=arr_h, minute=arr_m, second=0, microsecond=0)
                    
                    # Gestione treni che arrivano dopo mezzanotte
                    if arr_h < 4 and now.hour > 20:
                        arr_dt += timedelta(days=1)
                    
                    # Aggiungiamo il ritardo attuale
                    expected_arrival = arr_dt + timedelta(minutes=delay)
                    
                    # Calcoliamo la differenza reale in minuti
                    diff_minutes = (expected_arrival - now).total_seconds() / 60.0
                    
                    if diff_minutes < 20:
                        if diff_minutes <= 1:
                            odds = 1.01 # Treno arrivato
                        else:
                            # Riduzione lineare: a 20 min 100% quota, a 0 min base 1.0
                            factor = max(0, diff_minutes / 20.0)
                            odds = 1.0 + (odds - 1.0) * factor
        except Exception as e:
            print(f"Errore calcolo time-to-arrival: {e}")

        # NUOVO: Fattore Rischio Previsione (Scostamento dal ritardo attuale)
        if predicted_delay is not None:
            diff = abs(predicted_delay - delay)
            # La variabile 'odds' fin qui rappresenta la "difficoltà base" del treno (es. 1.5 per FR, 2.3 per REG)
            # La usiamo come moltiplicatore del rischio.
            risk_multiplier = max(0.4, odds - 1.0)
            
            # Se lo scostamento è 0 (scommessa sul ritardo attuale), la quota deve essere molto vicina a 1.
            # Usiamo un base di 1.05 e aumentiamo in base al diff.
            # Ogni 4 minuti di scostamento aggiunge l'intero 'risk_multiplier' alla quota.
            odds = 1.05 + (risk_multiplier * (diff / 4.0))
            
            print(f"[DEBUG ODDS] train={train_id} current={delay} predicted={predicted_delay} multiplier={risk_multiplier:.2f} final={odds:.2f}")

        final_odds = round(max(1.01, odds), 2)
        return final_odds
    except Exception:
        return 2.0


@api_view(["GET"])
@authentication_classes([FirebaseAuthentication])
@permission_classes([AllowAny])
def get_odds(request, train_id):
    """
    Endpoint per il frontend per ottenere la quota ufficiale calcolata dal server.
    """
    # Supporta sia predictedDelay (JS) che predicted_delay (Python)
    predicted_delay = request.GET.get("predictedDelay") or request.GET.get("predicted_delay")
    
    if predicted_delay is not None:
        try:
            predicted_delay = int(float(predicted_delay))
        except (ValueError, TypeError):
            predicted_delay = None
            
    # Standardizzazione dati per chiave cache
    clean_train_id = str(train_id).strip()
    clean_delay = int(float(predicted_delay or 0))
    
    odds = _calculate_server_odds(clean_train_id, clean_delay)

    # SALVA NELLA CACHE: Blocca la quota per 60 secondi
    if request.user.is_authenticated:
        cache_key = f"odds_lock:{request.user.id}:{clean_train_id}:{clean_delay}"
        from django.core.cache import cache
        cache.set(cache_key, odds, timeout=60)
        
        # Log di debug su file
        with open("backend_debug.log", "a") as f:
            f.write(f"[{datetime.now()}] SET: user={request.user.id} key={cache_key} odds={odds}\n")
        
    return Response({"odds": odds})


@api_view(["GET"])
@permission_classes([AllowAny])
def global_bet_stats(request):
    from django.db.models import Count, Sum
    stats_qs = (
        Bet.objects.filter(status=Bet.STATUS_ACTIVE)
        .values("train_id")
        .annotate(count=Count("id"), pool=Sum("amount"))
    )
    return Response({
        row["train_id"]: {"count": row["count"], "pool": row["pool"] or 0}
        for row in stats_qs
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def leaderboard(request):
    users = UserProfile.objects.order_by("-balance")[:20]
    return Response(LeaderboardSerializer(users, many=True).data)


@api_view(["GET"])
@permission_classes([AllowAny])
def firebase_config(request):
    """
    Ritorna la configurazione Firebase caricata dal file .env.
    In questo modo la chiave API non è scritta nel codice JS.
    """
    return Response({
        "apiKey": settings.FIREBASE_WEB_API_KEY,
        "authDomain": settings.FIREBASE_AUTH_DOMAIN,
        "projectId": settings.FIREBASE_PROJECT_ID,
        "storageBucket": settings.FIREBASE_STORAGE_BUCKET,
        "messagingSenderId": settings.FIREBASE_MESSAGING_SENDER_ID,
        "appId": settings.FIREBASE_APP_ID,
        "measurementId": settings.FIREBASE_MEASUREMENT_ID
    })