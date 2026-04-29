# Treni.bet — Backend Django

Questo è il backend Django che sostituisce `server.js` (Node.js/Express + Firebase Firestore).

## Cosa fa

| Funzione | Prima (Node.js) | Adesso (Django) |
|---|---|---|
| Proxy Viaggiatreno | Express | Django views |
| Auth utenti | Firebase Auth | Firebase Auth (invariato) |
| Database scommesse | Firestore | PostgreSQL (SQLite in locale) |
| Bet resolver | `setInterval` in server.js | Celery Beat (ogni 60s) |
| Leaderboard | Firestore query | PostgreSQL query |

---

## Avvio in locale

### 1. Prerequisiti

```bash
# Python 3.11+
python --version

# Redis (per Celery)
# macOS:
brew install redis && brew services start redis
# Ubuntu/Debian:
sudo apt install redis-server && sudo systemctl start redis
```

### 2. Installa le dipendenze

```bash
cd backend_django
pip install -r requirements.txt
```

### 3. Configura l'ambiente

```bash
cp .env.example .env
# Modifica .env se necessario (di default funziona già con SQLite e Redis locale)
```

### 4. Crea il database

```bash
python manage.py migrate
python manage.py createsuperuser  # opzionale, per accedere a /admin/
```

### 5. Avvia i processi (3 terminali separati)

**Terminale 1 — Server Django:**
```bash
python manage.py runserver 8000
```

**Terminale 2 — Celery Worker:**
```bash
celery -A trenibet worker --loglevel=info
```

**Terminale 3 — Celery Beat (scheduler):**
```bash
celery -A trenibet beat --loglevel=info
```

Il backend è ora attivo su `http://localhost:8000`

---

## Modifica al frontend

### 1. Aggiungi il nuovo file `backend.js`

Copia `frontend_changes/js/backend.js` nella cartella `js/` del frontend.

### 2. Includi lo script in `index.html`

Aggiungi **prima** di `app.js`:
```html
<script src="js/backend.js"></script>
```

### 3. Sostituisci le chiamate Firestore in `app.js`

Sostituisci le chiamate a `FirebaseApp.db` con le chiamate a `Backend`:

```js
// PRIMA (Firestore)
const snap = await FirebaseApp.db.collectionGroup('activeBets').get();

// DOPO (Django)
const stats = await Backend.getGlobalBetStats();
```

```js
// PRIMA (place bet con Firestore)
await userRef.collection('activeBets').doc(bet.id).set(bet);
await userRef.update({ balance: firebase.firestore.FieldValue.increment(-amount) });

// DOPO (Django)
await Backend.placeBet(train, predictedDelay, this.betAmount, odds);
// Il balance aggiornato arriva con getProfile()
const profile = await Backend.getProfile();
this.userBalance = profile.balance;
```

```js
// PRIMA (leaderboard da Firestore)
const snap = await FirebaseApp.db.collection('users').orderBy('balance', 'desc').limit(20).get();

// DOPO (Django)
const users = await Backend.getLeaderboard();
```

---

## Deploy su Railway

### 1. Crea un account su railway.app

### 2. Nuovo progetto da GitHub

```bash
# Prima committa il backend su GitHub
git init
git add .
git commit -m "Add Django backend"
git remote add origin https://github.com/TUO_USERNAME/trenibet-backend.git
git push -u origin main
```

### 3. Su Railway

1. **New Project** → **Deploy from GitHub repo**
2. Seleziona il repo
3. Railway rileva automaticamente Django grazie a `railway.json`

### 4. Aggiungi PostgreSQL

1. Nel progetto Railway: **New** → **Database** → **PostgreSQL**
2. Railway setta `DATABASE_URL` automaticamente

### 5. Aggiungi Redis

1. **New** → **Database** → **Redis**
2. Railway setta `REDIS_URL` automaticamente

### 6. Imposta le variabili d'ambiente su Railway

Vai su **Variables** e aggiungi:
```
DEBUG=False
SECRET_KEY=una-chiave-segreta-lunga-e-casuale
ALLOWED_HOSTS=tuo-progetto.railway.app
FIREBASE_PROJECT_ID=trenibet
```

### 7. Aggiungi i worker Celery

Su Railway, aggiungi due nuovi servizi dallo stesso repo con questi comandi di start:
- **Worker**: `celery -A trenibet worker --loglevel=info`
- **Beat**: `celery -A trenibet beat --loglevel=info`

### 8. Aggiorna il frontend

Nel file `js/backend.js`, cambia:
```js
const BACKEND_BASE = 'https://tuo-progetto.railway.app/api';
```

---

## API Endpoints

| Metodo | Path | Auth | Descrizione |
|---|---|---|---|
| GET | `/api/health/` | No | Health check |
| GET | `/api/partenze/<codice>/` | No | Proxy partenze |
| GET | `/api/arrivi/<codice>/` | No | Proxy arrivi |
| GET | `/api/treno/<orig>/<num>/<data>/` | No | Proxy dettagli treno |
| GET | `/api/stazioni/<query>/` | No | Autocomplete stazioni |
| GET | `/api/cercatreno/<num>/` | No | Autocomplete treno |
| GET | `/api/user/` | Firebase JWT | Profilo utente |
| POST | `/api/user/` | Firebase JWT | Aggiorna nickname |
| GET | `/api/bets/active/` | Firebase JWT | Scommesse attive |
| GET | `/api/bets/past/` | Firebase JWT | Scommesse passate |
| POST | `/api/bets/place/` | Firebase JWT | Piazza scommessa |
| GET | `/api/bets/stats/` | No | Stats globali scommesse |
| GET | `/api/leaderboard/` | No | Top 20 utenti |
| GET | `/admin/` | Django superuser | Pannello admin |
# TreniBet.com
