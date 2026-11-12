// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller;

import com.checkba.model.entity.DdItem;
import com.checkba.model.entity.DdRequest;
import com.checkba.model.entity.DdSubmission;
import com.checkba.repository.DdItemRepository;
import com.checkba.repository.DdSubmissionRepository;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.DdService;
import com.checkba.service.DdWorkflowService;
import com.checkba.service.DocumentTextService;
import com.checkba.service.ProjectFileAccessService;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.dd.DdAiService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;
import org.mockito.Mockito;
import org.mockito.invocation.Invocation;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Parameter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.when;

/**
 * 尽调写端点的客户分类，按反射穷举 {@link DdController} 与 {@link DdAiController} 的全部写路由
 * （POST/PUT/PATCH/DELETE），不再手写一份会过期的端点清单。
 *
 * <p>每条写路由必须二选一：要么在 {@link #CLIENT_WRITE_ROUTES} 里点名（客户本来就该能做的：
 * 传自己的材料、留言、说明/申诉、标记自己的通知已读、核验自己的提交），要么以客户身份调用时
 * 在碰到业务层之前被角色闸拒绝（DdController 回 {@code ClientForbiddenException}，
 * DdAiController 回 403）。新加一条写路由而没归类、又忘了加角色闸，本测试就会红。
 */
class DdClientRouteClassificationTest {

    /** 客户允许调用的写路由（控制器简单类名.方法名）。新增条目前先确认业务层自己会校验归属。 */
    static final Set<String> CLIENT_WRITE_ROUTES = Set.of(
            "DdController.uploadFile",          // 旧版单文件上传（自己的清单项）
            "DdController.submit",              // 版本化提交材料
            "DdController.explain",             // 无法提供/不适用说明
            "DdController.appeal",              // 对驳回申诉
            "DdController.addComment",          // 留言
            "DdController.markNotificationRead", // 标记自己的通知已读
            "DdAiController.verify");           // 只能核验自己提交的材料（下方单测钉住）

    /** 被拒路由允许发生的业务层调用：只有「这个 id 属于哪个项目」这一类定位读。 */
    private static final Set<String> LOOKUP_ONLY = Set.of(
            "getProjectIdByRequestId", "getProjectIdByItemId", "getRequest", "findById");

    private static final long PROJECT = 42L;
    private static final long REQUEST = 99L;
    private static final long ITEM = 7L;
    private static final long CLIENT = 3L;
    private static final long OTHER = 4L;
    private static final long SUBMISSION = 11L;

    private DdService ddService;
    private DdWorkflowService workflow;
    private ProjectMemberService pms;
    private ProjectFileAccessService fileAccess;
    private DdAiService ai;
    private DdItemRepository items;
    private DdSubmissionRepository submissions;
    private ProjectFileRepository files;
    private DocumentTextService documents;
    private DdController dd;
    private DdAiController ddAi;
    private MockedStatic<AuthController> auth;

    @BeforeEach
    void setUp() {
        ddService = mock(DdService.class);
        workflow = mock(DdWorkflowService.class);
        pms = mock(ProjectMemberService.class);
        fileAccess = mock(ProjectFileAccessService.class);
        ai = mock(DdAiService.class);
        items = mock(DdItemRepository.class);
        submissions = mock(DdSubmissionRepository.class);
        files = mock(ProjectFileRepository.class);
        documents = mock(DocumentTextService.class);
        dd = new DdController(ddService, workflow, pms, fileAccess);
        ddAi = new DdAiController(ai, ddService, workflow, items, submissions, files, pms, fileAccess, documents);

        when(ddService.getProjectIdByRequestId(REQUEST)).thenReturn(PROJECT);
        when(ddService.getProjectIdByItemId(ITEM)).thenReturn(PROJECT);
        DdRequest request = new DdRequest();
        request.setProjectId(PROJECT);
        request.setStatus("PUBLISHED");
        when(ddService.getRequest(REQUEST)).thenReturn(request);
        DdItem item = new DdItem();
        item.setDdRequestId(REQUEST);
        when(items.findById(ITEM)).thenReturn(Optional.of(item));
        // CLIENT 是项目成员（能读），但角色是客户；hasWritePermission 刻意给 true，
        // 证明拦住客户的是角色闸本身，而不是「恰好没有写权限」。
        when(pms.hasReadPermission(PROJECT, CLIENT)).thenReturn(true);
        when(pms.hasWritePermission(PROJECT, CLIENT)).thenReturn(true);
        when(fileAccess.isClient(PROJECT, CLIENT)).thenReturn(true);
        auth = mockStatic(AuthController.class);
        auth.when(() -> AuthController.getUserIdFromSession("c")).thenReturn(CLIENT);
    }

    @AfterEach
    void tearDown() {
        auth.close();
    }

    private static boolean isWriteRoute(Method m) {
        RequestMapping mapping = AnnotatedElementUtils.findMergedAnnotation(m, RequestMapping.class);
        if (mapping == null) return false;
        RequestMethod[] methods = mapping.method();
        if (methods.length == 0) return true; // 不限方法 = 也接写请求
        return Arrays.stream(methods).anyMatch(rm ->
                rm != RequestMethod.GET && rm != RequestMethod.HEAD && rm != RequestMethod.OPTIONS);
    }

    private static List<Method> writeRoutes(Class<?> controller) {
        List<Method> out = new ArrayList<>();
        for (Method m : controller.getDeclaredMethods()) {
            if (isWriteRoute(m)) out.add(m);
        }
        return out;
    }

    private static String routeName(Method m) {
        return m.getDeclaringClass().getSimpleName() + "." + m.getName();
    }

