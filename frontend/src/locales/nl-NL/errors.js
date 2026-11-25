// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// User-facing error catalogue (POLISH X7). Each message = what happened + what to do.
export default {
  "offline": "Je bent offline, dus het verzoek is niet verzonden. Controleer je verbinding en kies dan “Opnieuw proberen”.",
  "timeout": "De service deed er te lang over om te reageren. Probeer het zo meteen opnieuw; splits grote bestanden op in kleinere delen.",
  "localServiceDown": "De lokale service is niet gereed of is gestopt. Wacht een paar seconden; blijft dit gebeuren, start dan AI WorkDeck opnieuw.",
  "signInRequired": "Voor deze functie is een AI WorkDeck-account nodig. Log in en je komt meteen hier terug.",
  "sessionExpired": "Je sessie is verlopen. Log opnieuw in; niet-opgeslagen werk blijft bewaard.",
  "forbidden": "Je hebt hiervoor geen toestemming. Vraag toegang aan de verantwoordelijke van de zaak of de beheerder van je kantoor.",
  "balanceLow": "Je AI-tegoed is op; dit verzoek is niet in rekening gebracht. Waardeer het op via Instellingen → Account & saldo.",
  "rateLimited": "Er zijn op dit moment te veel verzoeken, dus de modelservice vertraagt. Wacht een minuut en probeer het opnieuw.",
  "modelUnavailable": "Het gekozen model is momenteel niet beschikbaar. Probeer het later opnieuw of kies onder het berichtvak een ander model.",
  "modelKeyInvalid": "De modelaanbieder heeft de sleutel geweigerd die dit apparaat nog gebruikt uit een oudere instelling. Log in om in plaats daarvan de AI van AI WorkDeck te gebruiken.",
  "streamInterrupted": "Het antwoord is afgebroken; wat tot nu toe binnenkwam blijft hierboven staan. Kies “Opnieuw proberen” om het opnieuw te genereren.",
  "serverError": "Er ging iets mis aan onze kant en deze actie is niet afgerond. Probeer het later opnieuw; blijft het gebeuren, stuur ons dan “Meldingen”.",
  "conflict": "Dit is elders gewijzigd, of de vorige actie loopt nog. Vernieuw en probeer het opnieuw.",
  "fileTooLarge": "Het bestand is te groot (limiet {limit}). Comprimeer of splits het en upload het opnieuw.",
  "fileUnreadable": "Dit bestand kan niet worden geopend; het is mogelijk beschadigd of met een wachtwoord beveiligd. Sla een nieuw exemplaar op vanuit de oorspronkelijke app en probeer het opnieuw.",
  "notFound": "Dit item is niet gevonden; het is mogelijk verplaatst of verwijderd. Vernieuw de lijst.",
  "marketplaceUnavailable": "De Plugin-marktplaats is nu niet bereikbaar; geïnstalleerde plugins blijven werken. Controleer je verbinding en kies dan “Vernieuwen”.",
  "pluginInstallFailed": "“{name}” kon niet worden geïnstalleerd; er is verder niets gewijzigd. Probeer het later opnieuw; mislukt het nog steeds, stuur dan feedback met de details.",
  "unknown": "Dat is niet gelukt. Probeer het opnieuw; blijft het gebeuren, stuur dan feedback met de details.",
  "actions": {
    "retry": "Opnieuw proberen",
    "details": "Details",
    "continue": "Doorgaan",
    "refresh": "Vernieuwen",
    "signIn": "Inloggen",
    "feedback": "Meldingen"
  }
}
