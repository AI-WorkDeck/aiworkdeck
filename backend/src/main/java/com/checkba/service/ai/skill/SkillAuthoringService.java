// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.skill;

import com.checkba.service.AppLanguageService;
import com.checkba.service.LangText;
import com.checkba.service.account.AccountException;
import com.checkba.service.account.AccountService;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.yaml.snakeyaml.DumperOptions;
import org.yaml.snakeyaml.Yaml;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * 用户在本机「一句话创建」Skill，以及把它发布到官网 Marketplace。
 *
 * <p><b>创建</b>：写 {@code {ai.skills.dir}/{id}/skill.yml + prompt.md}（与在线安装同一目录、同一套扫描/启停），
 * skill.yml 带 {@code authored_locally: true} 与 {@code created_at}。字段上限与官网投稿校验
 * （官网仓 {@code lib/skills-store.ts validateSkillInput}）逐条一致——本机能建出来的，就一定能发布出去。
 *
 * <p><b>发布</b>：经 {@link AccountService} 以 {@code Bearer awdk_} 调官网 {@code POST /api/skills}；
 * 同 id 已存在（{@code id_taken}）时改走 {@code PUT /api/skills/{id}}——官网只允许作者本人更新，
 * 别人占用的 id 回 403，在这里翻成「换个标识」。只有 {@code authored_locally} 的 skill 可以发布：
 * 从广场装来的别人的 skill 不许经客户端转投。发布结果记在同目录 {@code publish.json}（不改 skill.yml）。
 */
@Service
@Slf4j
public class SkillAuthoringService {

    /** 与 SkillMarketService.SKILL_ID、官网 SKILL_ID_RE 同一规则。 */
    static final Pattern SKILL_ID = Pattern.compile("^[a-z0-9][a-z0-9-]{1,49}$");
    static final int NAME_MAX = 60;
    static final int DESCRIPTION_MAX = 200;
    static final int TRIGGERS_MAX = 20;
    static final int TRIGGER_MAX = 40;
    static final int OUTPUT_MAX = 2000;
    static final int PROMPT_MAX = 20000;
    static final String PUBLISH_FILE = "publish.json";

    private static final ObjectMapper JSON = new ObjectMapper();

    private final SkillProperties properties;
    private final SkillRegistry skillRegistry;
    private final AccountService accountService;
    private final AppLanguageService appLanguageService;

    public SkillAuthoringService(SkillProperties properties, SkillRegistry skillRegistry,
                                 AccountService accountService, AppLanguageService appLanguageService) {
        this.properties = properties;
        this.skillRegistry = skillRegistry;
        this.accountService = accountService;
        this.appLanguageService = appLanguageService;
    }

    /** AI 起草的 Skill。input/rules/instructions 只进 prompt.md；output 同时写进 skill.yml。 */
    public record Draft(String id, String name, String description, List<String> triggers,
                        String input, String rules, String output, String instructions) {}

