// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.lawfirm;

import com.checkba.model.entity.lawfirm.LawFirmCloudBillingSetting;
import com.checkba.model.entity.lawfirm.LawFirmCloudMatter;
import com.checkba.model.entity.lawfirm.LawFirmCloudTimeEntry;
import com.checkba.repository.lawfirm.LawFirmCloudBillingSettingRepository;
import com.checkba.repository.lawfirm.LawFirmCloudMatterRepository;
import com.checkba.repository.lawfirm.LawFirmCloudTimeEntryRepository;
import com.checkba.service.LangText;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.util.*;

/**
 * 律所云端工时汇总（服务端，跑在官方协作服务 / 自建团队服务器上，与 {@link LawFirmWorkflowService} 同一入口与同一身份）。
 *
 * <p>只做「交」与「回」：律师把本机工时（日期、分钟、描述、事项、是否收费）交到律所；发布该事项的律所管理员（合伙人）
 * 在自己的桌面端取回、在本机台账里审核和出账单，再把审核结论回写到这里，律师在自己的工作记录里看到结论。
 * 费率、金额、账单与发票不上云：本机「发票与财务收费」台账仍是唯一的财务账。
 *
 * <p>身份全部来自账户名录（{@link LawFirmAuthority}）：律所、显示名、是否律所管理员；不信任客户端传来的任何身份字段。
 * 每个律所默认关闭，由律所管理员明确开启；关闭时可一并删除云端工时与事项。
 */
@Service
@RequiredArgsConstructor
public class LawFirmCloudBillingService {

    public static final Set<String> ACTIONS = Set.of("billingCloudStatus", "billingCloudEnable", "billingCloudPublishMatter",
            "billingCloudArchiveMatter", "billingCloudSubmit", "billingCloudMine", "billingCloudPull", "billingCloudOutcome");

    static final int MAX_BATCH = 100;
    static final int MAX_PULL = 300;
    static final Set<String> OUTCOMES = Set.of("RECEIVED", "APPROVED", "RETURNED", "BILLED");

    private final LawFirmAuthority authority;
    private final LawFirmCloudBillingSettingRepository settings;
    private final LawFirmCloudMatterRepository matters;
    private final LawFirmCloudTimeEntryRepository entries;
    private final ObjectMapper mapper;

    @Transactional
    public Map<String, Object> execute(Long userId, String action, Map<String, Object> raw) {
        LawFirmAuthority.Member me = authority.current(userId);
        Map<String, Object> p = raw == null ? Map.of() : raw;
        return switch (action) {
            case "billingCloudStatus" -> status(me);
            case "billingCloudEnable" -> enable(me, p);
            case "billingCloudPublishMatter" -> publish(me, p);
            case "billingCloudArchiveMatter" -> archive(me, p);
            case "billingCloudSubmit" -> submit(me, p);
            case "billingCloudMine" -> mine(me);
            case "billingCloudPull" -> pull(me);
            case "billingCloudOutcome" -> outcome(me, p);
            default -> throw new IllegalArgumentException(LangText.of("不支持的云端工时操作", "Unsupported cloud time action"));
        };
    }

    private boolean enabled(String firmId) {
        return settings.findById(firmId).map(LawFirmCloudBillingSetting::isEnabled).orElse(false);
    }

    private void requireEnabled(LawFirmAuthority.Member me) {
        if (!enabled(me.firmId())) {
            throw new IllegalStateException(LangText.of("本所尚未开启云端工时汇总，请律所管理员在律所管理「计时收费」中开启",
                    "Cloud time collection is not enabled for this firm; a firm administrator can enable it under Hourly billing"));
        }
    }

    private Map<String, Object> status(LawFirmAuthority.Member me) {
        Map<String, Object> out = new LinkedHashMap<>();
        boolean on = enabled(me.firmId());
        out.put("enabled", on);
        out.put("firmAdmin", me.firmAdmin());
        out.put("name", me.name());
        List<Map<String, Object>> list = new ArrayList<>();
        if (on) {
            for (LawFirmCloudMatter m : matters.findByFirmIdOrderByCreatedAtDesc(me.firmId())) {
                if (!m.isActive() && !Objects.equals(m.getOwnerId(), me.userId())) continue;
                list.add(matterView(m, me));
            }
        }
        out.put("matters", list);
        return out;
    }

