# 🚂 Treni.bet — Real-Time Railway Delay Betting

**Treni.bet** is an innovative web platform that allows users to bet on the delays of Italian trains (Trenitalia) in real-time, using live data from the Viaggiatreno system.

---

## 🚀 Main Features

- **Real-Time Data**: Integration with Viaggiatreno APIs to monitor train status live.
- **Betting System**: Place bets on the exact minutes of delay upon arrival.
- **Secure Authentication**: User management via Firebase Authentication integrated with a Django backend.
- **Leaderboard & Stats**: Global rankings of top bettors and real-time statistics.
- **Daily Bonus**: Log in daily to receive free tokens.
- **Docker Architecture**: Fully containerized for easy and scalable deployment.

---

## 🛠 Tech Stack

- **Frontend**: HTML5, Vanilla CSS, Javascript (ES6).
- **Backend**: Django (Python) + Django REST Framework.
- **Database**: PostgreSQL (Production) / SQLite (Development).
- **Tasks & Automation**: Celery + Redis (for automatic bet resolution).
- **Infrastructure**: Docker & Docker Compose.
- **Deployment**: Cloudflare Tunnel (Argo) for secure external access.

---

## 📦 Installation and Quick Start

### 1. Prerequisites
- Docker and Docker Compose installed.
- An active Firebase project.

### 2. Environment Configuration
Create a `.env` file in the `backend/` folder (and a symlink in the root) with the following variables:
```env
DEBUG=False
SECRET_KEY=your_secret_key
DATABASE_URL=postgres://trenibet:password@db:5432/trenibet

# Firebase Config
FIREBASE_API_KEY=...
FIREBASE_AUTH_DOMAIN=...
FIREBASE_PROJECT_ID=...
FIREBASE_STORAGE_BUCKET=...
FIREBASE_MESSAGING_SENDER_ID=...
FIREBASE_APP_ID=...
```

### 3. Start with Docker
Run the following command from the root directory:
```bash
docker-compose up -d --build
```
The site will be available at `http://localhost:3000`.

## 👨‍💻 Author
**Giorgio Martucci** — *Developer and creator of the project.*

---

*This project is for entertainment purposes only and does not involve real money betting.*
