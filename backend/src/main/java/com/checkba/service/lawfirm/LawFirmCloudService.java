// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.lawfirm;

import com.checkba.model.entity.lawfirm.LawFirmCloudSettings;
import com.checkba.repository.lawfirm.LawFirmCloudSettingsRepository;
import com.checkba.service.LangText;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.*;

/**
 * 律所云端统一入口（服务端；与利冲协作同在官方协作服务 / 自建团队服务器上，路径 {@code /api/lawfirm/cloud}）。
 *
 * <ul>
 *   <li>身份：每次调用先经 {@link LawFirmAuthority#current} 从账户名录解析律所与是否律所管理员，不信任客户端传来的身份；</li>
 *   <li>开关：每个律所一行 {@link LawFirmCloudSettings}，每个已登记功能一个开关，默认关闭，只有律所管理员能改；
 *       开关关闭时该功能的全部动作一律拒绝（读开关本身除外）；</li>
 *   <li>分发：动作名 {@code <功能键>.<动作>} 交给登记了该功能键的 {@link LawFirmCloudFeature}；任何包里的 Spring Bean
 *       实现该接口即自动登记（客户与主体、计时工时、投标材料……），桌面端网关白名单也来自同一登记表；</li>
 *   <li>并发：开关与各功能的记录都带乐观版本，界面带 expectedVersion，见 {@link LawFirmCloudVersions}。</li>
 * </ul>
 */
@Service
public class LawFirmCloudService implements LawFirmCloudSwitches {

    public static final String SETTINGS_GET = "cloud.settings.get";
    public static final String SETTINGS_SET = "cloud.settings.set";
    /** 开关读写只给律所管理插件（唯一的开关界面）。 */
    public static final String SETTINGS_PLUGIN = "lawfirm-management";
    /** 功能键：小写字母开头，2–24 位小写字母、数字或连字符；"cloud" 保留给开关读写本身。 */
    static final java.util.regex.Pattern FEATURE_KEY = java.util.regex.Pattern.compile("[a-z][a-z0-9-]{1,23}");

    private final LawFirmAuthority authority;
    private final LawFirmCloudSettingsRepository settings;
    private final ObjectProvider<LawFirmCloudFeature> features;

    public LawFirmCloudService(LawFirmAuthority authority, LawFirmCloudSettingsRepository settings, ObjectProvider<LawFirmCloudFeature> features) {
        this.authority = authority;
        this.settings = settings;
        this.features = features;
    }

    /** 已登记的功能（按功能键）。 */
    public Map<String, LawFirmCloudFeature> registry() {
        Map<String, LawFirmCloudFeature> out = new LinkedHashMap<>();
        features.orderedStream().forEach(f -> {
            if (f.key() == null || !FEATURE_KEY.matcher(f.key()).matches() || "cloud".equals(f.key())) {
                throw new IllegalStateException("Invalid law firm cloud feature key: " + f.key());
            }
            if (out.put(f.key(), f) != null) throw new IllegalStateException("Duplicate law firm cloud feature: " + f.key());
        });
        return out;
    }

    /** 动作名属于哪个功能；开关读写返回 "cloud"；不认识返回 null。供服务端分发与桌面端网关白名单共用。 */
    public String featureOf(String action) {
        if (action == null) return null;
        if (SETTINGS_GET.equals(action) || SETTINGS_SET.equals(action)) return "cloud";
        int dot = action.indexOf('.');
        if (dot <= 0 || dot == action.length() - 1) return null;
        String key = action.substring(0, dot);
        return registry().containsKey(key) ? key : null;
    }

    /** 某插件能否经插件桥调用该动作：开关读写只给律所管理插件；功能动作只给该功能声明的插件。 */
    public boolean pluginMayCall(String pluginId, String action) {
        String feature = featureOf(action);
        if (feature == null || pluginId == null) return false;
        if ("cloud".equals(feature)) return SETTINGS_PLUGIN.equals(pluginId);
        return registry().get(feature).pluginIds().contains(pluginId);
    }

