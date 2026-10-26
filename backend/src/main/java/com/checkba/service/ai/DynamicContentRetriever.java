// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.service.ai.context.ProjectContextHolder;
import dev.langchain4j.rag.content.Content;
import dev.langchain4j.rag.content.retriever.ContentRetriever;
import dev.langchain4j.rag.query.Query;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.List;

/**
 * 按项目动态取 RAG 内容的 ContentRetriever。
 *
 * <p>保留显式的项目作用域检索器。原 v1 projectAssistant 已移除，当前工具与 RAG
 * 均由项目代码装配，不依赖 @AiService 扫描。启动优化已将通用 LangChain4j Spring
 * starter 换成核心库；Ollama 的模型自动配置仍保留。若重新引入 RagAutoConfig，
 * 须保留此检索器：本项目有两个 EmbeddingStore，默认检索器无法单凭类型选择。
 */
@Component
@RequiredArgsConstructor
public class DynamicContentRetriever implements ContentRetriever {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(DynamicContentRetriever.class);

    private final ProjectRagService projectRagService;

    @Override
    public List<Content> retrieve(Query query) {
        String projectId = ProjectContextHolder.getProjectId();
        if (projectId != null) {
            log.debug("Retrieving content for project: {} query: {}", projectId, query.text());
            ContentRetriever retriever = projectRagService.getRetrieverForProject(projectId);
            return retriever.retrieve(query);
        }
        log.warn("No project context found, returning empty content");
        return Collections.emptyList();
    }
}

