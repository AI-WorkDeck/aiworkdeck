// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "title": "Referências",
  "noDoc": "Nenhum documento aberto",
  "parse": "Verificação online de todo o documento (pode haver cobrança)",
  "reparse": "Repetir verificação online de todo o documento (pode haver cobrança)",
  "onlineHint": "Ao clicar, o documento atual é salvo e a versão salva é verificada online. Consultas de IA e externas podem gerar custos.",
  "saveRequired": "Não foi possível salvar este documento. Salve-o antes de iniciar a verificação online.",
  "running": "Verificando online…",
  "done": "Verificação online concluída",
  "failed": "Falha na verificação online",
  "loading": "Carregando…",
  "loadingDetail": "Buscando detalhes da consulta…",
  "noDetail": "Sem detalhes de consulta para este item",
  "loadFailed": "Não foi possível carregar os resultados da verificação online",
  "parseFailed": "Não foi possível iniciar a verificação online",
  "detailFailed": "Não foi possível carregar os detalhes da consulta",
  "refreshFailed": "Não foi possível repetir a consulta",
  "retry": "Tentar novamente",
  "goConnectAccount": "Conectar conta",
  "goRecharge": "Adicionar créditos",
  "hint": {
    "NO_CREDENTIAL": "Este canal de consulta precisa de credenciais configuradas no servidor pelo administrador."
  },
  "tab": {
    "retrieval": "Consultas externas",
    "checks": "Consistência"
  },
  "kind": {
    "COMPANY": "Empresas",
    "LAW": "Legislação",
    "CASE": "Processos",
    "DOC": "Documentos"
  },
  "entityKind": {
    "COMPANY": "Empresa",
    "LAW": "Lei",
    "CASE": "Processo",
    "DOC": "Documento"
  },
  "openInNewTab": "Abrir em nova aba",
  "openDocFile": "Abrir arquivo",
  "docNotFound": "Arquivo não encontrado neste projeto",
  "docMissing": "Esse arquivo não está mais neste projeto",
  "source": {
    "projectFile": "Arquivo do projeto",
    "qichacha": "Qichacha"
  },
  "mentions": "{count} menção(ões)",
  "mentionsTitle": "Menções neste documento",
  "shareholders": "Sócios e acionistas",
  "moreCandidates": "Outros candidatos",
  "caseSection": {
    "ascertain": "Fatos apurados",
    "reason": "Fundamentação",
    "result": "Dispositivo",
    "gist": "Tese principal",
    "fullText": "Íntegra da decisão"
  },
  "authoritative": "Texto oficial (Pkulaw)",
  "implementDate": "Em vigor desde {date}",
  "recognition": "Reconhecimento do número do processo",
  "openInPkulaw": "Abrir no Pkulaw",
  "citation": {
    "citedText": "Artigo citado",
    "candidates": "Artigos localizados pelo conteúdo",
    "article": "Artigo {n}"
  },
  "severity": {
    "warn": "Questionável",
    "error": "Erro"
  },
  "unifyTo": "Padronizar tudo para {value}",
  "cannotFix": "Não é possível corrigir automaticamente: {reason}",
  "fixNotUnique": "Não foi possível localizar uma ocorrência única — edite manualmente.",
  "fixPartial": "{done} corrigido(s); {failed} sem ocorrência única — edite manualmente.",
  "fixed": "Corrigido",
  "fixedHint": "Pressione Cmd+Z para desfazer; analise novamente para atualizar os resultados.",
  "noEditor": "Ative primeiro uma janela de edição de documento",
  "empty": {
    "noRun": "Este documento ainda não foi verificado online",
    "noRunHint": "As dicas diárias de redação rodam localmente. Somente ao clicar na verificação online o documento salvo é enviado para extração por IA, consultas externas e verificação de consistência.",
    "noEntity": "Nenhuma entidade pesquisável encontrada",
    "noEntityHint": "O documento não menciona nome de empresa, artigo de lei ou número de processo.",
    "noFinding": "Nenhuma inconsistência encontrada",
    "noFindingHint": "As declarações de quantidade e os códigos de crédito social unificado estão consistentes."
  }
}