    /**
     * 创建（或覆盖更新自己创建过的）Skill，并 rescan 使其立即可用。
     *
     * @throws IllegalArgumentException 字段不合规，或 id 已被非本机创建的 skill 占用
     * @throws IllegalStateException 写盘失败
     */
    public synchronized SkillDefinition create(Draft draft) {
        String id = trim(draft.id());
        if (id == null || !SKILL_ID.matcher(id).matches()) {
            throw new IllegalArgumentException(LangText.of(
                    "Skill 标识不合规：只能用小写字母、数字和连字符，2–50 位，且以字母或数字开头（例：shareholder-signature-pages）",
                    "Invalid skill id: use 2-50 lowercase letters, digits or hyphens, starting with a letter or digit (e.g. shareholder-signature-pages)"));
        }
        String name = requireText(draft.name(), NAME_MAX, LangText.of("名称", "name"));
        String description = requireText(draft.description(), DESCRIPTION_MAX, LangText.of("简介", "description"));
        List<String> triggers = cleanTriggers(draft.triggers());
        String output = optionalText(draft.output(), OUTPUT_MAX, LangText.of("输出", "output"));
        String prompt = composePrompt(name, description, draft.input(), draft.rules(), output, draft.instructions());
        if (prompt.length() > PROMPT_MAX) {
            throw new IllegalArgumentException(LangText.of(
                    "Skill 正文太长（上限 " + PROMPT_MAX + " 字），请精简规则或做法",
                    "The skill instructions are too long (limit " + PROMPT_MAX + " characters); shorten the rules or steps"));
        }

        SkillDefinition existing = skillRegistry.getSkill(id).orElse(null);
        String version = "1.0.0";
        String createdAt = Instant.now().toString();
        if (existing != null) {
            if (!existing.isAuthoredLocally()) {
                throw new IllegalArgumentException(LangText.of(
                        "标识「" + id + "」已被另一个 Skill 使用，请换一个标识",
                        "The id \"" + id + "\" is already used by another skill; choose a different id"));
            }
            version = bumpPatch(existing.getVersion());
            if (existing.getCreatedAt() != null) createdAt = existing.getCreatedAt();
        }

        Map<String, Object> yml = new LinkedHashMap<>();
        yml.put("id", id);
        yml.put("name", name);
        yml.put("description", description);
        yml.put("triggers", triggers);
        if (output != null) yml.put("output", output);
        String author = accountService.currentDisplayNameOrNull();
        if (author != null) yml.put("author", author);
        yml.put("version", version);
        yml.put("languages", List.of(appLanguageService.language()));
        yml.put("authored_locally", true);
        yml.put("created_at", createdAt);
        yml.put("prompt", "prompt.md");

        Path skillDir = skillDir(id);
        if (existing == null && Files.exists(skillDir)) {
            // 目录在但没被加载（skill.yml 坏了等）：不是本机创建的东西，不能静默覆盖
            throw new IllegalArgumentException(LangText.of(
                    "标识「" + id + "」对应的目录已存在，请换一个标识",
                    "A folder for the id \"" + id + "\" already exists; choose a different id"));
        }
        try {
            Files.createDirectories(skillDir);
            Files.writeString(skillDir.resolve("skill.yml"), dumpYaml(yml), StandardCharsets.UTF_8);
            Files.writeString(skillDir.resolve("prompt.md"), prompt, StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new IllegalStateException(LangText.of("写入 Skill 文件失败：", "Failed to write skill files: ") + e.getMessage(), e);
        }
        skillRegistry.rescan();
        SkillDefinition created = skillRegistry.getSkill(id).orElse(null);
        if (created == null) {
            throw new IllegalStateException(LangText.of("Skill 已写入但未能加载，请在插件广场点「重新扫描」",
                    "The skill was written but could not be loaded; click Rescan in the marketplace"));
        }
        log.info("Authored local skill '{}' v{}", id, version);
        return created;
    }

    /** 发布结果。{@code updated} = 官网已有同 id（本人发布过），这次是更新。 */
    public record PublishResult(String id, String version, boolean updated) {}

    /**
     * 发布到官网 Marketplace。
     *
     * @throws IllegalArgumentException skill 不存在或不是本机创建的
     * @throws AccountException 未连接账户 / 官网拒绝（字段不合规、id 被他人占用等）/ 网络
     */
    public synchronized PublishResult publish(String id) {
        SkillDefinition skill = skillRegistry.getSkill(trim(id)).orElse(null);
        if (skill == null) {
            throw new IllegalArgumentException(LangText.of("Skill 不存在：", "Skill not found: ") + id);
        }
        if (!skill.isAuthoredLocally()) {
            throw new IllegalArgumentException(LangText.of(
                    "只有你在本机创建的 Skill 可以发布到 Marketplace",
                    "Only skills you created on this computer can be published to the Marketplace"));
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("id", skill.getId());
        body.put("name", skill.getName());
        body.put("description", skill.getDescription());
        body.put("triggers", skill.getTriggers());
        body.put("allowedTools", skill.getAllowedTools() == null ? List.of() : skill.getAllowedTools());
        if (skill.getOutput() != null) body.put("output", skill.getOutput());
        body.put("prompt", skill.getPromptTemplate());

        Map<String, Object> reply;
        boolean updated = false;
        try {
            reply = accountService.submitSkill(body);
        } catch (AccountException e) {
            if (!"id_taken".equals(e.getReason())) throw e;
            try {
                reply = accountService.updatePublishedSkill(skill.getId(), body);
                updated = true;
            } catch (AccountException e2) {
                if ("forbidden".equals(e2.getReason())) {
                    throw new AccountException(AccountException.Kind.REJECTED, LangText.of(
                            "Marketplace 上已有别人发布的同标识 Skill「" + skill.getId() + "」。请让 AI 换一个标识重新创建后再发布",
                            "Someone else already published a skill with the id \"" + skill.getId()
                                    + "\". Ask the AI to recreate it under a different id, then publish again"), "id_taken");
                }
                throw e2;
            }
        }
        String version = null;
        if (reply != null && reply.get("skill") instanceof Map<?, ?> s && s.get("version") != null) {
            version = String.valueOf(s.get("version"));
        }
        recordPublished(skill.getId(), version);
        log.info("Published skill '{}' to marketplace (version={}, updated={})", skill.getId(), version, updated);
        return new PublishResult(skill.getId(), version, updated);
    }

    /** 本机记下的已发布版本；没发布过返回 null。 */
    public String publishedVersion(String id) {
        if (id == null || !SKILL_ID.matcher(id).matches()) return null;
        Path file = skillDir(id).resolve(PUBLISH_FILE);
        if (!Files.isRegularFile(file)) return null;
        try {
            Object v = JSON.readValue(file.toFile(), Map.class).get("version");
            return v == null ? "" : String.valueOf(v);
        } catch (Exception e) {
            return null;
        }
    }

    // ------------------------------------------------------------------

    private void recordPublished(String id, String version) {
        Map<String, Object> rec = new LinkedHashMap<>();
        rec.put("version", version == null ? "" : version);
        rec.put("publishedAt", Instant.now().toString());
        try {
            Files.writeString(skillDir(id).resolve(PUBLISH_FILE), JSON.writeValueAsString(rec), StandardCharsets.UTF_8);
        } catch (Exception e) {
            // 已经发上去了；台账写不进只影响按钮显示「已发布」，不该把成功报成失败
            log.warn("Failed to record publish state for skill '{}': {}", id, e.getMessage());
        }
    }

    private Path skillDir(String id) {
        Path root = Path.of(properties.getDir()).toAbsolutePath().normalize();
        Path dir = root.resolve(id).normalize();
        if (!dir.startsWith(root) || !root.equals(dir.getParent())) {
            throw new IllegalArgumentException("Invalid skill id: " + id);
        }
        return dir;
    }

    static String composePrompt(String name, String description, String input, String rules,
                                String output, String instructions) {
        StringBuilder sb = new StringBuilder();
        sb.append("# ").append(name).append("\n\n").append(description).append("\n");
        appendSection(sb, LangText.of("输入", "Input"), input);
        appendSection(sb, LangText.of("规则", "Rules"), rules);
        appendSection(sb, LangText.of("输出", "Output"), output);
        appendSection(sb, LangText.of("做法", "Steps"), instructions);
        return sb.toString();
    }

    private static void appendSection(StringBuilder sb, String title, String body) {
        String text = trim(body);
        if (text == null) return;
        sb.append("\n## ").append(title).append("\n\n").append(text).append("\n");
    }

    private static String dumpYaml(Map<String, Object> map) {
        DumperOptions opts = new DumperOptions();
        opts.setDefaultFlowStyle(DumperOptions.FlowStyle.BLOCK);
        opts.setAllowUnicode(true);
        opts.setWidth(Integer.MAX_VALUE);
        String header = "# " + LangText.of("由 AI WorkDeck 在本机创建（一句话写 Skill）",
                "Created on this computer by AI WorkDeck (one-sentence skill)") + "\n";
        return header + new Yaml(opts).dump(map);
    }

    private static List<String> cleanTriggers(List<String> raw) {
        List<String> out = new ArrayList<>();
        if (raw != null) {
            for (String t : raw) {
                String v = trim(t);
                if (v != null && !out.contains(v)) out.add(v);
            }
        }
        if (out.isEmpty() || out.size() > TRIGGERS_MAX || out.stream().anyMatch(t -> t.length() > TRIGGER_MAX)) {
            throw new IllegalArgumentException(LangText.of(
                    "触发词需要 1–" + TRIGGERS_MAX + " 个，每个不超过 " + TRIGGER_MAX + " 字",
                    "Provide 1-" + TRIGGERS_MAX + " trigger phrases, each at most " + TRIGGER_MAX + " characters"));
        }
        return out;
    }

    private static String requireText(String raw, int max, String field) {
        String v = trim(raw);
        if (v == null || v.length() > max) {
            throw new IllegalArgumentException(LangText.of(
                    "Skill 的" + field + "不能为空，且不超过 " + max + " 字",
                    "The skill " + field + " is required and must be at most " + max + " characters"));
        }
        return v;
    }

    private static String optionalText(String raw, int max, String field) {
        String v = trim(raw);
        if (v != null && v.length() > max) {
            throw new IllegalArgumentException(LangText.of(
                    "Skill 的" + field + "不超过 " + max + " 字",
                    "The skill " + field + " must be at most " + max + " characters"));
        }
        return v;
    }

    static String bumpPatch(String version) {
        String[] parts = (version == null ? "" : version).split("\\.");
        int major = parseOr(parts, 0, 1), minor = parseOr(parts, 1, 0), patch = parseOr(parts, 2, -1);
        return major + "." + minor + "." + (patch + 1);
    }

    private static int parseOr(String[] parts, int i, int fallback) {
        try {
            return i < parts.length ? Integer.parseInt(parts[i].trim()) : fallback;
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static String trim(String s) {
        if (s == null) return null;
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }
}
