// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// User-facing error catalogue (POLISH X7). Each message = what happened + what to do.
export default {
  "offline": "Vous êtes hors ligne, la requête n’a donc pas été envoyée. Vérifiez votre connexion, puis sélectionnez « Réessayer ».",
  "timeout": "Le service a mis trop de temps à répondre. Réessayez dans un instant ; pour les fichiers volumineux, découpez-les en parties plus petites.",
  "localServiceDown": "Le service local n’est pas prêt ou s’est arrêté. Patientez quelques secondes ; si cela continue, redémarrez AI WorkDeck.",
  "signInRequired": "Cette fonction nécessite un compte AI WorkDeck. Connectez-vous et vous reviendrez directement ici.",
  "sessionExpired": "Votre session a expiré. Reconnectez-vous ; le travail non enregistré est conservé.",
  "forbidden": "Vous n’avez pas l’autorisation d’effectuer cette action. Demandez l’accès au responsable du dossier ou à l’administrateur de votre cabinet.",
  "balanceLow": "Votre crédit IA est épuisé ; cette requête n’a pas été facturée. Rechargez-le dans Paramètres → Compte et solde.",
  "rateLimited": "Trop de requêtes en ce moment : le service de modèles limite le débit. Attendez une minute, puis réessayez.",
  "modelUnavailable": "Le modèle sélectionné n’est pas disponible pour le moment. Réessayez plus tard ou choisissez un autre modèle sous la zone de message.",
  "modelKeyInvalid": "Le fournisseur du modèle a rejeté la clé que cet appareil utilise encore depuis une ancienne configuration. Connectez-vous pour utiliser à la place l’IA d’AI WorkDeck.",
  "accountReconnect": "La connexion à votre compte IA doit être actualisée, cette demande n'a donc pas été envoyée. Sélectionnez « Se reconnecter », puis réessayez ; rien n'est perdu.",
  "streamInterrupted": "La réponse a été interrompue ; ce qui est déjà arrivé est conservé ci-dessus. Sélectionnez « Réessayer » pour la générer à nouveau.",
  "serverError": "Un problème est survenu de notre côté et l’action n’a pas abouti. Réessayez plus tard ; si cela continue, envoyez-nous un retour via « Commentaires ».",
  "conflict": "Cet élément a été modifié ailleurs, ou l’action précédente est toujours en cours. Actualisez, puis réessayez.",
  "fileTooLarge": "Le fichier est trop volumineux (limite : {limit}). Compressez-le ou découpez-le, puis importez-le à nouveau.",
  "fileUnreadable": "Ce fichier ne peut pas être ouvert ; il est peut-être endommagé ou protégé par un mot de passe. Enregistrez une nouvelle copie depuis l’application d’origine, puis réessayez.",
  "notFound": "Cet élément est introuvable ; il a peut-être été déplacé ou supprimé. Actualisez la liste.",
  "marketplaceUnavailable": "Le Marché de plugins est inaccessible pour le moment ; les plugins installés continuent de fonctionner. Vérifiez votre connexion, puis sélectionnez « Actualiser ».",
  "pluginInstallFailed": "Impossible d’installer « {name} » ; rien d’autre n’a été modifié. Réessayez plus tard ; si cela échoue encore, envoyez un retour avec les détails.",
  "unknown": "Cela n’a pas fonctionné. Réessayez ; si cela continue, envoyez un retour avec les détails.",
  "actions": {
    "retry": "Réessayer",
    "details": "Détails",
    "hideDetails": "Masquer les détails",
    "continue": "Continuer",
    "refresh": "Actualiser",
    "signIn": "Se connecter",
    "reconnect": "Se reconnecter",
    "feedback": "Commentaires"
  }
}
