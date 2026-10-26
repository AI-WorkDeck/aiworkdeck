// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.skill;

import com.checkba.service.AppLanguageService;
import com.checkba.service.SystemSettingService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.lang.Nullable;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 工程内置常驻工作流（懒人模式，dev-board#1431 / #1438）的多版本与项目偏好管理服务。
 *
 * <p>核心职责：
 * <ul>
 *   <li>为 4 个高频内置工作流（合同审查、证据整理、文件整理、法律意见书核查）提供只读兜底的「系统默认版」；</li>
 *   <li>支持用户基于系统默认版创建、编辑、删除多个自定义版本（如「我的个人版」「甲方强势版」），可同时定制快捷填入指令与底层工作流 Prompt；</li>
 *   <li>支持按项目（{@code projectId}）或全局默认切换当前选用的工作流版本，并在 {@link SkillRouter} 注入与 {@code use_skill} 调用时按当前上下文实时解析生效版本。</li>
 * </ul>
 */
@Service
@Slf4j
public class BuiltinWorkflowVersionService {

    public static final String DEFAULT_VERSION_ID = "default";

    public static final List<String> ORDERED_WORKFLOW_IDS = List.of(
            "contract-review",
            "evidence-linked-report",
            "file-organization",
            "legal-opinion-review"
    );

    private static final String KEY_USER_VERSIONS_PREFIX = "ai.bw.ver.u";
    private static final String KEY_USER_DEFAULT_PREFIX = "ai.bw.def.u";
    private static final String KEY_PROJECT_SELECT_PREFIX = "ai.bw.proj.p";

    private final SkillRegistry skillRegistry;
    private final SystemSettingService systemSettingService;
    private final AppLanguageService appLanguageService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    /** 单测未注入 SystemSettingService 时的内存后备存储 */
    private final Map<String, String> fallbackStore = new ConcurrentHashMap<>();

    @Autowired
    public BuiltinWorkflowVersionService(
            SkillRegistry skillRegistry,
            @Nullable SystemSettingService systemSettingService,
            @Nullable AppLanguageService appLanguageService) {
        this.skillRegistry = skillRegistry;
        this.systemSettingService = systemSettingService;
        this.appLanguageService = appLanguageService;
    }

    private record CardMeta(
            String shortNameZh,
            String shortNameEn,
            String hintZh,
            String hintEn,
            String quickPromptZh,
            String quickPromptEn
    ) {}

    private static final Map<String, CardMeta> CARD_META = Map.of(
            "contract-review", new CardMeta(
                    "合同审查",
                    "Contract Review",
                    "风险识别与红线批注",
                    "Risk check & redline edits",
                    "请按内置合同审查流程审查当前合同，识别核心风险条款并给出可直接采纳的修改建议。",
                    "Please review the current contract using the built-in contract review workflow, identify key risk clauses, and provide actionable revision suggestions."
            ),
            "evidence-linked-report", new CardMeta(
                    "证据整理",
                    "Evidence Organization",
                    "编目编号与证明目的",
                    "Cataloging & proof mapping",
                    "请整理项目中的证据材料，按证据三性、证明目的与来源文件生成结构化证据目录和核查清单。",
                    "Please organize the evidence materials in this project and generate a structured evidence catalog and verification checklist with sources and proof purposes."
            ),
            "file-organization", new CardMeta(
                    "文件整理",
                    "File Organization",
                    "分类归档与目录梳理",
                    "Classification & folder tidy-up",
                    "请梳理并整理当前项目目录中的文件，按资料类别与时间线规划清晰的归档结构。",
                    "Please inspect and organize the files in the current project directory, planning a clean archive structure by document type and timeline."
            ),
            "legal-opinion-review", new CardMeta(
                    "法律意见书核查",
                    "Legal Opinion Verification",
                    "底稿交叉核验与披露排查",
                    "Workpaper cross-check & disclosure audit",
                    "请按内置法律意见书核查流程，对当前法律意见书及底稿进行事实交叉核验与披露遗漏排查。",
                    "Please run the built-in legal opinion verification workflow to cross-check facts against workpapers and identify any disclosure gaps."
            )
    );

    private boolean isEnglish() {
        return appLanguageService != null && appLanguageService.isEnglish();
    }

