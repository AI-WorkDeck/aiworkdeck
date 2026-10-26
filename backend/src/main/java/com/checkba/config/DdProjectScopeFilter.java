// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.config;

import com.checkba.repository.*;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.IOException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.regex.Pattern;

/** A desktop proxy must not use its connection owner's token to reach another case. */
@Component
public class DdProjectScopeFilter extends OncePerRequestFilter implements Ordered {
    private static final Pattern RESOURCE = Pattern.compile("^/(projects|requests|items|notifications|jobs)/([^/]+)(?:/.*)?$");
    private final DdRequestRepository requests;
    private final DdItemRepository items;
    private final DdNotificationRepository notifications;
    private final DdAiJobRepository jobs;
    private final boolean localMode;

    public DdProjectScopeFilter(DdRequestRepository requests, DdItemRepository items,
            DdNotificationRepository notifications, DdAiJobRepository jobs,
            @Value("${security.local-mode:false}") boolean localMode) {
        this.requests = requests; this.items = items; this.notifications = notifications;
        this.jobs = jobs; this.localMode = localMode;
    }

    @Override public int getOrder() { return Ordered.LOWEST_PRECEDENCE - 9; }

    @Override protected boolean shouldNotFilter(HttpServletRequest request) {
        return localMode || !path(request).startsWith("/api/dd/");
    }

    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain chain) throws IOException, ServletException {
        // Never use getParameter: it consumes multipart bodies before the upload controller.
        Long scope;
        try {
            List<String[]> values = DdCloudProxyFilter.parseQuery(request.getQueryString()).stream()
                    .filter(entry -> "projectId".equals(entry[0])).toList();
            if (values.isEmpty()) { chain.doFilter(request, response); return; }
            if (values.size() != 1) throw new IllegalArgumentException();
            scope = Long.valueOf(URLDecoder.decode(values.get(0)[1], StandardCharsets.UTF_8));
            if (scope <= 0) throw new IllegalArgumentException();
        } catch (IllegalArgumentException error) {
            reject(response, 400); return;
        }
        String suffix = path(request).substring("/api/dd".length());
        Long actual = "/notifications".equals(suffix) ? scope : resourceProject(suffix);
        if (!scope.equals(actual)) { reject(response, 403); return; }
        // Identity and project role remain mandatory in the controller.
        chain.doFilter(request, response);
    }

    private Long resourceProject(String suffix) {
        var match = RESOURCE.matcher(suffix);
        if (!match.matches()) return null;
        String id = match.group(2);
        if ("jobs".equals(match.group(1))) return jobs.findById(id).map(job -> job.getProjectId()).orElse(null);
        try {
            Long number = Long.valueOf(id);
            return switch (match.group(1)) {
                case "projects" -> number;
                case "requests" -> requests.findById(number).map(row -> row.getProjectId()).orElse(null);
                case "items" -> items.findById(number).flatMap(item -> requests.findById(item.getDdRequestId()))
                        .map(row -> row.getProjectId()).orElse(null);
                case "notifications" -> notifications.findById(number).map(row -> row.getProjectId()).orElse(null);
                default -> null;
            };
        } catch (NumberFormatException error) { return null; }
    }

    private static String path(HttpServletRequest request) {
        return request.getRequestURI().substring(request.getContextPath().length());
    }

    private static void reject(HttpServletResponse response, int status) throws IOException {
        response.setStatus(status);
        response.setHeader(SourceCodeNoticeFilter.HEADER, SourceCodeNoticeFilter.SOURCE_URL);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write("{\"code\":" + status + ",\"message\":\""
                + com.checkba.service.LangText.of("无权访问该项目的资料", "You do not have permission to access materials in this project")
                + "\"}");
    }
}
