// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.lawfirm;

import com.checkba.model.entity.AccountBinding;
import com.checkba.model.entity.User;
import com.checkba.model.entity.lawfirm.LawFirmMatterIntake;
import com.checkba.model.entity.lawfirm.LawFirmTimeEntry;
import com.checkba.repository.AccountBindingRepository;
import com.checkba.repository.UserRepository;
import com.checkba.repository.lawfirm.LawFirmBillingTermsRepository;
import com.checkba.repository.lawfirm.LawFirmCloudTimeEntryRepository;
import com.checkba.repository.lawfirm.LawFirmMatterIntakeRepository;
import com.checkba.repository.lawfirm.LawFirmTimeEntryRepository;
import com.checkba.service.ai.PluginService;
import com.checkba.service.collab.AccountDirectoryClient;
import com.checkba.service.collab.DirectoryAccount;
import com.checkba.service.collab.DirectoryReply;
import com.checkba.service.collab.OrgMembership;
import com.checkba.service.im.ImService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentMatchers;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * 律所云端工时汇总：律师（各自桌面）把工时交到律所云端 → 发布事项的合伙人取回、在本机审核出账单 → 结论回写，
 * 律师在自己的工作记录看到结论。云端身份来自（模拟的）账户名录；本测试里「本机」与「云端」共用一个库，
 * 律师本机用户编号与云端账户一一对应，云端客户端直接转发到真实的 LawFirmCloudBillingService。
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import({LawFirmManagementService.class, LawFirmBillingService.class, LawFirmCloudBillingService.class, LawFirmAuthority.class,
        LawFirmConflictEngine.class, ImService.class, ObjectMapper.class})
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:lawfirm-cloud-billing;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect", "spring.jpa.hibernate.ddl-auto=create-drop",
        "security.local-mode=false"
})
class LawFirmCloudBillingTest {

    @Autowired LawFirmBillingService billing;
    @Autowired LawFirmManagementService ledger;
    @Autowired LawFirmCloudBillingService cloudService;
    @Autowired UserRepository users;
    @Autowired AccountBindingRepository bindings;
    @Autowired LawFirmMatterIntakeRepository intakes;
    @Autowired LawFirmTimeEntryRepository entries;
    @Autowired LawFirmCloudTimeEntryRepository cloudEntries;
    @Autowired LawFirmBillingTermsRepository terms;

    @MockBean PluginService pluginService;
    @MockBean LawFirmAccessPolicy access;
    @MockBean AccountDirectoryClient directory;
    @MockBean LawFirmBillingCloudClient cloudClient;

    final Map<String, OrgMembership> membership = new HashMap<>();
    final AtomicBoolean cloudDown = new AtomicBoolean(false);
    Long partner, partner2, lawyerA, lawyerB, outsider;
    LawFirmMatterIntake intake;
    String firm;

