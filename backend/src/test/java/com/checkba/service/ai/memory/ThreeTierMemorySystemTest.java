// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.memory;

import com.checkba.model.entity.MemoryEntry;
import com.checkba.model.entity.ProjectMemory;
import com.checkba.model.entity.UserMemory;
import com.checkba.repository.ConversationSummaryRepository;
import com.checkba.repository.MemoryEntryRepository;
import com.checkba.repository.ProjectMemoryRepository;
import com.checkba.repository.UserMemoryRepository;
import com.checkba.service.ai.context.ProjectContextHolder;
import com.checkba.service.ai.tools.MemoryTools;
import dev.langchain4j.data.embedding.Embedding;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.model.output.Response;
import dev.langchain4j.store.embedding.EmbeddingStore;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * AI WorkDeck 三级记忆架构（L1/L2/L3）与「开卡 → 工作 → 回写」条件触发协议测试。
 */
class ThreeTierMemorySystemTest {

    private MemoryEntryRepository memoryEntryRepository;
    private ProjectMemoryRepository projectMemoryRepository;
    private UserMemoryRepository userMemoryRepository;
    private MemoryManager memoryManager;
    private MemoryTools memoryTools;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        memoryEntryRepository = mock(MemoryEntryRepository.class);
        projectMemoryRepository = mock(ProjectMemoryRepository.class);
        userMemoryRepository = mock(UserMemoryRepository.class);
        EmbeddingStore<TextSegment> embeddingStore = (EmbeddingStore<TextSegment>) mock(EmbeddingStore.class);
        EmbeddingModel embeddingModel = mock(EmbeddingModel.class);
        when(embeddingModel.embed(anyString()))
                .thenReturn(Response.from(Embedding.from(new float[]{0.1f, 0.2f, 0.3f})));
        when(memoryEntryRepository.save(any(MemoryEntry.class))).thenAnswer(inv -> {
            MemoryEntry e = inv.getArgument(0);
            if (e.getId() == null) {
                e.setId(100L);
            }
            return e;
        });

