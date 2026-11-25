// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// User-facing error catalogue (POLISH X7). Each message = what happened + what to do.
export default {
  "offline": "Sei offline, quindi la richiesta non è stata inviata. Controlla la connessione, poi seleziona «Riprova».",
  "timeout": "Il servizio ha impiegato troppo tempo a rispondere. Riprova tra poco; per i file di grandi dimensioni, suddividili in parti più piccole.",
  "localServiceDown": "Il servizio locale non è pronto o si è fermato. Attendi qualche secondo; se continua, riavvia AI WorkDeck.",
  "signInRequired": "Questa funzione richiede un account AI WorkDeck. Accedi e tornerai subito qui.",
  "sessionExpired": "La tua sessione è scaduta. Accedi di nuovo; il lavoro non salvato viene conservato.",
  "forbidden": "Non hai l’autorizzazione per farlo. Chiedi l’accesso al responsabile della pratica o all’amministratore del tuo studio.",
  "balanceLow": "Il tuo credito AI è esaurito; questa richiesta non è stata addebitata. Ricaricalo in Impostazioni → Account e saldo.",
  "rateLimited": "Troppe richieste in questo momento: il servizio del modello sta limitando il traffico. Attendi un minuto e riprova.",
  "modelUnavailable": "Il modello selezionato non è disponibile al momento. Riprova più tardi oppure scegli un altro modello sotto la casella del messaggio.",
  "modelKeyInvalid": "Il fornitore del modello ha rifiutato la chiave che questo dispositivo usa ancora da una vecchia configurazione. Accedi per usare invece l’AI di AI WorkDeck.",
  "streamInterrupted": "La risposta si è interrotta; quanto ricevuto finora resta qui sopra. Seleziona «Riprova» per generarla di nuovo.",
  "serverError": "Si è verificato un problema da parte nostra e l’azione non è stata completata. Riprova più tardi; se continua, inviaci una segnalazione.",
  "conflict": "L’elemento è stato modificato altrove, oppure l’azione precedente è ancora in corso. Aggiorna e riprova.",
  "fileTooLarge": "Il file è troppo grande (limite {limit}). Comprimilo o dividilo, poi caricalo di nuovo.",
  "fileUnreadable": "Non è possibile aprire questo file; potrebbe essere danneggiato o protetto da password. Salva una nuova copia dall’applicazione originale e riprova.",
  "notFound": "Impossibile trovare questo elemento; potrebbe essere stato spostato o eliminato. Aggiorna l’elenco.",
  "marketplaceUnavailable": "Il Marketplace dei plugin non è raggiungibile al momento; i plugin installati continuano a funzionare. Controlla la connessione, poi seleziona «Aggiorna».",
  "pluginInstallFailed": "Impossibile installare «{name}»; nient’altro è cambiato. Riprova più tardi; se continua a non funzionare, invia una segnalazione con i dettagli.",
  "unknown": "Non ha funzionato. Riprova; se continua, invia una segnalazione con i dettagli.",
  "actions": {
    "retry": "Riprova",
    "details": "Dettagli",
    "hideDetails": "Nascondi dettagli",
    "continue": "Continua",
    "refresh": "Aggiorna",
    "signIn": "Accedi",
    "feedback": "Segnalazioni"
  }
}
