// ============================================================
// Treni Live — Data & Configuration
// Codici stazione reali
// ============================================================

const TRAIN_TYPES = {
  FR: { name: 'Frecciarossa', color: '#D71E1E', icon: '🔴' },
  FA: { name: 'Frecciargento', color: '#8C8C8C', icon: '⚪' },
  FB: { name: 'Frecciabianca', color: '#555555', icon: '⬜' },
  ITA: { name: 'Italo', color: '#8B0028', icon: '🟤' },
  IC: { name: 'InterCity', color: '#003580', icon: '🔵' },
  REG: { name: 'Regionale', color: '#006633', icon: '🟢' },
  RV: { name: 'Regionale Veloce', color: '#009966', icon: '🟩' },
};

// Mappa stazioni principali italiane con codici Viaggiatreno reali
const STATIONS_MAP = {
  'Roma Termini': 'S08409',
  'Milano Centrale': 'S01700',
  'Napoli Centrale': 'S09218',
  'Torino Porta Nuova': 'S00219',
  'Firenze SMN': 'S06003',
  'Bologna Centrale': 'S05043',
  'Venezia Santa Lucia': 'S02593',
  'Genova Piazza Principe': 'S01460',
  'Verona Porta Nuova': 'S04100',
  'Padova': 'S04001',
  'Bari Centrale': 'S11781',
  'Palermo Centrale': 'S13001',
  'Pisa Centrale': 'S06100',
  'Roma Tiburtina': 'S08217',
  'Milano Rogoredo': 'S01824',
  'Salerno': 'S09823',
  'Reggio Emilia AV': 'S05418',
  'Brescia': 'S01900',
  'Trieste Centrale': 'S04500',
  'Lecce': 'S12108',
};

const DEFAULT_STATION = 'Roma Termini';

// ---- FILTRI ----
const FILTER_OPTIONS = [
  { id: 'hot', label: ' Con puntate' },
  { id: 'delayed', label: 'Solo ritardi' },
  { id: 'ontime', label: 'Solo puntuali' },
  { id: 'longdist', label: 'Alta Velocità' },
  { id: 'regional', label: 'Regionali' },
  { id: 'departed', label: 'Già partiti' },
  { id: 'not-departed', label: 'Non ancora partiti' },
];

// ---- ONBOARDING ----
const ONBOARDING_STEPS = [
  {
    title: 'Benvenuto su TreniBet!',
    text: 'La prima piattaforma dove puoi scommettere sui ritardi dei treni italiani in tempo reale.',
  },
  {
    title: 'Scegli il tuo Treno ',
    text: "Cerca il tuo treno e piazza la tua puntata sui minuti di ritardo all'arrivo.",
  },
  {
    title: 'Vinci in Diretta',
    text: 'Se indovini il ritardo entro il 5% del valore reale, vinci la scommessa!',
  },
  {
    title: 'Accedi ogni giorno',
    text: 'Ricorda di accedere ogni giorno per ricevere il bonus giornaliero.',
  },
];

// Export
window.TrainData = {
  TRAIN_TYPES,
  STATIONS_MAP,
  DEFAULT_STATION,
  FILTER_OPTIONS,
  ONBOARDING_STEPS,
};
