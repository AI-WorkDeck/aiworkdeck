// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// User-facing error catalogue (POLISH X7). Each message = what happened + what to do.
export default {
  "offline": "No tienes conexión, así que la solicitud no se envió. Revisa tu conexión y pulsa «Reintentar».",
  "timeout": "El servicio tardó demasiado en responder. Inténtalo de nuevo en un momento; si el archivo es grande, divídelo en partes más pequeñas.",
  "localServiceDown": "El servicio local no está listo o se ha detenido. Espera unos segundos; si sigue ocurriendo, reinicia AI WorkDeck.",
  "signInRequired": "Esta función requiere una cuenta de AI WorkDeck. Inicia sesión y volverás aquí al instante.",
  "sessionExpired": "Tu sesión ha caducado. Inicia sesión de nuevo; el trabajo sin guardar se conserva.",
  "forbidden": "No tienes permiso para hacer esto. Pide acceso al responsable del asunto o al administrador de tu despacho.",
  "balanceLow": "Se ha agotado tu crédito de IA; esta solicitud no se ha cobrado. Recárgalo en Ajustes → Cuenta y saldo.",
  "rateLimited": "Hay demasiadas solicitudes ahora mismo y el servicio de modelos las está limitando. Espera un minuto e inténtalo de nuevo.",
  "modelUnavailable": "El modelo seleccionado no está disponible ahora. Inténtalo más tarde o elige otro modelo debajo del cuadro de mensaje.",
  "modelKeyInvalid": "El proveedor del modelo rechazó la clave que este dispositivo sigue usando de una configuración anterior. Inicia sesión para usar en su lugar la IA de AI WorkDeck.",
  "streamInterrupted": "La respuesta se interrumpió; lo recibido hasta ahora se conserva arriba. Pulsa «Reintentar» para generarla de nuevo.",
  "streamInterruptedResumable": "La respuesta se interrumpió; lo recibido hasta ahora se conserva arriba. Pulsa «Continuar» para retomarla donde se detuvo o «Reintentar» para empezar de nuevo.",
  "streamInterruptedTwice": "Se interrumpió de nuevo. Pulsa «Reintentar» para generar la respuesta completa otra vez.",
  "serverError": "Algo falló por nuestra parte y la acción no terminó. Inténtalo más tarde; si sigue ocurriendo, envíanos «Comentarios».",
  "conflict": "Esto se cambió en otro sitio o la acción anterior sigue en curso. Actualiza e inténtalo de nuevo.",
  "fileTooLarge": "El archivo es demasiado grande (límite: {limit}). Comprímelo o divídelo y vuelve a subirlo.",
  "fileUnreadable": "No se puede abrir este archivo; puede estar dañado o protegido con contraseña. Guarda una copia nueva desde la aplicación original e inténtalo de nuevo.",
  "notFound": "No encontramos este elemento; puede que se haya movido o eliminado. Actualiza la lista.",
  "marketplaceUnavailable": "No se puede acceder ahora al Mercado de plugins; los plugins instalados siguen funcionando. Revisa tu conexión y pulsa «Actualizar».",
  "pluginInstallFailed": "No se pudo instalar «{name}»; no se cambió nada más. Inténtalo más tarde; si sigue fallando, envía comentarios con los detalles.",
  "unknown": "No ha funcionado. Inténtalo de nuevo; si sigue ocurriendo, envía comentarios con los detalles.",
  "actions": {
    "retry": "Reintentar",
    "details": "Detalles",
    "hideDetails": "Ocultar detalles",
    "continue": "Continuar",
    "continueTooltip": "Retoma donde se detuvo sin volver a generar lo que ya está",
    "refresh": "Actualizar",
    "signIn": "Iniciar sesión",
    "feedback": "Comentarios"
  }
}