    @BeforeEach
    void setUp() {
        org.springframework.test.util.AopTestUtils.<LawFirmManagementService>getUltimateTargetObject(ledger).ledgerAvailable = true;
        firm = "firm-" + UUID.randomUUID();
        partner = user(true, firm, "林合伙人");
        partner2 = user(true, firm, "苏合伙人");
        lawyerA = user(false, firm, "陈律师");
        lawyerB = user(false, firm, "周律师");
        outsider = user(true, "other-" + firm, "外所律师");
        when(directory.configured()).thenReturn(true);
        when(directory.lookupByAccountId(anyString(), anyString())).thenAnswer(call -> {
            String me = call.getArgument(0), candidate = call.getArgument(1);
            User u = users.findById(Long.parseLong(candidate.substring("account-".length()))).orElseThrow();
            return new DirectoryReply(membership.containsKey(candidate), new DirectoryAccount(candidate, candidate, u.getDisplayName(), null),
                    membership.getOrDefault(me, OrgMembership.NONE), membership.getOrDefault(candidate, OrgMembership.NONE));
        });
        // 每位律师在自己的桌面上都是「全所资格」（单机），这里按身份区分：合伙人能管本机台账，律师不能
        when(access.canViewFirmWide(ArgumentMatchers.any())).thenAnswer(c -> Set.of(partner, partner2).contains((Long) c.getArgument(0)));
        doAnswer(c -> {
            if (!Set.of(partner, partner2).contains((Long) c.getArgument(0))) throw new IllegalArgumentException("not firm admin");
            return null;
        }).when(access).requireFirmWide(ArgumentMatchers.any());
        when(cloudClient.call(ArgumentMatchers.any(), anyString(), ArgumentMatchers.any())).thenAnswer(c -> {
            String action = c.getArgument(1);
            if (cloudDown.get() && "billingCloudOutcome".equals(action)) throw new IllegalStateException("cloud down");
            try {
                return cloudService.execute(c.getArgument(0), action, c.getArgument(2));
            } catch (IllegalArgumentException e) {
                throw new IllegalStateException(e.getMessage());
            }
        });
        when(cloudClient.statusOrUnavailable(ArgumentMatchers.any())).thenAnswer(c -> {
            Map<String, Object> s = new LinkedHashMap<>(cloudService.execute(c.getArgument(0), "billingCloudStatus", Map.of()));
            s.put("available", true);
            return s;
        });
        intake = intakes.save(LawFirmMatterIntake.builder().intakeNo("C-" + System.nanoTime()).title("甲公司数据合规专项")
                .clientName("甲公司（虚构）").leadLawyerUserId(partner).feeMode("HOURLY").status("APPROVED_FILED")
                .createdAt(Instant.now()).updatedAt(Instant.now()).build());
    }

    Long user(boolean admin, String firmId, String name) {
        User u = new User();
        u.setUsername("cloud-billing-" + UUID.randomUUID());
        u.setDisplayName(name);
        u.setPassword("synthetic");
        u.setRole("USER");
        u.setSubscriptionType("FREE");
        u.setCreatedAt(LocalDateTime.now());
        u.setUpdatedAt(LocalDateTime.now());
        Long id = users.saveAndFlush(u).getId();
        AccountBinding b = new AccountBinding();
        b.setUserId(id);
        b.setExternalAccountId("account-" + id);
        b.setCreatedAt(LocalDateTime.now());
        bindings.saveAndFlush(b);
        membership.put(b.getExternalAccountId(), new OrgMembership("team-" + firmId, firmId, admin));
        return id;
    }

    Map<String, Object> act(Long u, String action, Map<String, Object> p) {
        return billing.execute(u, null, action, p);
    }

    @SuppressWarnings("unchecked")
    List<Map<String, Object>> list(Map<String, Object> m, String key) {
        return (List<Map<String, Object>>) m.get(key);
    }

    Long save(Long lawyer, String target, String hours, String desc) {
        return ((Number) ((Map<?, ?>) act(lawyer, "timeSave", Map.of("target", target, "workDate", LocalDate.now().toString(),
                "hours", hours, "description", desc)).get("entry")).get("id")).longValue();
    }

    Map<String, Object> mineEntry(Long lawyer, Long id) {
        return list(act(lawyer, "timeMine", Map.of()), "entries").stream().filter(e -> id.equals(e.get("id"))).findFirst().orElseThrow();
    }

