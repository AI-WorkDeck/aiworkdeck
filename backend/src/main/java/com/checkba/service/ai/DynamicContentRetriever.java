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

