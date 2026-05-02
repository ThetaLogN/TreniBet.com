// ============================================================
// Treni.bet — App Logic
// Auth completamente gestita dal backend Django.
// Firebase SDK non viene più usato per login/registrazione.
// ============================================================

const App = {
  activeFilters: [],
  onboardingStep: 0,
  isDarkMode: false,
  currentView: 'home',
  currentStation: TrainData.DEFAULT_STATION,
  trains: [],
  leaderboardUsers: [],
  globalBetsStats: {},
  loading: false,
  refreshInterval: null,
  betsPollingInterval: null,

  user: null,        // nickname
  uid: null,         // firebase uid
  isEmailVerified: false,
  userBalance: 0,
  activeBets: [],
  pastBets: [],
  betAmount: 50,

  // ---- INIT ----
  init() {
    if (localStorage.getItem('treno-dark-mode') === 'true') {
      this.isDarkMode = true;
      document.body.classList.add('dark-mode');
    }

    // Imposta il testo corretto sul bottone al caricamento
    const darkToggle = document.getElementById('dark-mode-toggle');
    if (darkToggle) darkToggle.textContent = this.isDarkMode ? 'Modalità Chiara' : 'Modalità Scura';

    const savedStation = localStorage.getItem('treno-station');
    if (savedStation && TrainData.STATIONS_MAP[savedStation]) {
      this.currentStation = savedStation;
    }

    // Ripristina sessione salvata
    const savedUser = Backend.init();
    if (savedUser) {
      this.user = savedUser.nickname;
      this.uid = savedUser.uid;
      this.isEmailVerified = savedUser.is_email_verified;
      this.userBalance = savedUser.balance;

      // Forza l'aggiornamento del profilo dal server per verificare l'email in tempo reale
      Backend.getProfile().then(profile => {
        this.isEmailVerified = profile.is_email_verified;
        this.userBalance = profile.balance;
        this.updateWalletUI();
        if (profile.bonus_granted) {
          this.showToast('Hai ricevuto 50 Token gratis per oggi! 🎁', '💰');
        }
      }).catch(() => { });

      this._startBetsPolling();
    }
    this.updateWalletUI();

    this.loadTrains();
    this.startAutoRefresh();

    const menuBtn = document.getElementById('menu-toggle');
    if (menuBtn) menuBtn.addEventListener('click', () => this.toggleMenu());

    if (!localStorage.getItem('treno-onboarding-done')) {
      setTimeout(() => this.showOnboarding(), 800);
    }
  },

  // ---- TRENI ----
  async loadTrains() {
    // Mostra il caricamento solo se la lista è vuota (primo avvio)
    if (this.trains.length === 0) {
      this.loading = true;
      this.renderPage();
    }

    try {
      // 1. Fetch global stats in parallel with station polling for performance
      const stationCodes = Object.values(TrainData.STATIONS_MAP);
      const [statsResult, ...stationResults] = await Promise.allSettled([
        Backend.getGlobalBetStats(),
        ...stationCodes.map(code => Api.fetchDepartures(code))
      ]);

      // Update global stats
      if (statsResult.status === 'fulfilled') {
        this.globalBetsStats = statsResult.value;
      }

      let allTrains = [];
      stationResults.forEach(r => { if (r.status === 'fulfilled') allTrains = allTrains.concat(r.value); });

      const map = new Map();
      // Unifica i treni dai vari tabelloni
      allTrains.forEach(t => {
        const existing = this.trains.find(ex => ex.id === t.id);
        if (existing && existing.raw && existing.raw.stazioneUltimoRilevamento && t.raw && !t.raw.stazioneUltimoRilevamento) {
          t.raw.stazioneUltimoRilevamento = existing.raw.stazioneUltimoRilevamento;
        }
        map.set(t.id, t);
      });

      // 2. RECUPERA TRENI MANCANTI CON SCOMMESSE (Globali o Personali)
      // Se un treno ha scommesse ma non è passato per le stazioni principali, dobbiamo caricarlo
      const missingIds = new Set();

      // Controlla scommesse globali
      Object.keys(this.globalBetsStats).forEach(id => {
        if (!map.has(id)) missingIds.add(id);
      });

      // Controlla scommesse personali attive
      if (this.activeBets) {
        this.activeBets.forEach(bet => {
          if (!map.has(bet.trainId)) missingIds.add(bet.trainId);
        });
      }

      if (missingIds.size > 0) {
        // Carica i dettagli per i treni "hot" mancanti (max 20 per evitare eccessi)
        const toFetch = Array.from(missingIds).slice(0, 20);
        const fetchPromises = toFetch.map(async id => {
          const parts = id.split('-');
          if (parts.length < 3) return null;

          // Cerca di recuperare codOrigine dal bet o dai dati esistenti
          const bet = this.activeBets?.find(b => b.trainId === id);
          const codOrigine = bet?.stationCode || parts[1];
          const trainNumber = parseInt(parts[0]);
          const dataPartenza = parts.slice(2).join('-');

          return Api.fetchTrainDetails(codOrigine, trainNumber, dataPartenza);
        });

        const missingTrains = await Promise.all(fetchPromises);
        missingTrains.forEach(t => {
          if (t) map.set(t.id, t);
        });
      }

      this.trains = Array.from(map.values()).sort((a, b) => b.currentDelay - a.currentDelay);
      this.loading = false;

      this.renderPage();
      this.updateStats();

      // Caricamento dettagli in background per i primi treni (per filtri come "Arrivo a breve")
      this.fetchTopTrainDetails();
    } catch (err) {
      console.error('Errore caricamento treni:', err);
      this.loading = false;
      this.trains = [];
      this.renderPage();
    }
  },

  async fetchTopTrainDetails() {
    // Prendi i primi 15 treni che non hanno ancora i dettagli (missingStops è null)
    const toFetch = this.trains
      .filter(t => t.missingStops === null && t.status !== 'arrivato')
      .slice(0, 15);

    for (const train of toFetch) {
      try {
        const details = await Api.fetchTrainDetails(train.codOrigine, train.trainNumber, train.dataPartenza);
        if (details) {
          const idx = this.trains.findIndex(t => t.id === train.id);
          if (idx > -1) {
            this.trains[idx] = { ...this.trains[idx], ...details };
            // Se siamo nel filtro "Arrivo a breve", aggiorniamo la UI man mano
            if (this.activeFilters.includes('arriving-soon')) {
              this.renderPage();
            }
          }
        }
        // Piccola pausa per non sovraccaricare il server
        await new Promise(r => setTimeout(r, 300));
      } catch (e) { }
    }
  },

  async fetchGlobalBetStats() {
    try {
      this.globalBetsStats = await Backend.getGlobalBetStats();
      if (this.currentView === 'home') this.renderPage();
    } catch (err) {
      console.error("Errore fetch global bets", err);
    }
  },

  // ---- RENDER ----
  renderPage() {
    const content = document.getElementById('main-content');
    if (this.currentView === 'home') {
      const filtered = this.getFilteredTrains();
      content.innerHTML = Components.trainsPage(filtered, this.activeFilters, this.loading, this.globalBetsStats);

      // Se non stiamo caricando o se abbiamo già dei treni (caricamento silenzioso)
      if (!this.loading || filtered.length > 0) {
        this.setupSearch();
        this.updateStats();
        // Anima solo se è il primo render o se la lista era vuota
        if (this.loading) this.animateCards();
      }
    } else if (this.currentView === 'bets') {
      content.innerHTML = Components.betsPage(this.activeBets, this.pastBets, this.trains);
    } else if (this.currentView === 'leaderboard') {
      content.innerHTML = Components.leaderboardPage(this.leaderboardUsers, this.uid);
    } else if (this.currentView === 'wins') {
      content.innerHTML = Components.winsPage(this.globalWins);
    }
  },

  updateStats() {
    const el = document.getElementById('trains-stats');
    if (el) el.innerHTML = Components.trainsStats(this.getFilteredTrains());
  },

  getFilteredTrains() {
    let filtered = this.trains.filter(t => t.status !== 'arrivato');
    const q = (document.getElementById('train-search')?.value || '').toLowerCase().trim();
    if (q) filtered = filtered.filter(t =>
      t.number.toLowerCase().includes(q) || t.to.toLowerCase().includes(q) ||
      t.from.toLowerCase().includes(q) || String(t.trainNumber).includes(q)
    );
    this.activeFilters.forEach(f => {
      switch (f) {
        case 'hot':
          filtered = filtered.filter(t => {
            const stats = this.globalBetsStats[t.id];
            const hasGlobal = stats && stats.count > 0;
            const hasUserBet = this.activeBets && this.activeBets.some(b => b.trainId === t.id);
            return hasGlobal || hasUserBet;
          });
          break;
        case 'arriving-soon':
          filtered = filtered.filter(t => t.missingStops !== null && t.missingStops <= 3);
          break;
        case 'delayed': filtered = filtered.filter(t => t.currentDelay > 0); break;
        case 'ontime': filtered = filtered.filter(t => t.currentDelay <= 0); break;
        case 'longdist': filtered = filtered.filter(t => ['FR', 'FA', 'FB', 'IC'].includes(t.type)); break;
        case 'regional': filtered = filtered.filter(t => ['REG', 'RV'].includes(t.type)); break;
        case 'departed': filtered = filtered.filter(t => t.status !== 'non_partito'); break;
        case 'not-departed': filtered = filtered.filter(t => t.status === 'non_partito'); break;
      }
    });
    return filtered;
  },

  startAutoRefresh() {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    this.refreshInterval = setInterval(() => this.loadTrains(), 300000); // 5 minuti
  },

  animateCards() {
    document.querySelectorAll('.train-card').forEach((card, i) => {
      card.style.opacity = '0';
      card.style.transform = 'translateY(20px)';
      setTimeout(() => {
        card.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
      }, i * 50);
    });
  },

  // ---- SEARCH ----
  searchDebounce: null,

  setupSearch() {
    const searchInput = document.getElementById('train-search');
    if (!searchInput) return;
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.trim();
      const filtered = this.getFilteredTrains();
      const grid = document.getElementById('trains-grid');
      if (grid) {
        grid.innerHTML = filtered.length > 0
          ? filtered.map(t => Components.trainCard(t, this.globalBetsStats[t.id] || { count: 0, pool: 0 })).join('')
          : '';
        this.animateCards();
      }
      this.updateStats();
      if (this.searchDebounce) clearTimeout(this.searchDebounce);
      document.getElementById('search-suggestions')?.remove();
      if (/^\d+$/.test(query) && query.length >= 3) {
        if (!filtered.length && grid) grid.innerHTML = '<div class="no-results"><p>Ricerca su Viaggiatreno... 🔍</p></div>';
        this.searchDebounce = setTimeout(async () => {
          const results = await Api.searchTrainByNumber(query).catch(() => []);
          if (!results.length) { if (!filtered.length && grid) grid.innerHTML = '<div class="no-results"><p>Nessun treno trovato 🚂💨</p></div>'; return; }
          if (searchInput.value.trim() !== query) return;
          const container = document.querySelector('.search-bar-container');
          if (!container) return;
          document.getElementById('search-suggestions')?.remove();
          container.insertAdjacentHTML('beforeend', `
            <div class="search-suggestions" id="search-suggestions">
              ${results.map(r => `
                <div class="search-suggestion" onclick="App.loadSearchedTrain('${r.codOrigine}',${r.trainNumber},'${r.dataPartenza}')">
                  <span class="suggestion-number">🚂 ${r.label}</span>
                  <span class="suggestion-arrow">→</span>
                </div>`).join('')}
            </div>`);
        }, 400);
      } else if (!filtered.length && query.length > 0 && grid) {
        grid.innerHTML = '<div class="no-results"><p>Nessun treno trovato 🚂💨</p></div>';
      }
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('.search-bar-container')) document.getElementById('search-suggestions')?.remove();
    });
  },

  async loadSearchedTrain(codOrigine, trainNumber, dataPartenza) {
    document.getElementById('search-suggestions')?.remove();
    const grid = document.getElementById('trains-grid');
    if (grid) grid.innerHTML = '<div class="no-results"><p>Caricamento treno... ⏳</p></div>';
    const train = await Api.fetchTrainDetails(codOrigine, trainNumber, dataPartenza);
    if (train && grid) {
      if (!this.trains.find(t => t.id === train.id)) this.trains.unshift(train);
      grid.innerHTML = Components.trainCard(train, this.globalBetsStats[train.id] || { count: 0, pool: 0 });
      this.animateCards();
      this.updateStats();
    } else if (grid) {
      grid.innerHTML = '<div class="no-results"><p>Impossibile caricare il treno 😕</p></div>';
    }
  },

  // ---- FILTERS ----
  toggleFilter(filterId) {
    const idx = this.activeFilters.indexOf(filterId);
    if (idx > -1) this.activeFilters.splice(idx, 1); else this.activeFilters.push(filterId);
    document.querySelectorAll('.filter-chip').forEach(chip =>
      chip.classList.toggle('active', this.activeFilters.includes(chip.dataset.filter))
    );
    const filtered = this.getFilteredTrains();
    const grid = document.getElementById('trains-grid');
    if (grid) {
      grid.innerHTML = filtered.length > 0
        ? filtered.map(t => Components.trainCard(t, this.globalBetsStats[t.id] || { count: 0, pool: 0 })).join('')
        : '<div class="no-results"><p>Nessun treno trovato 🚂💨</p></div>';
      this.animateCards();
    }
    this.updateStats();
  },

  // ---- DARK MODE / MENU ----
  toggleDarkMode() {
    this.isDarkMode = !this.isDarkMode;
    document.body.classList.toggle('dark-mode', this.isDarkMode);
    localStorage.setItem('treno-dark-mode', this.isDarkMode);

    const darkToggle = document.getElementById('dark-mode-toggle');
    if (darkToggle) darkToggle.textContent = this.isDarkMode ? 'Modalità Chiara' : 'Modalità Scura';
  },

  toggleMenu() {
    const menu = document.getElementById('dropdown-menu');
    if (!menu) return;
    menu.classList.toggle('show');

    if (menu.classList.contains('show')) {
      setTimeout(() => {
        document.addEventListener('click', function closeMenu(e) {
          const btn = document.getElementById('btn-profile-header');
          const m = document.getElementById('dropdown-menu');
          if (m && !m.contains(e.target) && (!btn || !btn.contains(e.target))) {
            m.classList.remove('show');
            document.removeEventListener('click', closeMenu);
          }
        });
      }, 10);
    }
  },

  closeMenu() {
    document.getElementById('dropdown-menu')?.classList.remove('show');
  },

  // ---- ONBOARDING ----
  showOnboarding() {
    this.onboardingStep = 0;
    document.getElementById('onboarding-modal')?.remove();
    document.body.insertAdjacentHTML('beforeend', Components.onboardingModal(0));
    requestAnimationFrame(() => document.getElementById('onboarding-modal').classList.add('show'));
  },
  nextOnboardingStep() {
    this.onboardingStep++;
    if (this.onboardingStep >= TrainData.ONBOARDING_STEPS.length) { this.closeOnboarding(); return; }
    const c = document.getElementById('onboarding-modal');
    const t = document.createElement('div');
    t.innerHTML = Components.onboardingModal(this.onboardingStep);
    c.innerHTML = t.firstElementChild.innerHTML;
  },
  closeOnboarding() {
    localStorage.setItem('treno-onboarding-done', 'true');
    const m = document.getElementById('onboarding-modal');
    if (m) { m.classList.remove('show'); setTimeout(() => m.remove(), 300); }
  },

  // ---- LOGIN / REGISTRAZIONE ----
  showLoginModal(mode = 'login') {
    if (this.user) return;
    document.getElementById('login-modal')?.remove();
    document.body.insertAdjacentHTML('beforeend', Components.loginModal(mode));
    requestAnimationFrame(() => document.getElementById('login-modal').classList.add('show'));
  },

  switchAuthMode() {
    const title = document.getElementById('auth-title');
    const desc = document.getElementById('auth-desc');
    const confirmGroup = document.getElementById('confirm-password-group');
    const actionContainer = document.getElementById('auth-action-container');
    const modeText = document.getElementById('auth-mode-text');
    const modeToggle = document.getElementById('auth-mode-toggle');
    const errEl = document.getElementById('login-error');

    if (!title || !modeToggle) return;
    errEl.style.display = 'none';

    const isLogin = modeToggle.textContent.trim() === 'Registrati ora';

    if (isLogin) {
      // Passa a registrazione
      title.textContent = 'Crea un Account';
      desc.innerHTML = 'Registrati per ricevere <strong>500 Token</strong> di benvenuto!';
      confirmGroup.classList.remove('hidden');
      actionContainer.innerHTML = `<button class="btn-primary" style="width: 100%;" onclick="App.performRegister()">Registrati Ora</button>`;
      modeText.textContent = 'Hai già un account?';
      modeToggle.textContent = 'Accedi';
    } else {
      // Passa a login
      title.textContent = 'Bentornato!';
      desc.textContent = 'Inserisci i tuoi dati per accedere al tuo profilo.';
      confirmGroup.classList.add('hidden');
      actionContainer.innerHTML = `<button class="btn-primary" style="width: 100%;" onclick="App.performLogin()">Accedi</button>`;
      modeText.textContent = 'Non hai un account?';
      modeToggle.textContent = 'Registrati ora';
    }
  },

  togglePasswordVisibility(inputId) {
    const input = document.getElementById(inputId);
    const btn = input?.nextElementSibling;
    if (!input || !btn) return;

    if (input.type === 'password') {
      input.type = 'text';
      btn.textContent = '🙈';
    } else {
      input.type = 'password';
      btn.textContent = '👁️';
    }
  },

  closeLoginModal(event) {
    if (event && event.target !== event.currentTarget) return;
    const m = document.getElementById('login-modal');
    if (m) { m.classList.remove('show'); setTimeout(() => m.remove(), 300); }
  },

  // ✅ Login tramite backend Django (non più Firebase SDK)
  async performLogin() {
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    if (!email || !pass) return;

    try {
      const data = await Backend.login(email, pass);
      const user = data.user;
      this.user = user.nickname;
      this.uid = user.uid;
      this.userBalance = user.balance;
      this.isEmailVerified = user.is_email_verified;
      this.closeLoginModal();
      this.updateWalletUI();
      this._startBetsPolling();

      if (data.bonus_granted) {
        this.showToast(`Bentornato! Hai ricevuto 50 Token gratis per oggi! 🎁`, '💰');
      } else {
        this.showToast(`Bentornato, @${this.user}!`, '🎉');
      }
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    }
  },

  // ✅ Registrazione tramite backend Django
  async performRegister() {
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    const confirmPass = document.getElementById('login-password-confirm').value;
    const errEl = document.getElementById('login-error');

    if (!email || !pass) {
      errEl.textContent = "Inserisci email e password.";
      errEl.style.display = 'block';
      return;
    }

    if (pass !== confirmPass) {
      errEl.textContent = "Le password non coincidono!";
      errEl.style.display = 'block';
      return;
    }

    if (pass.length < 6) {
      errEl.textContent = "La password deve essere di almeno 6 caratteri.";
      errEl.style.display = 'block';
      return;
    }

    try {
      const data = await Backend.register(email, pass);
      const user = data.user;
      this.user = user.nickname;
      this.uid = user.uid;
      this.userBalance = user.balance;
      this.isEmailVerified = user.is_email_verified;
      this.closeLoginModal();
      this.updateWalletUI();
      this._startBetsPolling();
      this.showToast(`Benvenuto! Hai ricevuto 500 Token 🎉`, '🎉');
      if (data.bonus_granted) {
        setTimeout(() => this.showToast('Hai ricevuto anche 50 Token bonus giornalieri! 🎁', '💰'), 2000);
      }
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    }
  },

  // ✅ Login con Google (Firebase SDK + Django Backend)
  async loginWithGoogle() {
    const errEl = document.getElementById('login-error');
    const provider = new firebase.auth.GoogleAuthProvider();

    try {
      // 1. Popup Google via Firebase
      const result = await firebase.auth().signInWithPopup(provider);
      // 2. Ottieni l'ID Token e il Refresh Token da inviare al backend Django
      const idToken = await result.user.getIdToken();
      const refreshToken = result.user.refreshToken;

      // 3. Autentica sul backend Django
      const data = await Backend.googleLogin(idToken, refreshToken);
      const user = data.user;

      // 4. Successo
      this.user = user.nickname;
      this.uid = user.uid;
      this.userBalance = user.balance;
      this.isEmailVerified = user.is_email_verified;
      this.closeLoginModal();
      this.updateWalletUI();
      this._startBetsPolling();

      if (data.bonus_granted) {
        this.showToast(`Benvenuto! Hai ricevuto 50 Token gratis per oggi! 🎁`, '💰');
      } else {
        this.showToast(`Benvenuto! Registrazione completata. Controlla la tua email per confermare l'account.`, '📧');
      }
    } catch (e) {
      if (errEl) {
        errEl.textContent = e.message;
        errEl.style.display = 'block';
      }
      console.error("Errore Google Login:", e);
    }
  },

  // ✅ Logout
  logout() {
    if (this.betsPollingInterval) clearInterval(this.betsPollingInterval);
    Backend.logout();
    this.user = null;
    this.uid = null;
    this.userBalance = 0;
    this.activeBets = [];
    this.pastBets = [];
    this.isEmailVerified = false;
    this.initialBetsLoaded = false;
    this.globalWins = [];

    // Chiude il menu se aperto
    const menu = document.getElementById('dropdown-menu');
    menu?.classList.remove('show');

    this.updateWalletUI();
    this.showToast('Hai effettuato il logout.', '👋');
    this.showHomePage();
  },

  // ---- WALLET UI ----
  updateWalletUI() {
    const wallet = document.getElementById('user-wallet');
    const tokens = document.getElementById('user-tokens');
    const loginBtn = document.getElementById('btn-login-header');
    const profileBtn = document.getElementById('btn-profile-header');

    // Menu dropdown links
    const menuLogoutLink = document.getElementById('menu-logout-link');
    const menuBetsLink = document.getElementById('menu-bets-link');
    const menuVerifyLink = document.getElementById('menu-verify-link');

    if (this.uid) { // Se abbiamo un UID, l'utente è loggato
      const nickname = this.user;

      wallet?.classList.remove('hidden');
      if (tokens) tokens.textContent = this.userBalance;

      loginBtn?.classList.add('hidden');
      if (profileBtn) {
        const verifiedIcon = this.isEmailVerified ? ' <span title="Account Verificato" style="color: #2196F3;">✅</span>' : '';
        profileBtn.innerHTML = `@${nickname}${verifiedIcon}`;
        profileBtn.classList.remove('hidden');
      }

      // Update menu links - Force visibility
      menuLogoutLink?.classList.remove('hidden');
      menuBetsLink?.classList.remove('hidden');

      if (menuVerifyLink) {
        if (!this.isEmailVerified) {
          menuVerifyLink.classList.remove('hidden');
        } else {
          menuVerifyLink.classList.add('hidden');
        }
      }
    } else {
      wallet?.classList.add('hidden');
      loginBtn?.classList.remove('hidden');
      profileBtn?.classList.add('hidden');

      // Update menu links
      menuLogoutLink?.classList.add('hidden');
      menuBetsLink?.classList.add('hidden');
      menuVerifyLink?.classList.add('hidden');
    }
  },

  async resendVerificationEmail() {
    this.toggleMenu();

    const lastSent = localStorage.getItem('last_verification_email_sent');
    if (lastSent) {
      const now = Date.now();
      const diff = now - parseInt(lastSent);
      const oneHour = 60 * 60 * 1000;
      if (diff < oneHour) {
        const remainingMinutes = Math.ceil((oneHour - diff) / 60000);
        this.showToast(`Attendi ${remainingMinutes} minuti prima di richiedere un'altra email.`, "⏳");
        return;
      }
    }

    this.showToast("Invio in corso...", "⏳");
    try {
      await Backend.resendVerification();
      localStorage.setItem('last_verification_email_sent', Date.now().toString());
      this.showToast("Email inviata! Controlla anche la cartella Spam.", "📧");
    } catch (e) {
      this.showToast(e.message || "Errore durante l'invio.", "❌");
    }
  },

  // ---- POLLING SCOMMESSE ----
  _startBetsPolling() {
    if (this.betsPollingInterval) clearInterval(this.betsPollingInterval);
    this.refreshBets();
    this.betsPollingInterval = setInterval(() => this.refreshBets(), 300000); // 5 minuti
  },

  async refreshBets() {
    if (!Backend.isLoggedIn()) return;
    try {
      const [active, past, profile] = await Promise.all([
        Backend.getActiveBets(),
        Backend.getPastBets(),
        Backend.getProfile(),
      ]);

      // Toast per scommesse appena risolte
      if (this.pastBets.length > 0 && past.length > this.pastBets.length) {
        const r = past[0];
        if (r.status === 'won') this.showToast(`HAI VINTO ${r.win_amount}🪙! ${r.train_number}`, '🏆');
        else if (r.status === 'lost') this.showToast(`Hai perso su ${r.train_number}.`, '❌');
        else if (r.status === 'refunded') this.showToast(`Scommessa su ${r.train_number} rimborsata.`, '💰');
      }

      // Converti snake_case → camelCase per compatibilità con Components
      this.activeBets = active.map(b => ({
        id: b.bet_id, trainId: b.train_id, trainNumber: b.train_number,
        trainRoute: b.train_route, predictedDelay: b.predicted_delay,
        amount: b.amount, odds: b.odds, stationCode: b.station_code,
        dataPartenza: b.data_partenza, placedAt: b.placed_at, status: b.status,
        scheduledDeparture: b.scheduled_departure, scheduledArrival: b.scheduled_arrival
      }));

      this.pastBets = past.map(b => ({
        id: b.bet_id, trainId: b.train_id, trainNumber: b.train_number,
        trainRoute: b.train_route, predictedDelay: b.predicted_delay,
        amount: b.amount, odds: b.odds, placedAt: b.placed_at,
        resolvedAt: b.resolved_at, status: b.status, outcome: b.status,
        actualDelay: b.actual_delay, winAmount: b.win_amount,
        scheduledDeparture: b.scheduled_departure, scheduledArrival: b.scheduled_arrival
      }));

      // Dati base caricati
      this.userBalance = profile.balance;
      if (profile.bonus_granted) {
        this.showToast('Hai ricevuto 50 Token gratis per oggi! 🎁', '💰');
      }
      this.updateWalletUI();

      // Assicurati che i dettagli live dei treni siano sempre aggiornati per i filtri della Home
      for (const bet of this.activeBets) {
        if (bet.trainId) {
          const parts = bet.trainId.split('-');
          const train = await Api.fetchTrainDetails(
            bet.stationCode || parts[1], parseInt(parts[0]),
            parts.length >= 3 ? parts.slice(2).join('-') : null
          ).catch(() => null);

          if (train) {
            const idx = this.trains.findIndex(t => t.id === train.id);
            if (idx > -1) this.trains[idx] = train;
            else this.trains.push(train);
          }
        }
      }

      if (this.currentView === 'bets') {
        this.renderPage();
      }
    } catch (err) {
      console.error('Errore refresh scommesse:', err);
      if (err.message.includes('Sessione scaduta') || !Backend.isLoggedIn()) {
        this.logout();
        this.showToast('Sessione scaduta. Effettua il login.', '⚠️');
      }
    } finally {
      this.initialBetsLoaded = true;
      if (this.currentView === 'bets') this.renderPage();
    }
  },

  // ---- ODDS ----
  // La formula è ora gestita interamente dal backend per sicurezza e coerenza.


  // ---- SCOMMESSA ----
  async openBetModal(trainId) {
    if (!this.user) { this.showLoginModal(); return; }
    let train = this.trains.find(t => t.id === trainId);
    if (!train) return;

    if (this.activeBets.some(b => b.trainId === train.id)) {
      this.showToast('Hai già scommesso su questo treno!', '⚠️'); return;
    }

    // Cambia il tasto in "Caricamento..." per feedback immediato
    const btn = document.querySelector(`.train-card[data-train-id="${trainId}"] .btn-bet`);
    const originalText = btn ? btn.textContent : '+ Scommetti';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳...';
    }

    try {
      // Carica i dettagli freschi (fermate, ritardo reale, ecc.)
      const details = await Api.fetchTrainDetails(train.codOrigine, train.trainNumber, train.dataPartenza);
      if (details) {
        Object.assign(train, details);
      }
    } catch (e) {
      console.warn("Impossibile caricare dettagli completi", e);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }

    // Inizializza stato per il modal
    this.currentTrainDelay = train.currentDelay || 0;
    this.currentTrainId = train.id;
    this.currentTrainPlannedArrival = train.plannedArrival;
    this.currentBetBaseOdds = null;
    this.currentBetOdds = null;

    document.getElementById('bet-modal')?.remove();
    document.body.insertAdjacentHTML('beforeend', Components.betModal(train, null));
    requestAnimationFrame(() => document.getElementById('bet-modal').classList.add('show'));

    // Carica immediatamente la quota UFFICIALE per il ritardo attuale
    this.prepareBet(train.id);
    this.updateEstimatedArrival(this.currentTrainDelay);

    // Carica il grafico distribuzione scommesse
    this.loadBetDistributionChart(train.id);
  },

  async loadBetDistributionChart(trainId) {
    const container = document.getElementById('bet-chart-container');
    const totalEl = document.getElementById('bet-dist-total');
    if (!container) return;

    try {
      const data = await Backend.getTrainBetDistribution(trainId);
      const bands = data.bands || [];
      const total = data.total || 0;

      if (totalEl) totalEl.textContent = `${total} puntate`;

      if (total === 0) {
        container.innerHTML = '<div class="bet-chart-empty">Nessuna puntata su questo treno. Sii il primo! 🎯</div>';
        return;
      }

      // Crea il canvas
      container.innerHTML = '<canvas id="bet-dist-canvas"></canvas>';
      const canvas = document.getElementById('bet-dist-canvas');
      if (!canvas) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      const W = rect.width;
      const H = rect.height;
      const padLeft = 35;
      const padRight = 15;
      const padTop = 15;
      const padBottom = 28;
      const chartW = W - padLeft - padRight;
      const chartH = H - padTop - padBottom;

      const labels = bands.map(b => b.label);
      const counts = bands.map(b => b.count);
      const pools = bands.map(b => b.pool);
      const maxCount = Math.max(...counts, 1);
      const n = labels.length;

      // Colori per le fasce
      const bandColors = ['#4CAF50', '#FFC107', '#FF9800', '#F44336', '#9C27B0'];

      // Sfondo griglia
      const isDark = document.body.classList.contains('dark-mode');
      const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
      const textColor = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)';

      // Linee griglia orizzontali
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      const gridSteps = 4;
      for (let i = 0; i <= gridSteps; i++) {
        const y = padTop + (chartH / gridSteps) * i;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(W - padRight, y);
        ctx.stroke();

        // Label asse Y
        const val = Math.round(maxCount * (1 - i / gridSteps));
        ctx.fillStyle = textColor;
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(val, padLeft - 6, y + 3);
      }

      // Punti del grafico
      const points = counts.map((c, i) => ({
        x: padLeft + (chartW / (n - 1)) * i,
        y: padTop + chartH - (c / maxCount) * chartH,
      }));

      // Gradient fill sotto la linea
      const gradient = ctx.createLinearGradient(0, padTop, 0, padTop + chartH);
      gradient.addColorStop(0, isDark ? 'rgba(225, 29, 72, 0.35)' : 'rgba(225, 29, 72, 0.2)');
      gradient.addColorStop(1, 'rgba(225, 29, 72, 0)');

      // Area sotto la curva (con curve smussate)
      ctx.beginPath();
      ctx.moveTo(points[0].x, padTop + chartH);
      ctx.lineTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        const cp1x = (points[i - 1].x + points[i].x) / 2;
        const cp1y = points[i - 1].y;
        const cp2x = cp1x;
        const cp2y = points[i].y;
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, points[i].x, points[i].y);
      }
      ctx.lineTo(points[points.length - 1].x, padTop + chartH);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();

      // Linea principale (curva smussata)
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        const cp1x = (points[i - 1].x + points[i].x) / 2;
        const cp1y = points[i - 1].y;
        const cp2x = cp1x;
        const cp2y = points[i].y;
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, points[i].x, points[i].y);
      }
      ctx.strokeStyle = '#e11d48';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Punti + etichette
      points.forEach((p, i) => {
        // Cerchio colorato per fascia
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = bandColors[i];
        ctx.fill();
        ctx.strokeStyle = isDark ? '#262626' : '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Valore sopra il punto (solo se > 0)
        if (counts[i] > 0) {
          ctx.fillStyle = isDark ? '#ffffff' : '#171717';
          ctx.font = 'bold 10px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(counts[i], p.x, p.y - 10);

          // Pool sotto il punto
          ctx.fillStyle = textColor;
          ctx.font = '9px Inter, sans-serif';
          ctx.fillText(`${pools[i]}$`, p.x, p.y - 0);
        }

        // Label asse X
        ctx.fillStyle = bandColors[i];
        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(labels[i], p.x, H - 5);
      });

    } catch (e) {
      console.error('Errore caricamento distribuzione:', e);
      container.innerHTML = '<div class="bet-chart-empty">Errore caricamento dati</div>';
    }
  },

  updateDynamicOdds(predictedDelay) {
    // Quando l'utente muove lo slider, resettiamo il bottone a "Calcola Quota"
    this.stopBetTimer();
    const btn = document.getElementById('btn-bet-main');
    if (btn && btn.textContent !== 'Calcola Quota') {
      btn.textContent = 'Calcola Quota';
      btn.classList.remove('btn-ready');
      btn.setAttribute('onclick', `App.prepareBet('${this.currentTrainId}')`);
    }

    // Oscura la quota e la vincita finché non viene ricalcolata ufficialmente
    const oddsEl = document.querySelector('.odds-banner span');
    if (oddsEl) oddsEl.textContent = `x?.??`;

    const winValEl = document.getElementById('win-preview-value');
    if (winValEl) winValEl.textContent = '---';

    // RESET QUOTA IN MEMORIA
    this.currentBetOdds = null;

    // Aggiorna orario arrivo previsto basato sulla scelta dello slider
    this.updateEstimatedArrival(predictedDelay);
  },

  adjustSlider(delta) {
    const slider = document.getElementById('bet-delay-slider');
    if (!slider) return;

    let newValue = parseInt(slider.value) + delta;
    if (newValue < parseInt(slider.min)) newValue = parseInt(slider.min);
    if (newValue > parseInt(slider.max)) newValue = parseInt(slider.max);

    slider.value = newValue;

    // Trigger UI updates
    const display = document.getElementById('bet-delay-value');
    if (display) display.textContent = newValue + 'm';

    this.updateDynamicOdds(newValue);
  },

  updateEstimatedArrival(delayMinutes) {
    if (!this.currentTrainPlannedArrival) return;
    
    try {
      const [hours, minutes] = this.currentTrainPlannedArrival.split(':').map(Number);
      const date = new Date();
      date.setHours(hours, minutes, 0, 0);
      
      // Aggiungi i minuti di ritardo
      date.setMinutes(date.getMinutes() + parseInt(delayMinutes));
      
      const newTime = date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
      const el = document.getElementById('estimated-arrival-time');
      if (el) el.textContent = newTime;
    } catch (e) {
      console.error("Errore calcolo arrivo previsto", e);
    }
  },

  async prepareBet(trainId) {
    const btn = document.getElementById('btn-bet-main');
    const slider = document.getElementById('bet-delay-slider');
    
    // Forza la lettura del valore attuale dello slider
    const predictedDelay = slider ? parseInt(slider.value) : (this.currentTrainDelay || 0);

    console.log(`[DEBUG] Preparazione scommessa: treno=${trainId} ritardo=${predictedDelay}`);

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Calcolo...';
    }

    // Reset quota e vincita mentre calcola
    this.currentBetOdds = null;
    const winValElInitial = document.getElementById('win-preview-value');
    if (winValElInitial) winValElInitial.textContent = '---';

    try {
      // Ottieni la quota UFFICIALE dal server per questo ritardo specifico
      const officialOdds = await Backend.getOdds(trainId, predictedDelay);
      this.currentBetOdds = officialOdds;

      // Se stiamo calcolando il ritardo attuale, salviamola come quota base per le future stime locali
      if (predictedDelay === this.currentTrainDelay) {
        this.currentBetBaseOdds = officialOdds;
      }

      // Aggiorna la UI con la quota ufficiale
      const oddsEl = document.querySelector('.odds-banner span');
      if (oddsEl) oddsEl.textContent = `x${officialOdds.toFixed(2)}`;
      
      const winValEl = document.getElementById('win-preview-value');
      if (winValEl) {
        winValEl.textContent = (this.betAmount * officialOdds).toFixed(0);
      }

      // Trasforma il bottone in "Piazza Scommessa" con TIMER
      if (btn) {
        btn.disabled = false;
        btn.classList.add('btn-ready');
        this.startBetTimer(10, trainId);
      }
    } catch (e) {
      console.error("Errore calcolo quota ufficiale", e);
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Riprova Calcolo';
      }
    }
  },

  startBetTimer(seconds, trainId) {
    this.stopBetTimer(); // Pulisci eventuali timer precedenti
    
    const btn = document.getElementById('btn-bet-main');
    let timeLeft = seconds;

    const updateBtn = () => {
      if (btn) {
        btn.innerHTML = `Piazza Scommessa <span style="opacity: 0.7; font-size: 0.9em;">(${timeLeft}s)</span>`;
        btn.setAttribute('onclick', `App.placeBet('${trainId}')`);
      }
    };

    updateBtn();

    this.betTimerInterval = setInterval(() => {
      timeLeft--;
      if (timeLeft <= 0) {
        this.stopBetTimer();
        if (btn) {
          btn.textContent = 'Quota Scaduta - Ricalcola';
          btn.classList.remove('btn-ready');
          btn.setAttribute('onclick', `App.prepareBet('${trainId}')`);
        }
      } else {
        updateBtn();
      }
    }, 1000);
  },

  stopBetTimer() {
    if (this.betTimerInterval) {
      clearInterval(this.betTimerInterval);
      this.betTimerInterval = null;
    }
  },

  closeBetModal(event) {
    if (event && event.target !== event.currentTarget) return;
    this.stopBetTimer();
    const m = document.getElementById('bet-modal');
    if (m) { m.classList.remove('show'); setTimeout(() => m.remove(), 300); }
  },

  setBetAmount(amount, isCustom = false) {
    this.betAmount = parseInt(amount) || 0;

    // Update buttons
    const btns = document.querySelectorAll('.bet-amount-btn');
    btns.forEach(b => {
      b.classList.remove('active');
      if (!isCustom && b.textContent == amount) b.classList.add('active');
    });

    if (!isCustom) {
      const customInput = document.getElementById('custom-bet-amount');
      if (customInput) customInput.value = '';
    }

    const winValEl = document.getElementById('win-preview-value');
    if (winValEl) {
      if (typeof this.currentBetOdds === 'number') {
        const win = (this.betAmount * this.currentBetOdds).toFixed(0);
        winValEl.textContent = win;
      } else {
        winValEl.textContent = '---';
      }
    }
  },

  async placeBet(trainId) {
    const btn = document.getElementById('btn-bet-main');
    const modalContent = document.querySelector('#bet-modal .modal-content');
    if (!btn || !modalContent) return;

    const originalContent = btn.innerHTML;
    
    // 1. BLOCCO INPUT E INTERFACCIA
    btn.disabled = true;
    btn.classList.add('loading');
    modalContent.classList.add('loading-active');
    
    const setStatus = (text) => {
      btn.innerHTML = `<span class="spinner-small"></span> ${text}`;
    };

    try {
      // STEP 1: Verifica preliminare
      setStatus("Verifica saldo...");
      await new Promise(r => setTimeout(r, 600));

      if (!this.isEmailVerified) {
        const profile = await Backend.getProfile();
        this.isEmailVerified = profile.is_email_verified;
        this.updateWalletUI();

        if (!this.isEmailVerified) {
          this.showToast("Email non verificata! Controlla la posta.", "⚠️");
          throw new Error('Email non verificata');
        }
      }

      // STEP 2: Validazione Input
      const slider = document.getElementById('bet-delay-slider');
      const predictedDelay = slider ? parseInt(slider.value) : 0;

      if (this.betAmount <= 0) {
        alert('Inserisci un importo valido!');
        throw new Error('Importo non valido');
      }
      if (this.userBalance < this.betAmount) {
        alert('Non hai abbastanza token!');
        throw new Error('Token insufficienti');
      }

      const train = this.trains.find(t => t.id === trainId);
      if (!train) throw new Error('Treno non trovato');

      // STEP 3: Invio scommessa al server
      setStatus("Invio puntata...");
      const startTime = Date.now();
      
      await Backend.placeBet(train, predictedDelay, this.betAmount, this.currentBetOdds || 2.0);
      
      // Aggiorniamo subito il saldo locale per feedback immediato
      this.userBalance -= this.betAmount;
      this.updateWalletUI();

      // STEP 4: Sincronizzazione finale
      setStatus("Sincronizzazione...");
      
      // Assicuriamoci che il caricamento duri almeno 1500ms per un effetto solido ma veloce
      const elapsed = Date.now() - startTime;
      if (elapsed < 1000) await new Promise(r => setTimeout(r, 1000 - elapsed));

      // SUCCESS!
      btn.classList.remove('loading');
      btn.classList.add('success');
      btn.innerHTML = 'Puntata Confermata! ✨';
      
      await this.refreshBets();
      this.stopBetTimer();
      
      setTimeout(() => {
        this.closeBetModal();
        this.showToast(`Scommessa piazzata! -${this.betAmount}🪙`, '🎲');
      }, 800);

    } catch (err) {
      console.error("Errore piazzamento:", err);
      
      // RIPRISTINO INTERFACCIA
      btn.disabled = false;
      btn.classList.remove('loading');
      modalContent.classList.remove('loading-active');
      btn.innerHTML = originalContent;
      
      if (err.message !== 'Email non verificata' && !err.message.includes('insufficienti') && !err.message.includes('valido')) {
        this.showToast("Errore durante il piazzamento. Riprova.", "❌");
      }
    }
  },

  // ---- PAGINE ----
  async showMyBetsPage() {
    this.closeMenu();
    if (!this.user) { this.showLoginModal(); return; }
    this.currentView = 'bets';
    this.renderPage();
    for (const bet of this.activeBets) {
      if (!this.trains.find(t => t.id === bet.trainId) && bet.trainId) {
        const parts = bet.trainId.split('-');
        const train = await Api.fetchTrainDetails(
          bet.stationCode || parts[1], parseInt(parts[0]),
          parts.length >= 3 ? parts.slice(2).join('-') : null
        ).catch(() => null);
        if (train) { train.id = bet.trainId; if (!this.trains.find(t => t.id === train.id)) this.trains.push(train); }
      }
    }
    if (this.currentView === 'bets') this.renderPage();
  },

  showHomePage() {
    this.closeMenu();
    this.currentView = 'home';
    this.renderPage();
  },

  async showLeaderboardPage() {
    this.closeMenu();
    this.currentView = 'leaderboard';
    this.renderPage();
    try {
      this.leaderboardUsers = await Backend.getLeaderboard();
      this.renderPage();
    } catch (e) { console.error("Errore classifica", e); }
  },

  async showWinsPage() {
    this.closeMenu();
    this.currentView = 'wins';
    this.renderPage();
    try {
      const wins = await Backend.getGlobalWins();
      this.globalWins = wins.slice(0, 20);
      this.renderPage();
    } catch (e) { console.error("Errore vincite", e); }
  },

  // ---- TOAST ----
  showToast(message, icon) {
    document.getElementById('app-toast')?.remove();
    document.body.insertAdjacentHTML('beforeend', Components.toast(message, icon));
    const toast = document.getElementById('app-toast');
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 4000);
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
window.App = App;