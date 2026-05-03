// ============================================================
// Treni Live — UI Components
// ============================================================

const Components = {

  // ---- TRAIN CARD (real data) ----
  trainCard(train, betStats = { count: 0, pool: 0 }) {
    const typeInfo = TrainData.TRAIN_TYPES[train.type] || TrainData.TRAIN_TYPES.REG;
    const isDelayed = train.currentDelay > 0;
    let delayClass = train.currentDelay > 30 ? 'severe' : train.currentDelay > 15 ? 'moderate' : train.currentDelay > 0 ? 'light' : 'ontime';

    // Delay color
    let delayColor = '#4CAF50';
    if (train.currentDelay > 30) delayColor = '#F44336';
    else if (train.currentDelay > 15) delayColor = '#FF9800';
    else if (train.currentDelay > 0) delayColor = '#FFC107';

    // Status badge
    let statusBadge = '';
    if (train.status === 'arrivato') {
      statusBadge = '<span class="status-badge status-arrived">Arrivato</span>';
      delayClass += ' arrived';
    } else if (train.status === 'non_partito') {
      statusBadge = '<span class="status-badge status-notdeparted">Non partito</span>';
    } else if (train.status === 'in_stazione') {
      statusBadge = '<span class="status-badge status-instation">In stazione</span>';
    }

    const betCount = betStats.count;
    const poolAmount = betStats.pool;

    return `
      <div class="train-card ${delayClass}" data-train-id="${train.id}">
        <div class="train-card-header">
          <div class="train-info">
            <span class="train-number" style="color: ${typeInfo.color}">${train.number}</span>
            ${statusBadge}
          </div>
          <div class="train-pool">
            <span class="pool-amount">${poolAmount} $</span>
            <span class="pool-label">${betCount} Puntate</span>
          </div>
        </div>

        <div class="train-route">
          <span class="station">🇮🇹 ${train.from}</span>
          <span class="route-arrow">→</span>
          <span class="station">🇮🇹 ${train.to}</span>
        </div>

        <div class="train-times">
          <div class="time-col">
            <span class="time-label">PARTENZA</span>
            <span class="time-value">${train.departure || '--:--'}</span>
          </div>
          ${train.binario ? `
          <div class="time-col">
            <span class="time-label">BINARIO</span>
            <span class="time-value binario-value">${train.binario}</span>
          </div>` : ''}
          <div class="time-col">
            <span class="time-label">RITARDO</span>
            <span class="time-value ${isDelayed ? 'delayed' : 'ontime-text'}">${isDelayed ? '+' + train.currentDelay + 'm' : train.currentDelay < 0 ? train.currentDelay + 'm' : 'Puntuale'}</span>
          </div>
        </div>

        ${Components.delayBar(train.currentDelay)}

        <div class="train-card-footer">
          <div class="footer-left">
            <span class="live-dot ${train.isLive ? 'live' : ''}"></span>
            <span class="live-label">${train.isLive ? 'Live' : 'Programmato'} · ${train.statusLabel}</span>
          </div>
          ${train.status === 'in_viaggio' || train.status === 'in_stazione' || train.status === 'non_partito' ? `
          <div class="footer-right">
            <button class="btn-bet" onclick="App.openBetModal('${train.id}')">+ Scommetti</button>
          </div>
          ` : ''}
        </div>
      </div>
    `;
  },

  // ---- DELAY BAR ----
  delayBar(currentDelay) {
    if (currentDelay <= 0) return '';
    const maxBar = 60;
    const delayWidth = Math.min((currentDelay / maxBar) * 100, 100);

    let barColor = '#4CAF50';
    if (currentDelay > 30) barColor = '#F44336';
    else if (currentDelay > 10) barColor = '#FF9800';
    else if (currentDelay > 0) barColor = '#FFC107';

    return `
      <div class="delay-bar-container">
        <div class="delay-bar-track">
          <div class="delay-bar-fill" style="width: ${delayWidth}%; background: ${barColor};"></div>
        </div>
      </div>
    `;
  },

  // ---- JOURNEY PROGRESS ----
  journeyProgressBar(dep, arr) {
    if (!dep || !arr) return '';
    const now = Date.now();
    const total = arr - dep;
    if (total <= 0) return '';
    let pct = ((now - dep) / total) * 100;
    pct = Math.min(Math.max(pct, 0), 100);

    return `
      <div class="pbc-journey-container">
        <div class="pbc-journey-track">
          <div class="pbc-journey-fill" style="width: ${pct}%"></div>
          <div class="pbc-journey-train" style="left: ${pct}%">🚂</div>
        </div>
      </div>
    `;
  },

  // ---- TRAINS PAGE (HOME) ----
  trainsPage(trains, activeFilters, loading, globalBetsStats = {}) {
    if (loading) return '<div class="coming-soon">Caricamento treni... 🚂💨</div>';

    const filterHTML = `
      <div class="search-bar-container">
        <div class="search-bar">
          <span class="search-icon">🔍</span>
          <input type="text" class="search-input" id="train-search" placeholder="Cerca qualsiasi treno in Italia (es. 9540, 1955)...">
        </div>
      </div>
    `;

    return `
      <div class="trains-page">
        ${filterHTML}

        <div class="filter-chips">
          ${TrainData.FILTER_OPTIONS.map(f => `
            <button class="filter-chip ${activeFilters.includes(f.id) ? 'active' : ''}" data-filter="${f.id}" onclick="App.toggleFilter('${f.id}')">
              ${f.label}
            </button>
          `).join('')}
        </div>

        ${loading ? '<div class="loading-indicator"><div class="spinner"></div><p>Caricamento dati reali da Viaggiatreno...</p></div>' : ''}

        <div class="trains-stats" id="trains-stats"></div>
        <div class="trains-grid" id="trains-grid">
          ${trains.length > 0
        ? trains.map(t => Components.trainCard(t, globalBetsStats[t.id] || { count: 0, pool: 0 })).join('')
        : (!loading ? '<div class="no-results"><p>Nessun treno trovato 🚂💨</p></div>' : '')}
        </div>
      </div>
    `;
  },

  // ---- STATS BAR ----
  trainsStats(trains) {
    const total = trains.length;
    const delayed = trains.filter(t => t.currentDelay > 0).length;
    const onTime = trains.filter(t => t.currentDelay <= 0).length;
    const avgDelay = total > 0 ? Math.round(trains.reduce((s, t) => s + Math.max(0, t.currentDelay), 0) / total) : 0;
    return `
      <div class="stats-bar">
        <span><strong>${total}</strong> treni</span>
        <span><strong>${onTime}</strong> puntuali</span>
        <span class="stat-delayed"><strong>${delayed}</strong> in ritardo</span>
        <span><strong>⏱ Media +${avgDelay}m</strong></span>
      </div>
    `;
  },

  // ---- ONBOARDING MODAL ----
  onboardingModal(step = 0) {
    const s = TrainData.ONBOARDING_STEPS[step];
    const total = TrainData.ONBOARDING_STEPS.length;
    return `
      <div class="modal-overlay" id="onboarding-modal">
        <div class="modal-content onboarding-modal">
          <h2>${s.title}</h2><p>${s.text}</p>
          <div class="onboarding-dots">${TrainData.ONBOARDING_STEPS.map((_, i) => `<span class="onboarding-dot ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}"></span>`).join('')}</div>
          <div class="onboarding-actions">
            <button class="btn-secondary" onclick="App.closeOnboarding()">Salta</button>
            <button class="btn-primary" onclick="App.nextOnboardingStep()">${step < total - 1 ? 'Avanti' : 'Ho capito!'}</button>
          </div>
        </div>
      </div>
    `;
  },

  // ---- BET MODAL ----
  betModal(train, odds) {
    if (!train) return '';
    const delay = train.currentDelay;
    const delayDisplay = delay > 0 ? `+${delay}m` : (delay < 0 ? `${delay}m` : 'Puntuale');
    const sliderValue = Math.max(0, delay);

    return `
      <div class="modal-overlay" id="bet-modal" onclick="App.closeBetModal(event)">
        <div class="modal-content" onclick="event.stopPropagation()">
          <div class="modal-header"><h2>Scommetti su ${train.number}</h2><button class="modal-close" onclick="App.closeBetModal()">✕</button></div>
          <div class="modal-body">
            <div class="modal-train-info">
              <span>${train.from} → ${train.to}</span>
              <span class="modal-current-delay">Situazione: <strong style="color: ${delay > 0 ? '#F44336' : '#4CAF50'}">${delayDisplay}</strong></span>
            </div>
            
            <div class="odds-banner">
              <strong>Quota Attuale: <span style="font-size: 1.2em; color: var(--primary);">x${odds}</span></strong>
            </div>
            
            <div class="bet-input-group">
              <label>Ritardo finale previsto all'arrivo (minuti):</label>
              <div class="bet-slider-row">
                <button class="slider-arrow" onclick="App.adjustSlider(-1)">❮</button>
                <input type="range" min="0" max="400" value="${sliderValue}" class="bet-slider" id="bet-delay-slider" oninput="document.getElementById('bet-delay-value').textContent = this.value + 'm'; App.updateDynamicOdds(this.value)">
                <button class="slider-arrow" onclick="App.adjustSlider(1)">❯</button>
                <span class="bet-delay-display" id="bet-delay-value">${sliderValue}m</span>
              </div>
              <div style="font-size: 11px; color: var(--text2); margin-top: 4px;">
                Arrivo previsto: <strong id="estimated-arrival-time" style="color: var(--text);">${train.plannedArrival || '--:--'}</strong>
              </div>
            </div>
            
            <div class="bet-input-group" style="margin-top: 15px;">
              <label style="color: var(--text2);">Importo scommessa ($)</label>
              <div class="bet-amount-buttons" style="margin-bottom: 10px;">
                <button class="bet-amount-btn" onclick="App.setBetAmount(25)">25</button>
                <button class="bet-amount-btn active" onclick="App.setBetAmount(50)">50</button>
                <button class="bet-amount-btn" onclick="App.setBetAmount(100)">100</button>
                <button class="bet-amount-btn" onclick="App.setBetAmount(200)">200</button>
              </div>
              <input type="text" id="custom-bet-amount" class="bet-amount-input" placeholder="Altro importo..." pattern="[0-9]*" oninput="this.value = this.value.replace(/[^0-9]/g, ''); App.setBetAmount(this.value, true)" style="width: 100%; padding: 12px; background: var(--bg); border: 1px solid var(--border); color: var(--text); border-radius: 6px;">
            </div>

            <div id="bet-win-preview" class="bet-win-preview" style="text-align: center; margin: 15px 0; padding: 10px; background: rgba(76, 175, 80, 0.1); border-radius: 8px; color: #4CAF50; font-weight: 800;">
              Vincita potenziale: <span id="win-preview-value">${typeof odds === 'number' ? (50 * odds).toFixed(0) : '---'}</span> $
            </div>
            
            <button id="btn-bet-main" class="btn-bet-confirm" onclick="App.prepareBet('${train.id}')" style="margin-top: 12px;">Calcola Quota</button>
            <p class="bet-disclaimer">Saldo attuale: <strong style="color: var(--accent);">${App.userBalance || 0} $</strong></p>

             <div class="bet-distribution-widget" id="bet-distribution-widget">
              <div class="bet-distribution-header">
                <h4>Puntate degli altri</h4>
                <span class="bet-distribution-total" id="bet-dist-total">...</span>
              </div>
              <div class="bet-chart-container" id="bet-chart-container">
                <div class="bet-chart-loading"><span class="spinner-small" style="border-color: var(--text2); border-top-color: var(--accent);"></span> Caricamento...</div>
              </div>
            </div>
            
          </div>
        </div>
      </div>
    `;
  },

  // ---- LOGIN / REGISTER MODAL ----
  loginModal(mode = 'login') {
    const isReg = mode === 'register';
    return `
      <div class="modal-overlay" id="login-modal" onclick="App.closeLoginModal(event)">
        <div class="modal-content onboarding-modal" onclick="event.stopPropagation()">
          <h2 id="auth-title">${isReg ? 'Crea un Account' : 'Bentornato!'}</h2>
          <p id="auth-desc">${isReg ? 'Registrati per ricevere <strong>500 Token</strong> di benvenuto!' : 'Inserisci i tuoi dati per accedere al tuo profilo.'}</p>
          
          <div class="auth-input-group">
            <input type="email" id="login-email" class="search-input" placeholder="La tua Email">
          </div>

          <div class="auth-input-group">
            <input type="password" id="login-password" class="search-input" placeholder="Password (min 6 caratteri)">
            <button class="password-toggle-btn" onclick="App.togglePasswordVisibility('login-password')">👁️</button>
          </div>

          <div class="auth-input-group ${isReg ? '' : 'hidden'}" id="confirm-password-group">
            <input type="password" id="login-password-confirm" class="search-input" placeholder="Conferma Password">
            <button class="password-toggle-btn" onclick="App.togglePasswordVisibility('login-password-confirm')">👁️</button>
          </div>
          
          <div id="auth-action-container">
            ${isReg
        ? `<button class="btn-primary" style="width: 100%;" onclick="App.performRegister()">Registrati Ora</button>`
        : `<button class="btn-primary" style="width: 100%;" onclick="App.performLogin()">Accedi</button>`
      }
          </div>

          <div style="margin: 15px 0; display: flex; align-items: center; gap: 10px;">
            <div style="flex: 1; height: 1px; background: var(--border);"></div>
            <span style="font-size: 12px; color: var(--text2);">oppure</span>
            <div style="flex: 1; height: 1px; background: var(--border);"></div>
          </div>

          <button class="btn-secondary" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; border-color: var(--border);" onclick="App.loginWithGoogle()">
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="18" height="18">
            Accedi con Google
          </button>

          <div class="auth-mode-switch">
            <span id="auth-mode-text">${isReg ? 'Hai già un account?' : 'Non hai un account?'}</span>
            <span class="auth-mode-link" id="auth-mode-toggle" onclick="App.switchAuthMode()">
              ${isReg ? 'Accedi' : 'Registrati ora'}
            </span>
          </div>

          <p id="login-error" style="color: #F44336; font-size: 14px; margin-top: 10px; display: none;"></p>
        </div>
      </div>
    `;
  },

  // ---- WINS PAGE ----
  winsPage(wins = []) {
    return `
      <div class="wins-page">
        <div class="page-header">
          <button class="btn-secondary" onclick="App.showHomePage()">← Indietro</button>
          <h2 class="page-title">Ultime Vincite</h2>
          <p class="page-subtitle">La bacheca dei campioni di TreniBet</p>
        </div>

        <div class="wins-feed">
          ${wins.length === 0 ? '<div class="no-results">Nessuna vincita recente... chi sarà il prossimo? 🧐</div>' : ''}
          ${wins.map(w => `
            <div class="win-card">
              <div class="win-header">
                <span class="win-user">👤 ${w.username}</span>
                <span class="win-date">${w.date}</span>
              </div>
              <div class="win-body">
                <div class="win-train">🚂 Treno ${w.trainNumber}</div>
                <div class="win-stats">
                  <div class="win-stat">
                    <span class="ws-label">Puntata</span>
                    <span class="ws-value">${w.amount} $</span>
                  </div>
                  <div class="win-stat">
                    <span class="ws-label">Scommesso</span>
                    <span class="ws-value">${w.predictedDelay > 0 ? '+' : ''}${w.predictedDelay}m</span>
                  </div>
                  <div class="win-stat">
                    <span class="ws-label">Quota</span>
                    <span class="ws-value">x${w.odds}</span>
                  </div>
                  <div class="win-total">
                    <span class="wt-label">VINTO</span>
                    <span class="wt-value">+${w.won_amount} $</span>
                  </div>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },

  // ---- MY BETS PAGE ----
  betsPage(activeBets, pastBets, trains) {
    let activeList = '';

    if (!App.initialBetsLoaded) {
      activeList = `
        <div class="no-results" style="margin-top:20px; font-size: 1.2em;">
          <div class="spinner"></div>
          <p>Caricamento ...</p>
        </div>`;
    } else if (!activeBets || activeBets.length === 0) {
      activeList = `
        <div class="no-results" style="margin-top:20px; font-size: 1.2em;">
          <p>Nessuna scommessa in corso.</p>
        </div>`;
    } else {
      activeList = activeBets.map(bet => {
        const train = trains.find(t => t.id === bet.trainId);
        const liveDelay = train ? train.currentDelay : '?';
        const trainStr = train ? `${train.from} → ${train.to}` : (bet.trainRoute || 'Tratta in calcolo...');

        let statusStr = train ? train.statusLabel : 'Aggiornamento...';
        let ritardoStr = train ? (liveDelay > 0 ? '+' + liveDelay + 'm' : liveDelay + 'm') : '...';
        const now = Date.now();

        if (!train) {
          if (bet.scheduledDeparture && now < bet.scheduledDeparture) {
            const time = new Date(bet.scheduledDeparture).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
            statusStr = `In partenza alle ${time}`;
          } else if (bet.scheduledArrival && now > bet.scheduledArrival) {
            statusStr = `Arrivato / In chiusura`;
          } else if (bet.scheduledDeparture && now >= bet.scheduledDeparture) {
            statusStr = `In viaggio`;
          }
        }

        let dataFmt = bet.dataPartenza;
        if (dataFmt && !isNaN(dataFmt)) {
          dataFmt = new Date(parseInt(dataFmt)).toLocaleDateString('it-IT');
        }

        let [routeFrom, routeTo] = trainStr.split('→').map(s => s.trim());
        if (!routeTo) { routeFrom = trainStr; routeTo = 'Destinazione in calcolo'; }

        let liveDelayClass = liveDelay > 0 ? 'highlight' : (liveDelay === '?' ? '' : 'success');
        let delayBadge = liveDelay > 0 ? '+' + liveDelay + 'm' : (liveDelay === '?' ? '?' : liveDelay + 'm');
        let statusDotClass = liveDelay > 0 ? 'delayed' : '';
        let lastPos = 'In calcolo...';
        if (train) {
          if (train.raw && train.raw.stazioneUltimoRilevamento) {
            lastPos = Api.formatStationName(train.raw.stazioneUltimoRilevamento);
          } else {
            lastPos = train.from; // Fallback alla partenza
          }
        }

        let possibleWin = (bet.amount * (bet.odds || 3)).toFixed(0);

        return `
            <div class="premium-bet-card">
              <div class="pbc-header">
                <div class="pbc-train-badge">
                  🚂 ${bet.trainNumber}
                  <span class="date">${dataFmt || ''}</span>
                </div>
                <div style="text-align: right;">
                  <div class="pbc-odds" style="display:inline-block; margin-bottom:4px;">Quota x${bet.odds || 3}</div>
                  <div style="font-size: 13px; font-weight: 800; color: #4caf50;">Vincita: ${possibleWin} $</div>
                </div>
              </div>
              
              <div class="pbc-route">
                <div class="pbc-station">
                    ${routeFrom}
                    <div style="font-size: 0.8em; opacity: 0.8;">Partenza: ${train ? train.departure : '--:--'}</div>
                </div>
                <div class="pbc-station">
                    ${routeTo}
                    <div style="font-size: 0.8em; color: var(--accent);">
                        Arrivo previsto: ${train ? (() => {
            const sched = bet.scheduledArrival;
            const currentDelay = (train.currentDelay || 0);

            try {
              if (sched && sched > 0) {
                // Caso 1: Abbiamo il timestamp preciso
                const est = new Date(sched + (currentDelay * 60000));
                return est.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
              }

              // Caso 2: Fallback su plannedArrival
              if (train.plannedArrival) {
                if (typeof train.plannedArrival === 'number') {
                  const est = new Date(train.plannedArrival + (currentDelay * 60000));
                  return est.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
                }
                if (typeof train.plannedArrival === 'string' && train.plannedArrival.includes(':')) {
                  const [hh, mm] = train.plannedArrival.split(':').map(Number);
                  if (!isNaN(hh) && !isNaN(mm)) {
                    const date = new Date();
                    date.setHours(hh, mm + currentDelay, 0, 0);
                    return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
                  }
                }
                return train.plannedArrival;
              }
            } catch (e) {
              console.warn("Errore calcolo arrivo", e);
            }
            return '--:--';
          })() : '--:--'}
                    </div>
                </div>
              </div>

              <div class="pbc-metrics">
                <div class="pbc-metric">
                  <span class="label">Puntata</span>
                  <span class="value">${bet.amount} $</span>
                </div>
                <div class="pbc-metric">
                  <span class="label">Scommesso</span>
                  <span class="value"><strong>+${bet.predictedDelay || 0}m</strong></span>
                </div>
                <div class="pbc-metric ${liveDelayClass}">
                  <span class="label">Ritardo Live</span>
                  <span class="value">${delayBadge}</span>
                </div>
              </div>
              
              <div class="pbc-footer">
                <span class="pbc-status-dot ${statusDotClass}"></span>
                <div style="flex: 1;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong>${statusStr}</strong>
                    </div>
                    <div style="font-size: 0.9em; margin-top: 2px;">Posizione: ${lastPos}</div>
                    ${train && train.status !== 'non_partito' && train.missingStops > 0 ? `<div style="color:var(--accent); font-size:0.9em; margin-top: 4px;">📍 Fermate rimanenti: <strong>${train.missingStops}</strong></div>` : ''}
                </div>
              </div>
            </div>
        `;
      }).join('');
    }

    let pastList = pastBets && pastBets.length > 0
      ? pastBets.map(bet => {
        const isWon = bet.outcome === 'won';
        const isRefunded = bet.outcome === 'refunded';
        const resultColor = isRefunded ? '#FF9800' : (isWon ? '#4CAF50' : '#F44336');
        const winText = isRefunded ? `Rimborsato ${bet.winAmount} $` : (isWon ? `Vinto +${bet.winAmount} $` : 'Perso');

        const routeStr = bet.trainRoute || 'Tratta non disponibile';
        let [routeFrom, routeTo] = routeStr.split('→').map(s => s.trim());
        if (!routeTo) { routeFrom = routeStr; routeTo = 'Destinazione sconosciuta'; }

        return `
            <div class="premium-bet-card" style="margin-bottom: 15px; opacity: 0.9; border-left: 4px solid ${resultColor};">
              <div class="pbc-header">
                <div class="pbc-train-badge">
                  🚂 ${bet.trainNumber}
                </div>
                <div style="text-align: right;">
                  <span style="background:${resultColor}; color:white; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px;">${winText}</span>
                </div>
              </div>

              <div class="pbc-route">
                <div class="pbc-station">${routeFrom}</div>
                <div class="pbc-station">${routeTo}</div>
              </div>

              <div class="pbc-metrics" style="margin-top: 10px;">
                <div class="pbc-metric">
                  <span class="label">Puntata</span>
                  <span class="value">${bet.amount} $ <small style="opacity:0.6">(x${bet.odds})</small></span>
                </div>
                <div class="pbc-metric">
                  <span class="label">Scommesso</span>
                  <span class="value">+${bet.predictedDelay || 0}m</span>
                </div>
                <div class="pbc-metric">
                  <span class="label">Ritardo Reale</span>
                  <span class="value" style="color: ${resultColor}">+${bet.actualDelay || 0}m</span>
                </div>
              </div>
            </div>
          `;
      }).join('')
      : '<p class="bet-helper-text">Non hai ancora uno storico.</p>';

    return `
      <div class="trains-page" id="my-bets-page">
        <div class="modal-header" style="margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
        <button class="btn-secondary" onclick="App.showHomePage()">← Indietro</button>  
        <h2 style="margin: 0;">Le Mie Scommesse</h2>
        </div>
        
        

        <h3 style="margin-bottom: 15px; color: var(--text-color); border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 5px;">In Corso</h3>
        <div class="my-bets-list">
          ${activeList}
        </div>

        <h3 style="margin-top: 30px; margin-bottom: 15px; color: var(--text-color); border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 5px;">Storico (Recenti)</h3>
        <div class="my-bets-history-list">
          ${pastList}
        </div>
      </div>
    `;
  },

  // ---- LEADERBOARD PAGE ----
  leaderboardPage(users, currentUid) {
    let listHTML = '';

    const headerHTML = `
      <div class="page-header" style="margin-bottom: 20px;">
        <button class="btn-secondary" onclick="App.showHomePage()">← Indietro</button>
        <h2 class="page-title">🏆 Classifica Globale</h2>
        <p class="page-subtitle">I migliori campioni di TreniBet</p>
      </div>
    `;

    users.forEach((user, index) => {
      const isMe = user.id === currentUid;
      const rank = index + 1;

      let badge = '';
      if (rank === 1) badge = '🥇';
      else if (rank === 2) badge = '🥈';
      else if (rank === 3) badge = '🥉';
      else badge = `<strong>${rank}°</strong>`;

      listHTML += `
        <div class="bet-card" style="margin-bottom: 15px; display: flex; align-items: center; justify-content: space-between; border: ${isMe ? '2px solid var(--accent)' : '1px solid var(--border)'}; background: var(--card);">
          <div style="display: flex; align-items: center; gap: 15px;">
            <div style="font-size: 1.5em; width: 30px; text-align: center;">${badge}</div>
            <div style="font-size: 1.2em; font-weight: ${isMe ? 'bold' : 'normal'};">@${user.nickname} ${isMe ? '(Tu)' : ''}</div>
          </div>
          <div style="font-size: 1.3em; font-weight: bold; color: var(--accent);">
            ${user.balance} <span style="font-size: 0.8em;">$</span>
          </div>
        </div>
      `;
    });

    if (users.length === 0) {
      listHTML = '<div class="no-results"><p>Nessun giocatore trovato.</p></div>';
    }

    return `
      <div class="leaderboard-page" id="leaderboard-page">
        ${headerHTML}
        <div class="leaderboard-list">
          ${listHTML}
        </div>
      </div>
    `;
  },

  // ---- TOAST ----
  toast(message, icon = '✅') {
    return `<div class="toast" id="app-toast"><span class="toast-icon">${icon}</span><span class="toast-text">${message}</span></div>`;
  }
};

window.Components = Components;