    private Map<String, Object> enable(LawFirmAuthority.Member me, Map<String, Object> p) {
        if (!me.firmAdmin()) throw LawFirmAuthority.denied();
        boolean on = Boolean.TRUE.equals(p.get("enabled"));
        LawFirmCloudBillingSetting s = settings.findById(me.firmId()).orElseGet(() -> {
            LawFirmCloudBillingSetting x = new LawFirmCloudBillingSetting();
            x.setFirmId(me.firmId());
            return x;
        });
        s.setEnabled(on);
        s.setUpdatedBy(me.userId());
        s.setUpdatedAt(Instant.now());
        settings.saveAndFlush(s);
        long purged = 0;
        if (!on && Boolean.TRUE.equals(p.get("purge"))) {
            purged = entries.deleteByFirmId(me.firmId());
            matters.deleteByFirmId(me.firmId());
        }
        Map<String, Object> out = new LinkedHashMap<>(status(me));
        out.put("purgedEntries", purged);
        return out;
    }

    private Map<String, Object> publish(LawFirmAuthority.Member me, Map<String, Object> p) {
        if (!me.firmAdmin()) throw LawFirmAuthority.denied();
        requireEnabled(me);
        String id = text(p, "matterId", 36, false);
        LawFirmCloudMatter m;
        if (id != null) {
            m = ownMatter(me, id);
        } else {
            m = new LawFirmCloudMatter();
            m.setId(UUID.randomUUID().toString());
            m.setFirmId(me.firmId());
            m.setOwnerId(me.userId());
            m.setCreatedAt(Instant.now());
        }
        m.setOwnerName(me.name());
        m.setTitle(text(p, "title", 256, true));
        m.setClientName(text(p, "clientName", 256, false));
        m.setActive(true);
        m.setUpdatedAt(Instant.now());
        return Map.of("matter", matterView(matters.saveAndFlush(m), me));
    }

    private Map<String, Object> archive(LawFirmAuthority.Member me, Map<String, Object> p) {
        LawFirmCloudMatter m = ownMatter(me, text(p, "matterId", 36, true));
        m.setActive(false);
        m.setUpdatedAt(Instant.now());
        return Map.of("matter", matterView(matters.saveAndFlush(m), me));
    }

    private LawFirmCloudMatter ownMatter(LawFirmAuthority.Member me, String id) {
        LawFirmCloudMatter m = matters.findById(id).orElseThrow(LawFirmAuthority::denied);
        if (!me.firmAdmin() || !Objects.equals(m.getFirmId(), me.firmId()) || !Objects.equals(m.getOwnerId(), me.userId())) {
            throw LawFirmAuthority.denied();
        }
        return m;
    }

    /** 律师交工时。同一本机工时（clientKey）重复提交：仍在待审或已退回时更新内容，已被合伙人取回后不再改动。 */
    private Map<String, Object> submit(LawFirmAuthority.Member me, Map<String, Object> p) {
        requireEnabled(me);
        List<Map<String, Object>> rows = list(p.get("entries"));
        if (rows.isEmpty() || rows.size() > MAX_BATCH) {
            throw new IllegalArgumentException(LangText.of("每次提交 1–100 条工时", "Submit between 1 and 100 entries at a time"));
        }
        Map<String, LawFirmCloudMatter> cache = new HashMap<>();
        List<Map<String, Object>> out = new ArrayList<>();
        Instant now = Instant.now();
        for (Map<String, Object> r : rows) {
            String matterId = text(r, "matterId", 36, true);
            LawFirmCloudMatter m = cache.computeIfAbsent(matterId, k -> matters.findById(k).orElse(null));
            if (m == null || !m.isActive() || !Objects.equals(m.getFirmId(), me.firmId())) {
                throw new IllegalArgumentException(LangText.of("事项不存在或已停止接收工时", "The matter does not exist or no longer accepts time"));
            }
            String key = text(r, "clientKey", 64, true);
            LocalDate date = date(r.get("workDate"));
            int minutes = minutes(r.get("minutes"));
            String desc = text(r, "description", 1000, true);
            boolean billable = !Boolean.FALSE.equals(r.get("billable"));
            LawFirmCloudTimeEntry e = entries.findByFirmIdAndLawyerIdAndClientKey(me.firmId(), me.userId(), key).orElse(null);
            if (e == null) {
                e = new LawFirmCloudTimeEntry();
                e.setId(UUID.randomUUID().toString());
                e.setFirmId(me.firmId());
                e.setLawyerId(me.userId());
                e.setClientKey(key);
            } else if (!Set.of("SUBMITTED", "RETURNED").contains(e.getStatus())) {
                out.add(entryView(e));
                continue;
            }
            e.setLawyerName(me.name());
            e.setMatterId(matterId);
            e.setWorkDate(date);
            e.setMinutes(minutes);
            e.setDescription(desc);
            e.setBillable(billable);
            e.setStatus("SUBMITTED");
            e.setBilledMinutes(null);
            e.setReviewedDescription(null);
            e.setReviewedBillable(null);
            e.setSubmittedAt(now);
            e.setUpdatedAt(now);
            out.add(entryView(entries.saveAndFlush(e)));
        }
        return Map.of("entries", out);
    }

