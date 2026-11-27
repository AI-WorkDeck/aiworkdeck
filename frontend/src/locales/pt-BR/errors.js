// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// User-facing error catalogue (POLISH X7). Each message = what happened + what to do.
export default {
  "offline": "Você está offline, então a solicitação não foi enviada. Verifique sua conexão e selecione “Tentar novamente”.",
  "timeout": "O serviço demorou demais para responder. Tente novamente em instantes; para arquivos grandes, divida-os em partes menores.",
  "localServiceDown": "O serviço local não está pronto ou foi interrompido. Aguarde alguns segundos; se continuar, reinicie o AI WorkDeck.",
  "signInRequired": "Este recurso exige uma conta do AI WorkDeck. Entre e você voltará direto para cá.",
  "sessionExpired": "Sua sessão expirou. Entre novamente; o trabalho não salvo é mantido.",
  "forbidden": "Você não tem permissão para fazer isso. Peça acesso ao responsável pelo caso ou ao administrador do escritório.",
  "balanceLow": "Seu crédito de IA acabou; esta solicitação não foi cobrada. Recarregue em Configurações → Conta e saldo.",
  "rateLimited": "Há solicitações demais no momento, e o serviço de modelos está limitando o ritmo. Aguarde um minuto e tente novamente.",
  "modelUnavailable": "O modelo selecionado não está disponível agora. Tente novamente mais tarde ou escolha outro modelo abaixo da caixa de mensagem.",
  "modelKeyInvalid": "O provedor do modelo recusou a chave que este dispositivo ainda usa de uma configuração antiga. Entre para usar a IA do AI WorkDeck no lugar dela.",
  "accountReconnect": "A conexão da sua conta de IA precisa ser atualizada, então esta solicitação não foi enviada. Selecione “Entrar novamente” e tente outra vez; nada é perdido.",
  "streamInterrupted": "A resposta foi interrompida; o que chegou até agora fica mantido acima. Selecione “Tentar novamente” para gerá-la de novo.",
  "streamInterruptedResumable": "A resposta foi interrompida; o que chegou até agora fica mantido acima. Selecione “Continuar” para retomar de onde parou ou “Tentar novamente” para recomeçar.",
  "streamInterruptedTwice": "Ela foi interrompida novamente. Selecione “Tentar novamente” para gerar a resposta inteira de novo.",
  "serverError": "Algo deu errado do nosso lado e a ação não foi concluída. Tente novamente mais tarde; se continuar, envie “Comentários” para nós.",
  "conflict": "Isto foi alterado em outro lugar, ou a ação anterior ainda está em andamento. Atualize e tente novamente.",
  "fileTooLarge": "O arquivo é grande demais (limite de {limit}). Compacte ou divida o arquivo e envie novamente.",
  "fileUnreadable": "Não foi possível abrir este arquivo; ele pode estar danificado ou protegido por senha. Salve uma cópia nova a partir do aplicativo original e tente novamente.",
  "notFound": "Não encontramos este item; ele pode ter sido movido ou excluído. Atualize a lista.",
  "marketplaceUnavailable": "Não foi possível acessar o Marketplace de plugins agora; os plugins instalados continuam funcionando. Verifique sua conexão e selecione “Atualizar”.",
  "pluginInstallFailed": "Não foi possível instalar “{name}”; nada mais foi alterado. Tente novamente mais tarde; se ainda falhar, envie comentários com os detalhes.",
  "unknown": "Não funcionou. Tente novamente; se continuar, envie comentários com os detalhes.",
  "actions": {
    "retry": "Tentar novamente",
    "details": "Detalhes",
    "hideDetails": "Ocultar detalhes",
    "continue": "Continuar",
    "continueTooltip": "Retoma de onde parou sem gerar de novo o que já está lá",
    "refresh": "Atualizar",
    "signIn": "Entrar",
    "reconnect": "Entrar novamente",
    "feedback": "Comentários"
  }
}