        memoryManager = new MemoryManager(
                memoryEntryRepository,
                mock(ConversationSummaryRepository.class),
                projectMemoryRepository,
                userMemoryRepository,
                embeddingStore,
                embeddingModel);
        memoryTools = new MemoryTools(
                memoryManager,
                mock(ProjectMemoryExtractor.class),
                mock(AgenticRetriever.class));
    }

    @AfterEach
    void tearDown() {
        ProjectContextHolder.clear();
    }

    @Test
    @DisplayName("三级记忆路由：L1(conversation) / L2(project,file) / L3(user,global,team,firm) 与 preference 默认归入 user")
    void tierMappingAndDefaultScopeResolution() {
        assertEquals(MemoryTier.L1_WORKING_SESSION,
                MemoryTier.fromScopeAndType("conversation", "fact"));
        assertEquals(MemoryTier.L2_PROJECT_EPISODIC,
                MemoryTier.fromScopeAndType("project", "decision"));
        assertEquals(MemoryTier.L2_PROJECT_EPISODIC,
                MemoryTier.fromScopeAndType("file", "conclusion"));
        assertEquals(MemoryTier.L3_SEMANTIC_SHARED,
                MemoryTier.fromScopeAndType("user", "preference"));
        assertEquals(MemoryTier.L3_SEMANTIC_SHARED,
                MemoryTier.fromScopeAndType("global", "reference"));
        assertEquals(MemoryTier.L3_SEMANTIC_SHARED,
                MemoryTier.fromDocumentSpace("team"));
        assertEquals(MemoryTier.L3_SEMANTIC_SHARED,
                MemoryTier.fromDocumentSpace("firm"));

        // 未显式传 scope 时，preference 自动路由到 user（L3），其余路由到 project（L2）
        assertEquals(MemoryEntry.MemoryScope.USER,
                MemoryTier.resolveDefaultScope(null, "preference", 7L));
        assertEquals(MemoryEntry.MemoryScope.PROJECT,
                MemoryTier.resolveDefaultScope(null, "decision", 7L));
        // 显式传非法 scope 时仍回落 project（兼容既有契约）
        assertEquals(MemoryEntry.MemoryScope.PROJECT,
                MemoryTier.resolveDefaultScope("galaxy", "fact", 7L));
    }

    @Test
    @DisplayName("save_memory：未传 scope 且 type=preference 时自动归入 L3 user 作用域并同步 UserMemory")
    void savePreferenceWithoutExplicitScopeRoutesToUserTierAndSyncsUserMemory() {
        ProjectContextHolder.setUserId(7L);
        ProjectContextHolder.setProjectId("10");
        ProjectContextHolder.setConversationId("conv-1");
        when(userMemoryRepository.findByUserId(7L)).thenReturn(Optional.empty());

        String receipt = memoryTools.save_memory(
                "preference", "违约金表述", "违约金条款一律按日万分之五起草", false, null, null);

        assertTrue(receipt.contains("L3"), "回执应标明 L3 层级: " + receipt);
        assertTrue(receipt.contains("- 作用域: user"), "未传 scope 的 preference 应自动落入 user: " + receipt);

        ArgumentCaptor<MemoryEntry> entryCaptor = ArgumentCaptor.forClass(MemoryEntry.class);
        verify(memoryEntryRepository).save(entryCaptor.capture());
        assertEquals(MemoryEntry.MemoryScope.USER, entryCaptor.getValue().getScope());
        assertEquals(7L, entryCaptor.getValue().getUserId());

        ArgumentCaptor<UserMemory> userMemoryCaptor = ArgumentCaptor.forClass(UserMemory.class);
        verify(userMemoryRepository).save(userMemoryCaptor.capture());
        assertEquals("违约金条款一律按日万分之五起草",
                userMemoryCaptor.getValue().getPreferences().get("违约金表述"));
    }

    @Test
    @DisplayName("L3 同键覆写：同一用户的同 key 偏好更新时原位覆写，不产生重复行")
    void userPreferenceSameKeyUpdatesExistingRowInPlace() {
        MemoryEntry existing = MemoryEntry.builder()
                .id(42L)
                .userId(7L)
                .scope(MemoryEntry.MemoryScope.USER)
                .memoryType(MemoryEntry.MemoryType.PREFERENCE)
                .memoryKey("称谓习惯")
                .memoryValue("称呼王律师")
                .importanceScore(0.7)
                .build();
        existing.setUid("uid-pref-42");
        existing.setAccessCount(1);
        when(memoryEntryRepository.findByUserIdAndScope(eq(7L), eq(MemoryEntry.MemoryScope.USER), any()))
                .thenReturn(List.of(existing));

        MemoryEntry update = MemoryEntry.builder()
                .userId(7L)
                .scope(MemoryEntry.MemoryScope.USER)
                .memoryType(MemoryEntry.MemoryType.PREFERENCE)
                .memoryKey("称谓习惯")
                .memoryValue("称呼王主任")
                .importanceScore(0.8)
                .build();

        MemoryEntry saved = memoryManager.saveMemory(update);

        assertEquals(42L, saved.getId(), "应复用既有 L3 记忆行 ID");
        assertEquals("uid-pref-42", saved.getUid(), "应保留既有 uid 以便同步更新同一 Markdown 主题文件");
        assertEquals("称呼王主任", saved.getMemoryValue());
        assertEquals(2, saved.getAccessCount());
    }

    @Test
    @DisplayName("L2 防噪与核心卡联动：完全相同内容幂等复用；新内容保留证据账本时序并同步更新 ProjectMemory")
    void projectMemoryIdempotentDedupAndCoreCardConsolidation() {
        MemoryEntry existing = MemoryEntry.builder()
                .id(55L)
                .projectId(10L)
                .scope(MemoryEntry.MemoryScope.PROJECT)
                .memoryType(MemoryEntry.MemoryType.FACT)
                .memoryKey("标的公司")
                .memoryValue("星辰大海科技有限公司")
                .isProtected(false)
                .importanceScore(0.7)
                .build();
        existing.setAccessCount(0);
        when(memoryEntryRepository.findByProjectIdAndMemoryKeyIn(eq(10L), any()))
                .thenReturn(List.of(existing));

        ProjectMemory pm = ProjectMemory.builder().projectId(10L).build();
        when(projectMemoryRepository.findByProjectId(10L)).thenReturn(Optional.of(pm));

        // 1. 完全相同的 (scope, key, value) 重复保存 → 复用 ID=55，不制造重复噪音
        MemoryEntry duplicateCall = MemoryEntry.builder()
                .projectId(10L)
                .scope(MemoryEntry.MemoryScope.PROJECT)
                .memoryType(MemoryEntry.MemoryType.FACT)
                .memoryKey("标的公司")
                .memoryValue("星辰大海科技有限公司")
                .isProtected(true)
                .importanceScore(1.0)
                .build();
        MemoryEntry deduped = memoryManager.saveMemory(duplicateCall);
        assertEquals(55L, deduped.getId(), "完全相同的项目记忆应幂等复用原记录");
        assertTrue(deduped.getIsProtected(), "重复保存升级保护标记时应生效");
        assertEquals("星辰大海科技有限公司", pm.getTargetCompany(), "应自动同步到 ProjectMemory.targetCompany");

        // 2. 写入关键决策与法规引用 → 自动聚合进 ProjectMemory 核心上下文
        MemoryEntry decision = MemoryEntry.builder()
                .projectId(10L)
                .scope(MemoryEntry.MemoryScope.PROJECT)
                .memoryType(MemoryEntry.MemoryType.DECISION)
                .memoryKey("交割安排")
                .memoryValue("采用分两期交割，首期支付 60%")
                .isProtected(true)
                .importanceScore(1.0)
                .build();
        memoryManager.saveMemory(decision);

        MemoryEntry legalRef = MemoryEntry.builder()
                .projectId(10L)
                .scope(MemoryEntry.MemoryScope.PROJECT)
                .memoryType(MemoryEntry.MemoryType.REFERENCE)
                .memoryKey("《公司法》第84条")
                .memoryValue("股东对外转让股权通知与优先购买权规定")
                .isProtected(true)
                .importanceScore(1.0)
                .build();
        memoryManager.saveMemory(legalRef);

        String coreContext = pm.toCoreContext();
        assertTrue(coreContext.contains("星辰大海科技有限公司"), coreContext);
        assertTrue(coreContext.contains("交割安排: 采用分两期交割，首期支付 60%"), coreContext);
        assertTrue(coreContext.contains("《公司法》第84条"), coreContext);
    }

    @Test
    @DisplayName("retrieveUserMemories：过滤 remember.md 派生索引行、按 key 去重并剥离 legacy frontmatter")
    void retrieveUserMemoriesFiltersIndexAndDeduplicatesAndCleansFrontmatter() {
        MemoryEntry indexRow = MemoryEntry.builder()
                .id(1L).userId(7L).scope(MemoryEntry.MemoryScope.USER)
                .memoryKey("个人记忆")
                .memoryValue("# 个人记忆\n\n<!-- memory-topics:start -->\n<!-- memory-topics:end -->")
                .metadata(Map.of("documentPath", "remember.md"))
                .build();
        MemoryEntry newestStyle = MemoryEntry.builder()
                .id(3L).userId(7L).scope(MemoryEntry.MemoryScope.USER)
                .memoryKey("行文风格")
                .memoryValue("---\nsource: legacy-memory-entry\nuid: u-3\ntype: preference\nprotected: false\n---\n\n# 行文风格\n\n偏好条款式、禁用感叹号")
                .build();
        MemoryEntry staleStyle = MemoryEntry.builder()
                .id(2L).userId(7L).scope(MemoryEntry.MemoryScope.USER)
                .memoryKey("行文风格")
                .memoryValue("旧行文风格")
                .build();

        when(memoryEntryRepository.findByUserIdAndScope(eq(7L), eq(MemoryEntry.MemoryScope.USER), any()))
                .thenReturn(List.of(indexRow, newestStyle, staleStyle));

        List<MemoryEntry> result = memoryManager.retrieveUserMemories(7L, 5);

        assertEquals(1, result.size(), "remember.md 索引行与同 key 旧记录应被过滤");
        assertEquals(3L, result.get(0).getId());
        assertEquals("偏好条款式、禁用感叹号",
                MemoryManager.cleanMemoryValue(result.get(0).getMemoryValue()));
    }

    @Test
    @DisplayName("中英基底系统提示词均明确包含三级记忆（L1/L2/L3）、「如果……则……」条件读写协议与开卡→工作→回写闭环")
    void systemPromptsContainThreeTierMemoryAndConditionalWritebackProtocol() throws Exception {
        String zh = Files.readString(Path.of("src/main/resources/prompts/system_prompt.md"), StandardCharsets.UTF_8);
        String en = Files.readString(Path.of("src/main/resources/prompts/system_prompt.en.md"), StandardCharsets.UTF_8);

        for (String token : List.of("L1", "L2", "L3", "如果", "读取判据", "写入判据", "证据分级与防噪纪律", "开卡 → 工作 → 回写闭环")) {
            assertTrue(zh.contains(token), "中文系统提示词缺少三级记忆/条件回写关键规则: " + token);
        }
        for (String token : List.of("L1", "L2", "L3", "When to Read", "When to Write", "Evidence Grading & Anti-Noise Discipline", "Plan -> Execute -> Writeback")) {
            assertTrue(en.contains(token), "英文系统提示词缺少三级记忆/条件回写关键规则: " + token);
        }
    }
}