    /**
     * 列出全部内置常驻工作流在当前用户 + 当前项目下的版本状态。
     */
    public List<WorkflowStateView> listWorkflowStates(@Nullable Long userId, @Nullable String projectId) {
        List<WorkflowStateView> result = new ArrayList<>();
        List<String> seen = new ArrayList<>();
        for (String id : ORDERED_WORKFLOW_IDS) {
            Optional<SkillDefinition> opt = skillRegistry.getSkill(id);
            if (opt.isPresent() && opt.get().isBuiltinWorkflow()) {
                result.add(buildWorkflowState(userId, projectId, opt.get()));
                seen.add(id);
            }
        }
        for (SkillDefinition skill : skillRegistry.getSkills()) {
            if (skill.isBuiltinWorkflow() && !seen.contains(skill.getId())) {
                result.add(buildWorkflowState(userId, projectId, skill));
            }
        }
        return result;
    }

    /**
     * 获取单个内置常驻工作流在当前用户 + 当前项目下的版本状态。
     */
    public WorkflowStateView getWorkflowState(@Nullable Long userId, @Nullable String projectId, String skillId) {
        SkillDefinition skill = requireBuiltinWorkflow(skillId);
        return buildWorkflowState(userId, projectId, skill);
    }

    /**
     * 解析某个内置工作流在当前用户 + 当前项目下实际生效的版本（供对话卡片、SkillRouter 注入与 use_skill 共用）。
     */
    public WorkflowVersion resolveActiveVersion(@Nullable Long userId, @Nullable String projectId, String skillId) {
        Optional<SkillDefinition> opt = skillRegistry.getSkill(skillId);
        if (opt.isEmpty() || !opt.get().isBuiltinWorkflow()) {
            return null;
        }
        SkillDefinition skill = opt.get();
        WorkflowVersion sysDefault = buildSystemDefaultVersion(skill);
        List<WorkflowVersion> customVersions = readCustomVersions(userId, skillId);
        Map<String, WorkflowVersion> byId = new LinkedHashMap<>();
        byId.put(DEFAULT_VERSION_ID, sysDefault);
        for (WorkflowVersion v : customVersions) {
            if (v != null && v.getId() != null && !DEFAULT_VERSION_ID.equals(v.getId())) {
                byId.put(v.getId(), v);
            }
        }

        String projSelected = readProjectSelection(projectId).get(skillId);
        if (projSelected != null && byId.containsKey(projSelected)) {
            return byId.get(projSelected);
        }

        String globalSelected = readUserGlobalDefaults(userId).get(skillId);
        if (globalSelected != null && byId.containsKey(globalSelected)) {
            return byId.get(globalSelected);
        }

        return sysDefault;
    }

    /**
     * 新建或更新用户的自定义版本（系统默认版只读，不允许覆盖 id="default"）。
     */
    public synchronized WorkflowStateView saveCustomVersion(
            @Nullable Long userId,
            @Nullable String projectId,
            String skillId,
            SaveVersionRequest req) {
        SkillDefinition skill = requireBuiltinWorkflow(skillId);
        WorkflowVersion sysDefault = buildSystemDefaultVersion(skill);

        String requestedId = req != null && req.getId() != null ? req.getId().trim() : "";
        boolean isNew = requestedId.isEmpty() || DEFAULT_VERSION_ID.equalsIgnoreCase(requestedId);
        String versionId = isNew
                ? "v_" + UUID.randomUUID().toString().replace("-", "").substring(0, 10)
                : requestedId;

        String name = req != null && req.getName() != null ? req.getName().trim() : "";
        if (name.isEmpty()) {
            name = isEnglish() ? "Custom Version" : "自定义版本";
        }

        String quickPrompt = req != null && req.getQuickPrompt() != null
                ? req.getQuickPrompt().trim()
                : sysDefault.getQuickPrompt();
        if (quickPrompt.isEmpty()) {
            quickPrompt = sysDefault.getQuickPrompt();
        }

        String promptTemplate = req != null && req.getPromptTemplate() != null
                ? req.getPromptTemplate()
                : sysDefault.getPromptTemplate();
        if (promptTemplate.isBlank()) {
            promptTemplate = sysDefault.getPromptTemplate();
        }

        String output = req != null && req.getOutput() != null
                ? req.getOutput()
                : sysDefault.getOutput();

        List<WorkflowVersion> customList = new ArrayList<>(readCustomVersions(userId, skillId));
        WorkflowVersion saved = new WorkflowVersion();
        saved.setId(versionId);
        saved.setName(name);
        saved.setSystemDefault(false);
        saved.setQuickPrompt(quickPrompt);
        saved.setPromptTemplate(promptTemplate);
        saved.setOutput(output);
        saved.setUpdatedAt(System.currentTimeMillis());

        int existingIdx = -1;
        for (int i = 0; i < customList.size(); i++) {
            if (versionId.equals(customList.get(i).getId())) {
                existingIdx = i;
                break;
            }
        }
        if (existingIdx >= 0) {
            customList.set(existingIdx, saved);
        } else {
            customList.add(saved);
        }
        writeCustomVersions(userId, skillId, customList);

        boolean applyToProject = req == null || req.getApplyToProject() == null || req.getApplyToProject();
        boolean setAsGlobal = req != null && Boolean.TRUE.equals(req.getSetAsGlobalDefault());

        if (setAsGlobal) {
            Map<String, String> globalMap = new LinkedHashMap<>(readUserGlobalDefaults(userId));
            globalMap.put(skillId, versionId);
            writeUserGlobalDefaults(userId, globalMap);
        }
        if (applyToProject && hasProjectId(projectId)) {
            Map<String, String> projMap = new LinkedHashMap<>(readProjectSelection(projectId));
            projMap.put(skillId, versionId);
            writeProjectSelection(projectId, projMap);
        } else if (!hasProjectId(projectId) && applyToProject && !setAsGlobal) {
            Map<String, String> globalMap = new LinkedHashMap<>(readUserGlobalDefaults(userId));
            globalMap.put(skillId, versionId);
            writeUserGlobalDefaults(userId, globalMap);
        }

        return buildWorkflowState(userId, projectId, skill);
    }