    @Transactional
    public Map<String, Object> execute(Long userId, String action, Map<String, Object> raw) {
        String feature = featureOf(action);
        if (feature == null) throw new IllegalArgumentException(LangText.of("不支持的律所云端操作", "Unsupported law firm cloud action"));
        LawFirmAuthority.Member me = authority.current(userId);
        Map<String, Object> p = raw == null ? Map.of() : raw;
        if ("cloud".equals(feature)) {
            return SETTINGS_GET.equals(action) ? view(me) : set(me, p);
        }
        if (!enabled(row(me.firmId()), feature)) {
            throw new IllegalStateException(LangText.of("本所尚未开启该云端功能，请律所管理员在律所管理「律所云端」中开启",
                    "This cloud feature is not enabled for your firm; a firm administrator can enable it under Firm cloud in Law Firm Management"));
        }
        return registry().get(feature).execute(me, action, p);
    }

    /** 本律所是否开启了某功能（供各功能在自己的服务里复核）。 */
    public boolean isEnabled(String firmId, String feature) {
        return firmId != null && feature != null && enabled(row(firmId), feature);
    }

    @Override
    public boolean enabled(String firmId, String feature) {
        return isEnabled(firmId, feature);
    }

    private LawFirmCloudSettings row(String firmId) {
        return settings.findById(firmId).orElseGet(() -> {
            LawFirmCloudSettings s = new LawFirmCloudSettings();
            s.setFirmId(firmId);
            return s;
        });
    }

    private static Set<String> enabledSet(LawFirmCloudSettings s) {
        Set<String> out = new TreeSet<>();
        if (s.getEnabledFeatures() != null) {
            for (String k : s.getEnabledFeatures().split(",")) if (!k.isBlank()) out.add(k.trim());
        }
        return out;
    }

    private static boolean enabled(LawFirmCloudSettings s, String feature) {
        return enabledSet(s).contains(feature);
    }

    /**
     * 给界面看的版本：还没有这一行时为 0，存过之后为 JPA 版本 + 1。
     * JPA 新插入的行版本也是 0，若直接暴露，两位管理员从「无记录」同时开关时会都通过校验。
     */
    private static long shownVersion(LawFirmCloudSettings s) {
        return s.getUpdatedAt() == null ? 0 : s.getVersion() + 1;
    }

    private Map<String, Object> view(LawFirmAuthority.Member me) {
        LawFirmCloudSettings s = row(me.firmId());
        Map<String, Object> switches = new LinkedHashMap<>();
        Map<String, Object> labels = new LinkedHashMap<>();
        for (Map.Entry<String, LawFirmCloudFeature> f : registry().entrySet()) {
            switches.put(f.getKey(), enabled(s, f.getKey()));
            labels.put(f.getKey(), Map.of("names", f.getValue().names(), "descriptions", f.getValue().descriptions()));
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("firmAdmin", me.firmAdmin());
        out.put("name", me.name());
        out.put("version", shownVersion(s));
        out.put("switches", switches);
        out.put("features", new ArrayList<>(registry().keySet()));
        out.put("labels", labels);
        out.put("updatedAt", s.getUpdatedAt() == null ? null : s.getUpdatedAt().toString());
        return out;
    }

    private Map<String, Object> set(LawFirmAuthority.Member me, Map<String, Object> p) {
        if (!me.firmAdmin()) throw LawFirmAuthority.denied();
        String feature = p.get("feature") == null ? "" : String.valueOf(p.get("feature"));
        if (!registry().containsKey(feature)) throw new IllegalArgumentException(LangText.of("不支持的律所云端功能", "Unsupported law firm cloud feature"));
        Object en = p.get("enabled");
        if (!(en instanceof Boolean)) throw new IllegalArgumentException(LangText.of("缺少开关状态", "Missing switch state"));
        boolean on = (Boolean) en;
        LawFirmCloudSettings s = row(me.firmId());
        // 与界面所见版本不一致即拒绝（两位管理员同时改开关）
        LawFirmCloudVersions.check(p, shownVersion(s));
        Set<String> set = enabledSet(s);
        if (on) set.add(feature); else set.remove(feature);
        s.setEnabledFeatures(String.join(",", set));
        s.setUpdatedBy(me.userId());
        s.setUpdatedAt(Instant.now());
        settings.saveAndFlush(s);
        long purged = 0;
        if (!on && Boolean.TRUE.equals(p.get("purge"))) {
            purged = registry().get(feature).purge(me.firmId());
        }
        Map<String, Object> out = new LinkedHashMap<>(view(me));
        out.put("purged", purged);
        return out;
    }
}