    private static Object argFor(Parameter p) throws Exception {
        Class<?> t = p.getType();
        if (t == String.class) return p.isAnnotationPresent(RequestHeader.class) ? "c" : "x";
        if (t == Long.class || t == long.class) {
            String name = p.getName();
            PathVariable pv = p.getAnnotation(PathVariable.class);
            if (pv != null && !pv.value().isEmpty()) name = pv.value();
            RequestParam rp = p.getAnnotation(RequestParam.class);
            if (rp != null && !rp.value().isEmpty()) name = rp.value();
            return switch (name) {
                case "projectId" -> PROJECT;
                case "requestId" -> REQUEST;
                case "itemId" -> ITEM;
                case "submissionId" -> SUBMISSION;
                default -> 1L;
            };
        }
        if (t == boolean.class || t == Boolean.class) return false;
        if (MultipartFile.class.isAssignableFrom(t)) {
            return new MockMultipartFile("file", "a.pdf", "application/pdf", new byte[]{1});
        }
        if (List.class.isAssignableFrom(t)) return List.of();
        if (Map.class.isAssignableFrom(t)) return Map.of("submissionId", SUBMISSION);
        Constructor<?> ctor = t.getDeclaredConstructor();
        ctor.setAccessible(true);
        return ctor.newInstance();
    }

    /** 以客户身份调一次，回抛出的异常（没抛就回 null）。 */
    private Throwable callAsClient(Object controller, Method m) throws Exception {
        Object[] args = new Object[m.getParameterCount()];
        Parameter[] params = m.getParameters();
        for (int i = 0; i < params.length; i++) args[i] = argFor(params[i]);
        m.setAccessible(true);
        try {
            m.invoke(controller, args);
            return null;
        } catch (InvocationTargetException e) {
            return e.getCause();
        }
    }

    private static boolean isClientDenial(Throwable t) {
        if (t instanceof DdController.ClientForbiddenException) return true;
        return t instanceof ResponseStatusException rse && rse.getStatusCode() == HttpStatus.FORBIDDEN;
    }

    private Object controllerFor(Method m) {
        return m.getDeclaringClass() == DdController.class ? dd : ddAi;
    }

    private List<Method> allWriteRoutes() {
        List<Method> all = new ArrayList<>(writeRoutes(DdController.class));
        all.addAll(writeRoutes(DdAiController.class));
        return all;
    }

    @Test
    @DisplayName("白名单里每一条都还存在（改名/删除后要同步清单）")
    void allowListHasNoStaleEntries() {
        Set<String> existing = new TreeSet<>();
        for (Method m : allWriteRoutes()) existing.add(routeName(m));
        for (String allowed : CLIENT_WRITE_ROUTES) {
            assertTrue(existing.contains(allowed), "白名单条目已不存在: " + allowed + "；现有写路由: " + existing);
        }
    }

    @Test
    @DisplayName("白名单之外的每条写路由，客户调用都在业务层之前被角色闸拒绝")
    void everyUnlistedWriteRouteDeniesClient() throws Exception {
        List<String> failures = new ArrayList<>();
        int checked = 0;
        for (Method m : allWriteRoutes()) {
            if (CLIENT_WRITE_ROUTES.contains(routeName(m))) continue;
            checked++;
            Mockito.clearInvocations(ddService, workflow, ai, items, submissions, files, documents);
            Throwable t = callAsClient(controllerFor(m), m);
            if (!isClientDenial(t)) {
                failures.add(routeName(m) + " 未对客户 403（结果: " + t + "）——要么加角色闸，要么归入 CLIENT_WRITE_ROUTES");
                continue;
            }
            for (Object business : List.of(ddService, workflow, ai, items, submissions, files, documents)) {
                for (Invocation inv : Mockito.mockingDetails(business).getInvocations()) {
                    if (!LOOKUP_ONLY.contains(inv.getMethod().getName())) {
                        failures.add(routeName(m) + " 拒绝前已调到业务层: " + inv);
                    }
                }
            }
        }
        // DdController 13 条 + DdAiController 2 条（import/example）：防止反射漏扫后「空过」
        assertTrue(checked >= 15, "只扫到 " + checked + " 条应拒绝的写路由");
        if (!failures.isEmpty()) fail(String.join("\n", failures));
    }

    @Test
    @DisplayName("白名单内的写路由，客户不被角色闸挡住")
    void listedRoutesAreReachableByClient() throws Exception {
        DdSubmission own = new DdSubmission();
        own.setId(SUBMISSION);
        own.setItemId(ITEM);
        own.setSubmittedBy(CLIENT);
        when(submissions.findById(SUBMISSION)).thenReturn(Optional.of(own));
        for (Method m : allWriteRoutes()) {
            if (!CLIENT_WRITE_ROUTES.contains(routeName(m))) continue;
            Throwable t = callAsClient(controllerFor(m), m);
            assertFalse(isClientDenial(t), routeName(m) + " 是客户白名单路由却被拒: " + t);
        }
    }

    @Test
    @DisplayName("AI 核验：客户只能核验自己提交的材料")
    void clientVerifiesOnlyOwnSubmission() {
        DdSubmission others = new DdSubmission();
        others.setId(SUBMISSION);
        others.setItemId(ITEM);
        others.setSubmittedBy(OTHER);
        when(submissions.findById(SUBMISSION)).thenReturn(Optional.of(others));
        ResponseStatusException e = org.junit.jupiter.api.Assertions.assertThrows(ResponseStatusException.class,
                () -> ddAi.verify(ITEM, "c", Map.of("submissionId", SUBMISSION)));
        assertEquals(HttpStatus.FORBIDDEN, e.getStatusCode());
        Mockito.verifyNoInteractions(ai);
    }
}