    /**
     * 为当前项目或全局默认切换选用的版本。
     *
     * @param scope "project"（当前项目偏好，缺省当 projectId 存在时）、"global"（全局默认）、"clear_project"（清除项目覆盖，跟随全局默认）
     */
    public synchronized WorkflowStateView selectVersion(
            @Nullable Long userId,
            @Nullable String projectId,
            String skillId,
            String versionId,
            @Nullable String scope) {
        SkillDefinition skill = requireBuiltinWorkflow(skillId);
        String targetVersionId = (versionId == null || versionId.isBlank()) ? DEFAULT_VERSION_ID : versionId.trim();

        if (!DEFAULT_VERSION_ID.equals(targetVersionId)) {
            boolean exists = readCustomVersions(userId, skillId).stream()
                    .anyMatch(v -> targetVersionId.equals(v.getId()));
            if (!exists) {
                throw new IllegalArgumentException("Unknown workflow version: " + targetVersionId);
            }
        }

        String normalizedScope = scope != null ? scope.trim().toLowerCase() : "";
        if ("clear_project".equals(normalizedScope)) {
            if (hasProjectId(projectId)) {
                Map<String, String> projMap = new LinkedHashMap<>(readProjectSelection(projectId));
                projMap.remove(skillId);
                writeProjectSelection(projectId, projMap);
            }
        } else if ("global".equals(normalizedScope) || !hasProjectId(projectId)) {
            Map<String, String> globalMap = new LinkedHashMap<>(readUserGlobalDefaults(userId));
            globalMap.put(skillId, targetVersionId);
            writeUserGlobalDefaults(userId, globalMap);
        } else {
            Map<String, String> projMap = new LinkedHashMap<>(readProjectSelection(projectId));
            projMap.put(skillId, targetVersionId);
            writeProjectSelection(projectId, projMap);
        }

        return buildWorkflowState(userId, projectId, skill);
    }

    /**
     * 删除一个用户自定义版本（系统默认版不可删除；若被删除版本正被当前项目或全局选用，自动回退到系统默认版）。
     */
    public synchronized WorkflowStateView deleteCustomVersion(
            @Nullable Long userId,
            @Nullable String projectId,
            String skillId,
            String versionId) {
        SkillDefinition skill = requireBuiltinWorkflow(skillId);
        if (versionId == null || versionId.isBlank() || DEFAULT_VERSION_ID.equals(versionId.trim())) {
            throw new IllegalArgumentException("Cannot delete system default workflow version");
        }
        String target = versionId.trim();
        List<WorkflowVersion> customList = new ArrayList<>(readCustomVersions(userId, skillId));
        boolean removed = customList.removeIf(v -> target.equals(v.getId()));
        if (removed) {
            writeCustomVersions(userId, skillId, customList);
        }

        Map<String, String> globalMap = new LinkedHashMap<>(readUserGlobalDefaults(userId));
        if (target.equals(globalMap.get(skillId))) {
            globalMap.remove(skillId);
            writeUserGlobalDefaults(userId, globalMap);
        }

        if (hasProjectId(projectId)) {
            Map<String, String> projMap = new LinkedHashMap<>(readProjectSelection(projectId));
            if (target.equals(projMap.get(skillId))) {
                projMap.remove(skillId);
                writeProjectSelection(projectId, projMap);
            }
        }

        return buildWorkflowState(userId, projectId, skill);
    }

    // ==================== 内部构建与持久化辅助 ====================

