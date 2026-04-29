// ============================================================
// Treno.bet — API Client
// Chiama il proxy locale per dati Viaggiatreno in tempo reale
// ============================================================

const API_BASE = '/api';

const Api = {

  // Fetch partenze da una stazione
  async fetchDepartures(stationCode) {
    try {
      const res = await fetch(`${API_BASE}/partenze/${stationCode}/`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.map(t => Api.transformTrain(t, stationCode, 'partenza'));
    } catch (err) {
      console.error('[API] Errore partenze:', err);
      return [];
    }
  },

  // Fetch arrivi a una stazione
  async fetchArrivals(stationCode) {
    try {
      const res = await fetch(`${API_BASE}/arrivi/${stationCode}/`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.map(t => Api.transformTrain(t, stationCode, 'arrivo'));
    } catch (err) {
      console.error('[API] Errore arrivi:', err);
      return [];
    }
  },

  // Search stations via autocomplete
  async searchStations(query) {
    if (!query || query.length < 2) return [];
    try {
      const res = await fetch(`${API_BASE}/stazioni/${encodeURIComponent(query)}/`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      // Response format: "STAZIONE\tS12345\nSTAZIONE2\tS12346\n"
      return text.trim().split('\n').filter(Boolean).map(line => {
        const [name, code] = line.split('\t');
        return { name: name?.trim(), code: code?.trim() };
      }).filter(s => s.name && s.code);
    } catch (err) {
      console.error('[API] Errore ricerca stazioni:', err);
      return [];
    }
  },

  // Search train by number via Viaggiatreno autocomplete
  async searchTrainByNumber(trainNumber) {
    if (!trainNumber || trainNumber.length < 1) return [];
    try {
      const res = await fetch(`${API_BASE}/cercatreno/${encodeURIComponent(trainNumber)}/`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.trim()) return [];
      // Response: "9540 - NAPOLI CENTRALE - 18/04/26|9540-S09218-1776463200000\n"
      return text.trim().split('\n').filter(Boolean).map(line => {
        const [label, idPart] = line.split('|');
        if (!idPart) return null;
        const [numero, codOrigine, dataPartenza] = idPart.split('-');
        return {
          label: label.trim(),
          trainNumber: parseInt(numero),
          codOrigine,
          dataPartenza,
        };
      }).filter(Boolean);
    } catch (err) {
      console.error('[API] Errore ricerca treno:', err);
      return [];
    }
  },

  // Fetch full train details (andamentoTreno) and transform to our format
  async fetchTrainDetails(codOrigine, trainNumber, dataPartenza) {
    try {
      const res = await fetch(`${API_BASE}/treno/${codOrigine}/${trainNumber}/${dataPartenza}/`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || !data.numeroTreno) return null;

      const category = (data.compTipologiaTreno || data.categoria || '').trim();
      let typeKey = 'REG';
      if (category.includes('FR') || (data.categoria || '').includes('FR')) typeKey = 'FR';
      else if ((data.categoria || '').includes('FA')) typeKey = 'FA';
      else if ((data.categoria || '').includes('FB')) typeKey = 'FB';
      else if ((data.categoria || '').includes('IC')) typeKey = 'IC';
      else if ((data.categoria || '').includes('RV')) typeKey = 'RV';
      else if ((data.categoria || '').includes('REG')) typeKey = 'REG';

      const fermate = data.fermate || [];
      const prima = fermate[0] || {};
      const ultima = fermate[fermate.length - 1] || {};

      const delay = data.ritardo || 0;
      const originName = Api.formatStationName(prima.stazione || data.origine || '');
      const destName = Api.formatStationName(ultima.stazione || data.destinazione || '');

      const depTime = prima.programmata ? new Date(prima.programmata).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
      const arrTime = ultima.programmata ? new Date(ultima.programmata).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';

      let status = 'in_viaggio';
      let statusLabel = 'In viaggio';
      if (data.nonPartito) { status = 'non_partito'; statusLabel = 'Non partito'; }
      else if (data.arrivato) { status = 'arrivato'; statusLabel = 'Arrivato'; }
      else if (data.inStazione) { status = 'in_stazione'; statusLabel = 'In stazione'; }

      const binario = prima.binarioEffettivoPartenzaDescrizione
        || prima.binarioProgrammatoPartenzaDescrizione || null;

      const trainLabel = (data.compNumeroTreno || '').trim() || `${(data.categoria || 'REG').trim()} ${data.numeroTreno}`;

      // Calcolo fermate mancanti ultra-robusto
      let missingStops = 0;
      if (data.fermate && data.fermate.length > 0) {
        // Pulizia e normalizzazione del rilevamento attuale
        const lastDetection = (data.stazioneUltimoRilevamento || '').trim().toUpperCase();
        let lastStopIndex = -1;

        for (let i = 0; i < data.fermate.length; i++) {
          const f = data.fermate[i];
          const stationName = (f.stazione || '').trim().toUpperCase();

          // 1. Controllo orario reale (qualsiasi campo valido > 0)
          const hasActualTime = (f.effettivo && f.effettivo > 0) || 
                                (f.partenza_effettiva && f.partenza_effettiva > 0) || 
                                (f.arrivo_effettivo && f.arrivo_effettivo > 0) ||
                                (f.arrivoReale && f.arrivoReale > 0) ||
                                (f.partenzaReale && f.partenzaReale > 0);

          // 2. Controllo corrispondenza nome stazione (anche parziale)
          const isAtThisStation = lastDetection && (stationName === lastDetection || stationName.includes(lastDetection) || lastDetection.includes(stationName));

          if (isAtThisStation || hasActualTime) {
            // Se siamo qui o ci siamo già passati, aggiorna l'ultimo indice raggiunto
            lastStopIndex = i;
          }
        }
        
        // Le fermate mancanti sono quelle dopo l'ultima raggiunta
        // Se lastStopIndex è -1 (non trovato nulla), missingStops sarà il totale - 1
        missingStops = Math.max(0, data.fermate.length - 1 - lastStopIndex);
      }

      return {
        id: `${data.numeroTreno}-${codOrigine}-${dataPartenza}`,
        trainNumber: data.numeroTreno,
        type: typeKey,
        number: trainLabel,
        from: originName,
        to: destName,
        departure: depTime,
        plannedArrival: arrTime || '--:--',
        currentDelay: delay,
        status,
        statusLabel,
        binario,
        missingStops,
        isLive: data.circolante === true,
        codOrigine: codOrigine,
        dataPartenza: dataPartenza,
        raw: data,
      };
    } catch (err) {
      console.error('[API] Errore dettagli treno:', err);
      return null;
    }
  },

  // Transform Viaggiatreno JSON into our format
  transformTrain(raw, stationCode, direction) {
    const delay = raw.ritardo || 0;
    const trainLabel = (raw.compNumeroTreno || '').trim();
    const category = (raw.categoriaDescrizione || raw.categoria || '').trim();
    const departureTime = raw.compOrarioPartenza || '';
    const arrivalTime = raw.compOrarioArrivo || '';
    const destination = Api.formatStationName(raw.destinazione || '');
    const origin = raw.codOrigine === stationCode
      ? Api.getStationName(stationCode)
      : Api.formatStationName(raw.origine || Api.getStationName(raw.codOrigine));

    // Determine train type key - Robust detection
    let typeKey = 'REG';
    const cat = category.toUpperCase();
    if (cat.includes('FR') || cat.includes('FRECCIA')) typeKey = 'FR';
    else if (cat.includes('FA') || cat.includes('FRECCIA')) typeKey = 'FR'; // FA/FB are also high speed
    else if (cat.includes('FB')) typeKey = 'FR';
    else if (cat.includes('IC') || cat.includes('INTERCITY')) typeKey = 'IC';
    else if (cat.includes('RV') || cat.includes('VELOCE')) typeKey = 'RV';
    else if (cat.includes('REG') || cat.includes('REGIONALE')) typeKey = 'REG';

    // Status
    let status = 'in_viaggio';
    let statusLabel = 'In viaggio';
    if (raw.nonPartito) {
      status = 'non_partito';
      statusLabel = 'Non partito';
    } else if (raw.arrivato) {
      status = 'arrivato';
      statusLabel = 'Arrivato';
    } else if (raw.inStazione) {
      status = 'in_stazione';
      statusLabel = 'In stazione';
    }

    // Track/platform
    const binario = raw.binarioEffettivoPartenzaDescrizione
      || raw.binarioProgrammatoPartenzaDescrizione
      || raw.binarioEffettivoArrivoDescrizione
      || raw.binarioProgrammatoArrivoDescrizione
      || null;

    // Is the train circulating?
    const isLive = raw.circolante === true;

    // Hot if delay > 10
    const isHot = delay > 10;

    const dataPartenza = raw.millisDataPartenza || raw.dataPartenzaTreno;

    return {
      id: `${raw.numeroTreno}-${raw.codOrigine || stationCode}-${dataPartenza}`,
      trainNumber: raw.numeroTreno,
      type: typeKey,
      number: trainLabel || `${category} ${raw.numeroTreno}`,
      from: direction === 'partenza' ? Api.getStationName(stationCode) : (origin || 'Origine'),
      to: destination || 'Destinazione',
      departure: departureTime,
      plannedArrival: arrivalTime || '--:--',
      currentDelay: delay,
      status,
      statusLabel,
      binario,
      isLive,
      codOrigine: raw.codOrigine || stationCode,
      dataPartenza: dataPartenza,
      missingStops: null,
      raw, // keep raw for debugging
    };
  },

  // Format station name (ROMA TERMINI -> Roma Termini)
  formatStationName(name) {
    if (!name) return '';
    return name.split(' ').map(w =>
      w.length <= 2 ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    ).join(' ');
  },

  // Get station name from code
  getStationName(code) {
    if (!code) return '';
    const entry = Object.entries(TrainData.STATIONS_MAP).find(([, c]) => c === code);
    return entry ? entry[0] : code;
  },
};

window.Api = Api;