    @Test
    void lawyersSubmitAcrossDesktopsPartnerReviewsAndBillsLocallyOutcomesFlowBack() {
        // 默认关闭；只有律所管理员能开启
        assertEquals(false, list(act(lawyerA, "timeMine", Map.of()), "entries").isEmpty() ? act(lawyerA, "timeMine", Map.of()).get("cloud") instanceof Map<?, ?> c ? c.get("enabled") : null : null);
        assertThrows(IllegalArgumentException.class, () -> cloudService.execute(lawyerA, "billingCloudEnable", Map.of("enabled", true)));
        assertThrows(IllegalStateException.class, () -> act(partner, "cloudBillingPublish", Map.of("intakeId", intake.getId())), "publish requires opt-in");
        act(partner, "cloudBillingEnable", Map.of("enabled", true));
        Map<String, Object> st = act(partner, "cloudBillingPublish", Map.of("intakeId", intake.getId()));
        String matterId = terms.findByIntakeId(intake.getId()).orElseThrow().getCloudMatterId();
        assertNotNull(matterId);
        assertEquals(intake.getId(), ((Map<?, ?>) st.get("published")).get(matterId));

        // 律师在自己的计费工时里看到云端事项，选它记工时并提交
        List<Map<String, Object>> targets = list(act(lawyerA, "timeMine", Map.of()), "targets");
        assertTrue(targets.stream().anyMatch(t -> ("c:" + matterId).equals(t.get("key")) && "甲公司（虚构）".equals(t.get("clientName"))));
        Long a = save(lawyerA, "c:" + matterId, "2", "审阅数据处理协议");
        Long b = save(lawyerB, "c:" + matterId, "1.5", "起草隐私政策");
        assertEquals(1, act(lawyerA, "timeSubmit", Map.of("ids", List.of(a))).get("cloudSubmitted"));
        assertEquals(1, act(lawyerB, "timeSubmit", Map.of("ids", List.of(b))).get("cloudSubmitted"));
        assertEquals("SUBMITTED", entries.findById(a).orElseThrow().getStatus());
        // 重复提交同一条（如网络重试）不会在云端多出一条
        cloudService.execute(lawyerA, "billingCloudSubmit", Map.of("entries", List.of(Map.of("clientKey",
                entries.findById(a).orElseThrow().getCloudClientKey(), "matterId", matterId, "workDate", LocalDate.now().toString(),
                "minutes", 120, "description", "审阅数据处理协议", "billable", true))));
        assertEquals(2, cloudEntries.count());

        // 律师只看到自己的；外所账户不能往本所事项交工时
        assertEquals(1, list(cloudService.execute(lawyerA, "billingCloudMine", Map.of()), "entries").size());
        cloudService.execute(outsider, "billingCloudEnable", Map.of("enabled", true));
        assertThrows(IllegalArgumentException.class, () -> cloudService.execute(outsider, "billingCloudSubmit", Map.of("entries", List.of(Map.of(
                "clientKey", "x", "matterId", matterId, "workDate", LocalDate.now().toString(), "minutes", 60, "description", "x")))));
        // 非律所管理员、以及不是发布人的另一位合伙人，都取不到这些工时
        assertThrows(IllegalArgumentException.class, () -> cloudService.execute(lawyerA, "billingCloudPull", Map.of()));
        assertTrue(list(cloudService.execute(partner2, "billingCloudPull", Map.of()), "entries").isEmpty());

        // 取回之前，本机审核列表里没有律师端的镜像（同库的测试里也不会被算两遍）
        assertTrue(list(act(partner, "timeReviewList", Map.of()), "entries").isEmpty());
        Map<String, Object> pulled = act(partner, "cloudBillingPull", Map.of());
        assertEquals(2, pulled.get("created"));
        List<Map<String, Object>> review = list(act(partner, "timeReviewList", Map.of()), "entries");
        assertEquals(Set.of("陈律师", "周律师"), new HashSet<>(review.stream().map(e -> e.get("timekeeperName")).toList()));
        assertEquals(0, act(partner, "cloudBillingPull", Map.of()).get("created"), "pulling again does not duplicate");

        // 合伙人给两位同事设费率，核减陈律师、退回周律师
        for (Map<String, Object> tk : list(act(partner, "billingRates", Map.of()), "timekeepers")) {
            if (Set.of("陈律师", "周律师").contains(tk.get("name")) && String.valueOf(users.findById((Long) tk.get("userId")).orElseThrow().getUsername()).startsWith("cloud-lawyer-")) {
                act(partner, "billingSaveTimekeeper", Map.of("userId", tk.get("userId"), "level", "ASSOCIATE", "standardRateYuan", "1000"));
            }
        }
        Long ra = (Long) review.stream().filter(e -> "陈律师".equals(e.get("timekeeperName"))).findFirst().orElseThrow().get("id");
        Long rb = (Long) review.stream().filter(e -> "周律师".equals(e.get("timekeeperName"))).findFirst().orElseThrow().get("id");
        act(partner, "timeReview", Map.of("id", ra, "op", "ADJUST", "billedHours", "1.5", "reason", "部分为内部准备"));
        act(partner, "timeReview", Map.of("id", rb, "op", "RETURN", "reason", "请写明起草的是哪份文件"));
        // 合伙人本机不能借道审核律师端镜像
        assertThrows(IllegalArgumentException.class, () -> act(partner, "timeReview", Map.of("id", a, "op", "APPROVE")));

        Map<String, Object> mineA = mineEntry(lawyerA, a);
        assertEquals("SUBMITTED", mineA.get("status"));
        assertEquals(90, mineA.get("billedMinutes"));
        assertTrue(list(mineA, "audit").stream().anyMatch(n -> "WRITE_DOWN".equals(n.get("action")) && "部分为内部准备".equals(n.get("reason"))));
        Map<String, Object> mineB = mineEntry(lawyerB, b);
        assertEquals("RETURNED", mineB.get("status"));
        assertTrue(list(mineB, "audit").stream().anyMatch(n -> "RETURN".equals(n.get("action"))));

        // 周律师改了再交；合伙人再取回时本机那条回到待审
        act(lawyerB, "timeSave", Map.of("id", b, "hours", "1", "description", "起草《个人信息处理规则》"));
        act(lawyerB, "timeSubmit", Map.of("ids", List.of(b)));
        assertEquals(1, act(partner, "cloudBillingPull", Map.of()).get("refreshed"));
        LawFirmTimeEntry localB = entries.findById(rb).orElseThrow();
        assertEquals("SUBMITTED", localB.getStatus());
        assertEquals(60, localB.getMinutes());
        assertEquals("起草《个人信息处理规则》", localB.getDescription());

        // 通过、出账单（本机），结论回写；云端暂不可用时记为待同步，下次取回时补上
        act(partner, "timeApproveAll", Map.of("ids", List.of(ra, rb)));
        cloudDown.set(true);
        Map<String, Object> bill = (Map<String, Object>) act(partner, "billCreate", Map.of("intakeId", intake.getId())).get("bill");
        assertEquals(150 * 100000L / 60, ((Number) bill.get("totalCents")).longValue(), "1.5h + 1h at ¥1,000");
        assertTrue(entries.findById(ra).orElseThrow().getCloudSyncPending());
        assertEquals("APPROVED", mineEntry(lawyerA, a).get("status"), "lawyer still sees the last synced outcome");
        cloudDown.set(false);
        assertEquals(0, act(partner, "cloudBillingPull", Map.of()).get("pendingSync"));
        assertFalse(entries.findById(ra).orElseThrow().getCloudSyncPending());
        assertEquals("BILLED", mineEntry(lawyerA, a).get("status"));
        assertEquals(bill.get("billNo"), cloudEntries.findById(entries.findById(ra).orElseThrow().getCloudEntryId()).orElseThrow().getBillNo());

        // 另一位合伙人不能改写不属于他发布事项的结论
        String cloudId = entries.findById(ra).orElseThrow().getCloudEntryId();
        assertThrows(IllegalArgumentException.class, () -> cloudService.execute(partner2, "billingCloudOutcome",
                Map.of("entries", List.of(Map.of("id", cloudId, "status", "APPROVED")))));

        // 律所关闭并删除云端数据
        act(partner, "cloudBillingEnable", Map.of("enabled", false, "purge", true));
        assertEquals(0, cloudEntries.count());
        assertNull(terms.findByIntakeId(intake.getId()).orElseThrow().getCloudMatterId());
        assertThrows(IllegalStateException.class, () -> act(lawyerA, "timeSubmit", Map.of("ids", List.of(save(lawyerA, "c:" + matterId, "1", "x")))));
    }
}
