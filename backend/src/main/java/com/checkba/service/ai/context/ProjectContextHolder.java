package com.checkba.service.ai.context;

/**
 * Holds the current Project ID for the request to support dynamic RAG.
 */
public class ProjectContextHolder {
    private static final ThreadLocal<String> PROJECT_ID = new ThreadLocal<>();

    public static void setProjectId(String projectId) {
        PROJECT_ID.set(projectId);
    }

    public static String getProjectId() {
        return PROJECT_ID.get();
    }

    public static void clear() {
        PROJECT_ID.remove();
    }
}

