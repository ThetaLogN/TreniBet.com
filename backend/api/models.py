from django.db import models


class UserProfile(models.Model):
    """
    Profilo utente — collegato a Firebase Auth tramite uid.
    Non usiamo django.contrib.auth perché l'autenticazione è gestita da Firebase.
    """
    uid = models.CharField(max_length=128, unique=True, db_index=True)  # Firebase UID
    nickname = models.CharField(max_length=64)
    balance = models.IntegerField(default=500)  # Token iniziali, come in Firebase
    is_email_verified = models.BooleanField(default=False)  # Nuovo campo
    last_daily_bonus = models.DateField(null=True, blank=True)  # Ultimo bonus giornaliero ricevuto
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.nickname} ({self.uid}) — {self.balance}🪙"

    def check_daily_bonus(self):
        """
        Controlla se l'utente ha diritto al bonus giornaliero di 50 token.
        Ritorna True se il bonus è stato accreditato, False altrimenti.
        Usa update atomico per evitare race condition.
        """
        from django.utils import timezone
        from django.db.models import F
        today = timezone.now().date()
        
        if self.last_daily_bonus != today:
            # Update atomico: evita che due richieste concorrenti diano doppio bonus
            updated = UserProfile.objects.filter(
                pk=self.pk
            ).exclude(
                last_daily_bonus=today
            ).update(
                balance=F('balance') + 50,
                last_daily_bonus=today
            )
            if updated:
                self.refresh_from_db()
                return True
        return False

    @property
    def is_authenticated(self):
        return True

    @property
    def is_anonymous(self):
        return False

    @property
    def is_active(self):
        return True

    class Meta:
        verbose_name = 'Utente'
        verbose_name_plural = 'Utenti'


class Bet(models.Model):
    """
    Scommessa su un treno.
    Sostituisce le subcollection activeBets/pastBets di Firestore.
    """
    STATUS_ACTIVE = 'active'
    STATUS_WON = 'won'
    STATUS_LOST = 'lost'
    STATUS_REFUNDED = 'refunded'

    STATUS_CHOICES = [
        (STATUS_ACTIVE, 'Attiva'),
        (STATUS_WON, 'Vinta'),
        (STATUS_LOST, 'Persa'),
        (STATUS_REFUNDED, 'Rimborsata'),
    ]

    user = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name='bets')

    # Identificazione del treno (stesso formato del frontend: "numero-codOrigine-dataPartenza")
    bet_id = models.CharField(max_length=64, unique=True)   # es. "bet_1713456789000"
    train_id = models.CharField(max_length=128)              # es. "9540-S09218-1776463200000"
    train_number = models.CharField(max_length=32)           # es. "FR 9540"
    train_route = models.CharField(max_length=128, blank=True)  # es. "Napoli → Roma"

    # Dati scommessa
    predicted_delay = models.IntegerField(default=0)         # Ritardo previsto in minuti
    amount = models.IntegerField()                           # Token scommessi
    odds = models.FloatField(default=3.0)                    # Moltiplicatore

    # Dati treno (per il resolver)
    station_code = models.CharField(max_length=16, blank=True)
    data_partenza = models.CharField(max_length=32, blank=True)
    scheduled_departure = models.BigIntegerField(default=0)  # Timestamp ms
    scheduled_arrival = models.BigIntegerField(default=0)    # Timestamp ms

    # Stato e risultato
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    actual_delay = models.IntegerField(null=True, blank=True)
    win_amount = models.IntegerField(default=0)

    # Timestamp
    placed_at = models.BigIntegerField()    # Timestamp ms (come nel frontend)
    resolved_at = models.BigIntegerField(null=True, blank=True)

    def __str__(self):
        return f"{self.user.nickname} → {self.train_number} (del {self.data_partenza}) [{self.status}]"

    class Meta:
        verbose_name = 'Scommessa'
        verbose_name_plural = 'Scommesse'
        ordering = ['-placed_at']
