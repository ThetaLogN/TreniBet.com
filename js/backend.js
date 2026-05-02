// ============================================================
// Treni.bet — Backend API Client
// Il frontend non chiama mai Firebase direttamente.
// Tutto passa dal backend Django.
// ============================================================

const BACKEND_BASE = '/api';

const Backend = {

  // ── Stato sessione ──
  _token: null,
  _refreshToken: null,
  _user: null,

  // Chiama questo all'avvio per ripristinare la sessione salvata
  init() {
    this._token = localStorage.getItem('tb_token');
    this._refreshToken = localStorage.getItem('tb_refresh');
    const savedUser = localStorage.getItem('tb_user');
    if (savedUser) {
      try { this._user = JSON.parse(savedUser); } catch { }
    }
    return this._user; // null se non loggato
  },

  _saveSession(token, refreshToken, user) {
    this._token = token;
    this._refreshToken = refreshToken;
    this._user = user;
    localStorage.setItem('tb_token', token);
    localStorage.setItem('tb_refresh', refreshToken);
    localStorage.setItem('tb_user', JSON.stringify(user));
  },

  _clearSession() {
    this._token = this._refreshToken = this._user = null;
    localStorage.removeItem('tb_token');
    localStorage.removeItem('tb_refresh');
    localStorage.removeItem('tb_user');
  },

  // Fetch autenticato — rinnova il token automaticamente se scaduto
  async authFetch(path, options = {}) {
    if (!this._token) throw new Error('Non autenticato.');

    const makeRequest = (token) => fetch(`${BACKEND_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });

    let resp = await makeRequest(this._token);

    // Token scaduto → rinnova automaticamente
    if ((resp.status === 401 || resp.status === 403) && this._refreshToken) {
      const refreshResp = await fetch(`${BACKEND_BASE}/auth/refresh/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this._refreshToken }),
      });

      if (refreshResp.ok) {
        const tokens = await refreshResp.json();
        this._token = tokens.token;
        this._refreshToken = tokens.refreshToken;
        localStorage.setItem('tb_token', tokens.token);
        localStorage.setItem('tb_refresh', tokens.refreshToken);
        resp = await makeRequest(tokens.token); // riprova
      } else {
        this._clearSession();
        throw new Error('Sessione scaduta. Effettua di nuovo il login.');
      }
    }

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `Errore HTTP ${resp.status}`);
    }
    return resp.json();
  },

  // ============================================================
  // AUTH
  // ============================================================

  async register(email, password, nickname = '') {
    const resp = await fetch(`${BACKEND_BASE}/auth/register/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, nickname }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Errore registrazione.');
    this._saveSession(data.token, data.refreshToken, data.user);
    return data;
  },

  async login(email, password) {
    const resp = await fetch(`${BACKEND_BASE}/auth/login/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Errore login.');
    this._saveSession(data.token, data.refreshToken, data.user);
    return data;
  },

  async resendVerification() {
    return await this.authFetch('/auth/resend-verification/', {
      method: 'POST'
    });
  },

  async googleLogin(idToken, refreshToken) {
    const resp = await fetch(`${BACKEND_BASE}/auth/google/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, refreshToken }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Errore login Google.');
    this._saveSession(data.token, data.refreshToken, data.user);
    return data;
  },

  logout() {
    this._clearSession();
  },

  async resetPassword(email) {
    const resp = await fetch(`${BACKEND_BASE}/auth/reset-password/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Errore.');
    return data.message;
  },

  isLoggedIn() { return !!this._token; },
  getUser() { return this._user; },

  // ============================================================
  // UTENTE
  // ============================================================

  async getProfile() {
    return this.authFetch('/user/');
  },

  async updateNickname(nickname) {
    return this.authFetch('/user/', {
      method: 'POST',
      body: JSON.stringify({ nickname }),
    });
  },

  // ============================================================
  // SCOMMESSE
  // ============================================================

  async getActiveBets() {
    return this.authFetch('/bets/active/');
  },

  async getPastBets() {
    return this.authFetch('/bets/past/');
  },

  async getOdds(trainId, predictedDelay = null) {
    const ts = Date.now();
    let url = `/bets/odds/${trainId}/?t=${ts}`;
    if (predictedDelay !== null) {
      url += `&predictedDelay=${predictedDelay}`;
    }
    const data = await this.authFetch(url);
    return data.odds || 2.0;
  },

  async getGlobalWins() {
    const resp = await fetch(`${BACKEND_BASE}/bets/wins/`);
    return resp.json();
  },

  async placeBet(train, predictedDelay, amount, odds) {
    const fermate = train.raw?.fermate || [];
    const prima = fermate[0] || {};
    const ultima = fermate[fermate.length - 1] || {};
    return this.authFetch('/bets/place/', {
      method: 'POST',
      body: JSON.stringify({
        trainId: train.id,
        trainNumber: train.number,
        trainRoute: `${train.from} → ${train.to}`,
        predictedDelay,
        amount,
        odds,
        stationCode: train.codOrigine,
        dataPartenza: train.dataPartenza || null,
        scheduledDeparture: prima.programmata || 0,
        scheduledArrival: ultima.programmata || 0,
        placedAt: Date.now(),
      }),
    });
  },

  // ============================================================
  // STATS E LEADERBOARD
  // ============================================================

  async getTrainBetDistribution(trainId) {
    const resp = await fetch(`${BACKEND_BASE}/bets/distribution/${trainId}/`);
    return resp.ok ? resp.json() : { bands: [], total: 0 };
  },

  async getGlobalBetStats() {
    const resp = await fetch(`${BACKEND_BASE}/bets/stats/`);
    return resp.ok ? resp.json() : {};
  },

  async getLeaderboard() {
    const resp = await fetch(`${BACKEND_BASE}/leaderboard/`);
    return resp.ok ? resp.json() : [];
  },
};

window.Backend = Backend;