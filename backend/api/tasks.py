"""
TreniBet — Bet Resolver
Task Celery eseguito ogni 60 secondi.
Sostituisce il setInterval() / startBetResolver() di server.js
"""

import time
import requests
from celery import shared_task
from django.db import transaction

from .models import Bet, UserProfile

VT_BASE = 'http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno'


def fetch_train_data(cod_origine, numero, data_partenza):
    """Chiama le nostre API proxy per ottenere i dati del treno."""
    url = f"{VT_BASE}/andamentoTreno/{cod_origine}/{numero}/{data_partenza}"
    try:
        resp = requests.get(url, timeout=10)
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        print(f"[RESOLVER] Errore fetch treno {numero}: {e}")
    return None


@shared_task
def resolve_bets():
    """
    Controlla tutte le scommesse attive e le risolve se il treno è arrivato.
    Logica identica al startBetResolver() in server.js.
    """
    active_bets = Bet.objects.filter(status=Bet.STATUS_ACTIVE).select_related('user')

    if not active_bets.exists():
        return  # Niente da fare

    now_ms = int(time.time() * 1000)
    resolved_count = 0

    for bet in active_bets:
        try:
            # Estrai i dati del treno dall'ID (formato: "numero-codOrigine-dataPartenza")
            parts = bet.train_id.split('-') if bet.train_id else []
            train_number = parts[0] if parts else None
            cod_origine = bet.station_code or (parts[1] if len(parts) > 1 else None)
            data_partenza = bet.data_partenza or ('-'.join(parts[2:]) if len(parts) >= 3 else None)

            if not all([train_number, cod_origine, data_partenza]):
                print(f"[RESOLVER] Dati mancanti per scommessa {bet.bet_id}, skip.")
                continue

            # Se la partenza programmata è nel futuro, skip
            if bet.scheduled_departure and now_ms < bet.scheduled_departure:
                continue

            # Fetch dati live del treno
            train_raw = fetch_train_data(cod_origine, train_number, data_partenza)
            if not train_raw or not train_raw.get('numeroTreno'):
                continue

            # Analizza fermate
            fermate = train_raw.get('fermate', [])
            ultima = fermate[-1] if fermate else {}

            sched_arr = bet.scheduled_arrival or ultima.get('programmata', 0)
            ritardo_attuale = train_raw.get('ritardo', 0)

            # Condizioni di termine (identiche a server.js)
            is_arrived = train_raw.get('arrivato') is True
            has_arrivo_reale = ultima.get('arrivoReale') is not None

            safety_timeout = sched_arr + (ritardo_attuale * 60 * 1000) + (2 * 60 * 60 * 1000)
            is_stale = sched_arr > 0 and now_ms > safety_timeout

            # Fallback estremo: dopo 24 ore rimborsa
            is_extreme_stale = (now_ms - bet.placed_at) > (24 * 60 * 60 * 1000)

            if not (is_arrived or has_arrivo_reale or is_stale or is_extreme_stale):
                continue

            print(f"[RESOLVER] Risolvo scommessa {bet.bet_id} su treno {train_number}")

            # Calcola ritardo effettivo
            actual_delay = ritardo_attuale
            if has_arrivo_reale and ultima.get('programmata'):
                actual_delay = round((ultima['arrivoReale'] - ultima['programmata']) / 60000)
            if actual_delay < 0:
                actual_delay = 0

            # Determina esito (Tolleranza zero: devi indovinare il minuto esatto)
            tolerance = 0
            
            if is_extreme_stale and not is_arrived and not has_arrivo_reale:
                # Rimborso di sicurezza
                outcome = Bet.STATUS_REFUNDED
                win_amount = bet.amount
                actual_delay = 0
            elif abs(actual_delay - bet.predicted_delay) <= tolerance:
                outcome = Bet.STATUS_WON
                win_amount = int(bet.amount * bet.odds)
            else:
                outcome = Bet.STATUS_LOST
                win_amount = 0

            # Aggiorna scommessa e balance in una singola transazione
            with transaction.atomic():
                bet.status = outcome
                bet.actual_delay = actual_delay
                bet.win_amount = win_amount
                bet.resolved_at = now_ms
                bet.save()

                if win_amount > 0:
                    UserProfile.objects.filter(pk=bet.user_id).update(
                        balance=bet.user.balance + win_amount  # type: ignore
                    )
                    # Ricarica il balance aggiornato
                    bet.user.refresh_from_db()

            print(f"[RESOLVER] Scommessa {bet.bet_id} risolta: {outcome} (+{win_amount}🪙)")
            resolved_count += 1

        except Exception as e:
            print(f"[RESOLVER] Errore su scommessa {bet.bet_id}: {e}")

    if resolved_count:
        print(f"[RESOLVER] {resolved_count} scommesse risolte in questo ciclo.")
