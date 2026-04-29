// ============================================================
// Treni Live — Configurazione Firebase (Compat SDK)
// ============================================================

(async () => {
  try {
    // Recupera la configurazione dal backend invece di averla hardcoded
    // Questo protegge la chiave API dall'essere salvata su GitHub
    const response = await fetch('/api/firebase-config/');
    if (!response.ok) throw new Error("Errore nel recupero della config");
    
    const firebaseConfig = await response.json();

    // Initialize Firebase
    firebase.initializeApp(firebaseConfig);

    // Initialize Services
    const auth = firebase.auth();
    const db = firebase.firestore();

    window.FirebaseApp = {
      auth,
      db
    };
    
    console.log("Firebase inizializzato correttamente dal backend.");
  } catch (error) {
    console.error("Errore nel caricamento della configurazione Firebase:", error);
  }
})();