    private SkillDefinition requireBuiltinWorkflow(String skillId) {
        if (skillId == null || skillId.isBlank()) {
            throw new IllegalArgumentException("skillId is required");
        }
        SkillDefinition skill = skillRegistry.getSkill(skillId.trim())
                .orElseThrow(() -> new IllegalArgumentException("Unknown skill: " + skillId));
        if (!skill.isBuiltinWorkflow()) {
            throw new IllegalArgumentException("Skill is not a builtin workflow: " + skillId);
        }
        return skill;
    }

    private WorkflowStateView buildWorkflowState(@Nullable Long userId, @Nullable String projectId, SkillDefinition skill) {
        String skillId = skill.getId();
        boolean en = isEnglish();
        CardMeta meta = CARD_META.get(skillId);

        WorkflowVersion sysDefault = buildSystemDefaultVersion(skill);
        List<WorkflowVersion> customVersions = readCustomVersions(userId, skillId);

        List<WorkflowVersion> allVersions = new ArrayList<>(1 + customVersions.size());
        allVersions.add(sysDefault);
        Map<String, WorkflowVersion> byId = new LinkedHashMap<>();
        byId.put(DEFAULT_VERSION_ID, sysDefault);
        for (WorkflowVersion custom : customVersions) {
            if (custom != null && custom.getId() != null && !DEFAULT_VERSION_ID.equals(custom.getId())) {
                custom.setSystemDefault(false);
                allVersions.add(custom);
                byId.put(custom.getId(), custom);
            }
        }

        Map<String, String> projMap = readProjectSelection(projectId);
        Map<String, String> globalMap = readUserGlobalDefaults(userId);

        String projSelectedId = projMap.get(skillId);
        if (projSelectedId != null && !byId.containsKey(projSelectedId)) {
            projSelectedId = null;
        }
        String globalSelectedId = globalMap.get(skillId);
        if (globalSelectedId == null || !byId.containsKey(globalSelectedId)) {
            globalSelectedId = DEFAULT_VERSION_ID;
        }

        WorkflowVersion activeVersion;
        String activeScope;
        if (projSelectedId != null) {
            activeVersion = byId.get(projSelectedId);
            activeScope = "project";
        } else if (!DEFAULT_VERSION_ID.equals(globalSelectedId)) {
            activeVersion = byId.get(globalSelectedId);
            activeScope = "global";
        } else {
            activeVersion = sysDefault;
            activeScope = "default";
        }

        WorkflowStateView view = new WorkflowStateView();
        view.setSkillId(skillId);
        view.setName(en && skill.getNameEn() != null && !skill.getNameEn().isBlank()
                ? skill.getNameEn()
                : skill.getName());
        if (meta != null) {
            view.setShortName(en ? meta.shortNameEn() : meta.shortNameZh());
            view.setHint(en ? meta.hintEn() : meta.hintZh());
        } else {
            view.setShortName(view.getName());
            view.setHint(skill.getDescription());
        }
        view.setDescription(skill.getDescription());
        view.setActiveVersionId(activeVersion.getId());
        view.setActiveVersionName(activeVersion.getName());
        view.setActiveIsSystemDefault(activeVersion.isSystemDefault());
        view.setActiveScope(activeScope);
        view.setProjectSelectedVersionId(projSelectedId);
        view.setGlobalDefaultVersionId(globalSelectedId);
        view.setActiveQuickPrompt(activeVersion.getQuickPrompt());
        view.setVersions(allVersions);
        return view;
    }

    public WorkflowVersion buildSystemDefaultVersion(SkillDefinition skill) {
        boolean en = isEnglish();
        CardMeta meta = CARD_META.get(skill.getId());

        WorkflowVersion v = new WorkflowVersion();
        v.setId(DEFAULT_VERSION_ID);
        v.setName(en ? "System Default" : "系统默认版");
        v.setSystemDefault(true);
        if (meta != null) {
            v.setQuickPrompt(en ? meta.quickPromptEn() : meta.quickPromptZh());
        } else {
            v.setQuickPrompt(skill.getName());
        }
        String prompt = (en && skill.getPromptTemplateEn() != null && !skill.getPromptTemplateEn().isBlank())
                ? skill.getPromptTemplateEn()
                : skill.getPromptTemplate();
        String output = (en && skill.getOutputEn() != null && !skill.getOutputEn().isBlank())
                ? skill.getOutputEn()
                : skill.getOutput();
        v.setPromptTemplate(prompt != null ? prompt : "");
        v.setOutput(output != null ? output : "");
        v.setUpdatedAt(0L);
        return v;
    }