    /** 律师只看到自己交的工时与结论。 */
    private Map<String, Object> mine(LawFirmAuthority.Member me) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (LawFirmCloudTimeEntry e : entries.findByFirmIdAndLawyerIdOrderByWorkDateDesc(me.firmId(), me.userId(), PageRequest.of(0, 1000))) {
            out.add(entryView(e));
        }
        return Map.of("entries", out);
    }

    /** 合伙人取回自己发布事项下的待审工时（取回即标为 RECEIVED；重复取回会再次返回，本机按编号去重）。 */
    private Map<String, Object> pull(LawFirmAuthority.Member me) {
        if (!me.firmAdmin()) throw LawFirmAuthority.denied();
        requireEnabled(me);
        List<String> mine = matters.findByFirmIdOrderByCreatedAtDesc(me.firmId()).stream()
                .filter(m -> Objects.equals(m.getOwnerId(), me.userId())).map(LawFirmCloudMatter::getId).toList();
        List<Map<String, Object>> out = new ArrayList<>();
        if (!mine.isEmpty()) {
            Instant now = Instant.now();
            for (LawFirmCloudTimeEntry e : entries.findByMatterIdInAndStatusInOrderBySubmittedAtAsc(mine, List.of("SUBMITTED", "RECEIVED"), PageRequest.of(0, MAX_PULL))) {
                // 名录核验：已离所的律师交的工时不再交给合伙人
                try {
                    authority.requireMember(me.userId(), e.getLawyerId());
                } catch (IllegalArgumentException departed) {
                    continue;
                }
                if ("SUBMITTED".equals(e.getStatus())) {
                    e.setStatus("RECEIVED");
                    e.setUpdatedAt(now);
                    entries.save(e);
                }
                Map<String, Object> v = entryView(e);
                v.put("lawyerAccountId", "cloud-" + e.getLawyerId());
                out.add(v);
            }
        }
        return Map.of("entries", out);
    }

    /** 合伙人回写审核结论。只能写自己发布事项下的工时。 */
    private Map<String, Object> outcome(LawFirmAuthority.Member me, Map<String, Object> p) {
        if (!me.firmAdmin()) throw LawFirmAuthority.denied();
        List<Map<String, Object>> rows = list(p.get("entries"));
        if (rows.isEmpty() || rows.size() > MAX_BATCH) {
            throw new IllegalArgumentException(LangText.of("每次回写 1–100 条结论", "Write back between 1 and 100 outcomes at a time"));
        }
        Map<String, LawFirmCloudMatter> cache = new HashMap<>();
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            LawFirmCloudTimeEntry e = entries.findById(text(r, "id", 36, true)).orElseThrow(LawFirmAuthority::denied);
            LawFirmCloudMatter m = cache.computeIfAbsent(e.getMatterId(), k -> matters.findById(k).orElse(null));
            if (m == null || !Objects.equals(m.getFirmId(), me.firmId()) || !Objects.equals(m.getOwnerId(), me.userId())) {
                throw LawFirmAuthority.denied();
            }
            String status = text(r, "status", 16, true);
            if (!OUTCOMES.contains(status)) throw new IllegalArgumentException(LangText.of("审核结论无效", "Invalid review outcome"));
            e.setStatus(status);
            Object billed = r.get("billedMinutes");
            e.setBilledMinutes(billed == null ? null : Math.min(minutes(billed), e.getMinutes()));
            e.setReviewedDescription(text(r, "description", 1000, false));
            e.setReviewedBillable(r.get("billable") instanceof Boolean b ? b : null);
            e.setBillNo(text(r, "billNo", 64, false));
            e.setReviewJson(reviewJson(r.get("notes")));
            e.setUpdatedAt(Instant.now());
            out.add(entryView(entries.saveAndFlush(e)));
        }
        return Map.of("entries", out);
    }

    private String reviewJson(Object raw) {
        List<Map<String, Object>> clean = new ArrayList<>();
        for (Map<String, Object> n : list(raw)) {
            if (clean.size() >= 50) break;
            Map<String, Object> c = new LinkedHashMap<>();
            c.put("action", text(n, "action", 32, true));
            c.put("actorName", text(n, "actorName", 128, false));
            c.put("reason", text(n, "reason", 500, false));
            c.put("at", text(n, "at", 40, false));
            clean.add(c);
        }
        try {
            return mapper.writeValueAsString(clean);
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }

    private Map<String, Object> matterView(LawFirmCloudMatter m, LawFirmAuthority.Member me) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("id", m.getId());
        v.put("title", m.getTitle());
        v.put("clientName", m.getClientName());
        v.put("ownerName", m.getOwnerName());
        v.put("active", m.isActive());
        v.put("mine", Objects.equals(m.getOwnerId(), me.userId()));
        return v;
    }

    private Map<String, Object> entryView(LawFirmCloudTimeEntry e) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("id", e.getId());
        v.put("matterId", e.getMatterId());
        v.put("clientKey", e.getClientKey());
        v.put("lawyerName", e.getLawyerName());
        v.put("workDate", e.getWorkDate().toString());
        v.put("minutes", e.getMinutes());
        v.put("description", e.getDescription());
        v.put("billable", e.isBillable());
        v.put("status", e.getStatus());
        v.put("billedMinutes", e.getBilledMinutes());
        v.put("reviewedDescription", e.getReviewedDescription());
        v.put("reviewedBillable", e.getReviewedBillable());
        v.put("billNo", e.getBillNo());
        try {
            v.put("notes", e.getReviewJson() == null ? List.of() : mapper.readValue(e.getReviewJson(), new TypeReference<List<Map<String, Object>>>() {}));
        } catch (Exception ex) {
            v.put("notes", List.of());
        }
        return v;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> list(Object raw) {
        if (!(raw instanceof Collection<?> c)) return List.of();
        List<Map<String, Object>> out = new ArrayList<>();
        for (Object o : c) if (o instanceof Map<?, ?> m) out.add((Map<String, Object>) m);
        return out;
    }

    private static String text(Map<String, Object> p, String key, int max, boolean required) {
        Object v = p.get(key);
        String s = v == null ? null : String.valueOf(v).replaceAll("\\p{Cntrl}", " ").trim();
        if (s == null || s.isEmpty()) {
            if (required) throw new IllegalArgumentException(LangText.of("缺少字段：", "Missing field: ") + key);
            return null;
        }
        if (s.length() > max) throw new IllegalArgumentException(LangText.of("字段过长：", "Field too long: ") + key);
        return s;
    }

    private static LocalDate date(Object raw) {
        try {
            LocalDate d = LocalDate.parse(String.valueOf(raw));
            // 律师与服务器可能不在同一时区，放宽一天
            if (d.isAfter(LocalDate.now().plusDays(1)) || d.isBefore(LocalDate.now().minusYears(2))) throw new IllegalArgumentException();
            return d;
        } catch (RuntimeException ex) {
            throw new IllegalArgumentException(LangText.of("工作日期无效", "Invalid work date"));
        }
    }

    private static int minutes(Object raw) {
        int m;
        if (raw instanceof Number n) m = n.intValue();
        else {
            try {
                m = Integer.parseInt(String.valueOf(raw));
            } catch (NumberFormatException ex) {
                m = -1;
            }
        }
        if (m <= 0 || m > LawFirmBillingMath.MAX_MINUTES_PER_ENTRY) {
            throw new IllegalArgumentException(LangText.of("时长须大于 0 且不超过 24 小时", "Hours must be greater than 0 and at most 24"));
        }
        return m;
    }
}
