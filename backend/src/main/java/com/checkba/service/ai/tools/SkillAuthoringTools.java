// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import com.checkba.service.ai.SseEmitterService;
import com.checkba.service.ai.context.ProjectContextHolder;
import com.checkba.service.ai.skill.SkillAuthoringService;
import com.checkba.service.ai.skill.SkillDefinition;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 一句话写 Skill：用户说「把……做成一个 Skill」时，模型起草并调用本工具落盘。
 *
 * <p>落盘与校验在 {@link SkillAuthoringService}；本类只负责参数整形，并在成功后向前端发
 * {@code client_action {action:"skill_created", skill:{...}}}——前端据此在当前回复里显示
 * 「已创建 Skill」卡片，并广播 {@code awd:market-changed} 让插件广场「已安装 · Skill」立即出现新条目。
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class SkillAuthoringTools implements AgentToolComponent {

    public static final String TOOL_NAME = "create_skill";

    private final SkillAuthoringService skillAuthoringService;
    private final SseEmitterService sseEmitterService;
    private final com.checkba.repository.UserRepository userRepository;
    private final com.checkba.service.AdminAccessService adminAccessService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @ToolMeta(displayName = "创建 Skill", category = "agent")
    @Tool("Create (or update) a reusable skill on this computer when the user asks to turn a task or "
            + "procedure into a skill (e.g. '把……做成一个 Skill', 'make this a skill'). Draft it from the "
            + "conversation: concrete input, decision rules and output, in the user's language. The skill "
            + "becomes usable immediately: the user can pick it in the chat (type @ and its name) or say one "
            + "of its triggers. Re-calling with the same id updates a skill you created earlier. Only call it "
            + "when the user asked for a skill; never to store ordinary notes.")
    public String create_skill(
            @P("Stable id: 2-50 chars, lowercase ASCII letters, digits and hyphens, e.g. \"shareholder-signature-pages\".") String id,
            @P("Short display name in the user's language, at most 60 chars, e.g. \"股东会签字页\".") String name,
            @P("One sentence on what it does, at most 200 chars.") String description,
            @P("1-20 trigger phrases separated by commas or new lines, each at most 40 chars, e.g. \"签字页, 股东会签字页\".") String triggers,
            @P("What the user provides (materials, fields).") String input,
            @P("The decision rules the skill must apply, one per line.") String rules,
            @P("What the skill produces, at most 2000 chars.") String output,
            @P("Step-by-step instructions for carrying it out, including checks before finishing.") String instructions,
            String conversationId
    ) {
        // skills 目录是整个实例共用的、新 skill 默认自动生效：团队服务器上等于替所有人加了一段提示词。
        // 与广场安装 / 重扫 / 发布同一道管理员闸（桌面单机模式下本人即管理员）。
        Long userId = ProjectContextHolder.getUserId();
        boolean admin = userId != null && userRepository != null && adminAccessService != null
                && userRepository.findById(userId).map(adminAccessService::isAdmin).orElse(false);
        if (!admin) {
            return "Error: " + com.checkba.service.LangText.of(
                    "只有管理员可以创建 Skill（Skill 会对本实例所有成员生效），请让管理员来创建",
                    "Only an administrator can create skills (a skill applies to everyone on this instance); ask an administrator to create it");
        }
        SkillDefinition skill;
        try {
            skill = skillAuthoringService.create(new SkillAuthoringService.Draft(
                    id, name, description, splitTriggers(triggers), input, rules, output, instructions));
        } catch (IllegalArgumentException | IllegalStateException e) {
            return "Error: " + e.getMessage();
        }
        log.info("Tool: create_skill conv={} skill={} v{}", conversationId, skill.getId(), skill.getVersion());
        notifyCreated(conversationId, skill, input, rules, output);
        return "Skill created and enabled: " + skill.getName() + " (id: " + skill.getId() + ", version "
                + skill.getVersion() + "). Triggers: " + String.join(", ", skill.getTriggers())
                + ". It is listed under Installed > Skills in the marketplace panel. Tell the user they can "
                + "type @" + skill.getName() + " in the chat to run it, and that they can publish it to the "
                + "Marketplace from its detail page so other lawyers can install it.";
    }

    static List<String> splitTriggers(String raw) {
        if (raw == null) return List.of();
        return Arrays.stream(raw.split("[,，、;；\\n]"))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();
    }

    private void notifyCreated(String conversationId, SkillDefinition skill, String input, String rules, String output) {
        if (conversationId == null || sseEmitterService == null) return;
        try {
            Map<String, Object> card = new LinkedHashMap<>();
            card.put("id", skill.getId());
            card.put("name", skill.getName());
            card.put("description", skill.getDescription());
            card.put("version", skill.getVersion());
            card.put("input", input == null ? "" : input.trim());
            card.put("rules", rules == null ? "" : rules.trim());
            card.put("output", output == null ? "" : output.trim());
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("action", "skill_created");
            payload.put("skill", card);
            sseEmitterService.send(conversationId, "client_action", objectMapper.writeValueAsString(payload));
        } catch (Exception e) {
            // 卡片与侧栏刷新是锦上添花；文件已落盘、模型已拿到结果
            log.warn("Failed to send skill_created to {}: {}", conversationId, e.getMessage());
        }
    }
}