    private long normalizeUserId(@Nullable Long userId) {
        return userId != null && userId > 0 ? userId : 0L;
    }

    private boolean hasProjectId(@Nullable String projectId) {
        return projectId != null && !projectId.trim().isEmpty();
    }

    private String userVersionsKey(@Nullable Long userId, String skillId) {
        return KEY_USER_VERSIONS_PREFIX + normalizeUserId(userId) + "." + skillId;
    }

    private String userDefaultsKey(@Nullable Long userId) {
        return KEY_USER_DEFAULT_PREFIX + normalizeUserId(userId);
    }

    private String projectSelectionKey(String projectId) {
        return KEY_PROJECT_SELECT_PREFIX + projectId.trim();
    }

    private String readSetting(String key) {
        if (systemSettingService != null) {
            return systemSettingService.get(key, null);
        }
        return fallbackStore.get(key);
    }

    private void writeSetting(String key, String json) {
        if (systemSettingService != null) {
            systemSettingService.set(key, json);
        } else {
            fallbackStore.put(key, json);
        }
    }

    private List<WorkflowVersion> readCustomVersions(@Nullable Long userId, String skillId) {
        String raw = readSetting(userVersionsKey(userId, skillId));
        if (raw == null || raw.isBlank()) {
            return List.of();
        }
        try {
            List<WorkflowVersion> parsed = objectMapper.readValue(raw, new TypeReference<List<WorkflowVersion>>() {});
            return parsed != null ? parsed : List.of();
        } catch (Exception e) {
            log.warn("Failed to parse custom workflow versions for user={}, skill={}: {}",
                    userId, skillId, e.getMessage());
            return List.of();
        }
    }

    private void writeCustomVersions(@Nullable Long userId, String skillId, List<WorkflowVersion> versions) {
        try {
            String json = objectMapper.writeValueAsString(versions != null ? versions : List.of());
            writeSetting(userVersionsKey(userId, skillId), json);
        } catch (Exception e) {
            log.error("Failed to persist custom workflow versions for user={}, skill={}", userId, skillId, e);
        }
    }

    private Map<String, String> readUserGlobalDefaults(@Nullable Long userId) {
        return readStringMap(userDefaultsKey(userId));
    }

    private void writeUserGlobalDefaults(@Nullable Long userId, Map<String, String> map) {
        writeStringMap(userDefaultsKey(userId), map);
    }

    private Map<String, String> readProjectSelection(@Nullable String projectId) {
        if (!hasProjectId(projectId)) {
            return Map.of();
        }
        return readStringMap(projectSelectionKey(projectId));
    }

    private void writeProjectSelection(String projectId, Map<String, String> map) {
        if (!hasProjectId(projectId)) {
            return;
        }
        writeStringMap(projectSelectionKey(projectId), map);
    }

    private Map<String, String> readStringMap(String key) {
        String raw = readSetting(key);
        if (raw == null || raw.isBlank()) {
            return Map.of();
        }
        try {
            Map<String, String> parsed = objectMapper.readValue(raw, new TypeReference<Map<String, String>>() {});
            return parsed != null ? parsed : Map.of();
        } catch (Exception e) {
            log.warn("Failed to parse workflow map setting {}: {}", key, e.getMessage());
            return Map.of();
        }
    }

    private void writeStringMap(String key, Map<String, String> map) {
        try {
            String json = objectMapper.writeValueAsString(map != null ? map : Map.of());
            writeSetting(key, json);
        } catch (Exception e) {
            log.error("Failed to persist workflow map setting {}", key, e);
        }
    }

    // ==================== DTOs ====================

    @Data
    public static class WorkflowVersion {
        private String id;
        private String name;
        private boolean systemDefault;
        private String quickPrompt;
        private String promptTemplate;
        private String output;
        private Long updatedAt;
    }

    @Data
    public static class WorkflowStateView {
        private String skillId;
        private String name;
        private String shortName;
        private String hint;
        private String description;
        private String activeVersionId;
        private String activeVersionName;
        private boolean activeIsSystemDefault;
        private String activeScope;
        private String projectSelectedVersionId;
        private String globalDefaultVersionId;
        private String activeQuickPrompt;
        private List<WorkflowVersion> versions = new ArrayList<>();
    }

    @Data
    public static class SaveVersionRequest {
        private String id;
        private String name;
        private String quickPrompt;
        private String promptTemplate;
        private String output;
        private Boolean applyToProject;
        private Boolean setAsGlobalDefault;
        private String projectId;
    }

    @Data
    public static class SelectVersionRequest {
        private String versionId;
        private String scope;
        private String projectId;
    }
}
