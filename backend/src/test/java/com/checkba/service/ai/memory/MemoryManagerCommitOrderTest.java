// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.memory;

import com.checkba.model.entity.ProjectMemory;
import com.checkba.repository.ProjectMemoryRepository;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.store.embedding.EmbeddingStore;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 进程内锁必须覆盖事务提交：锁在方法体内释放、@Transactional 代理在方法返回后才提交时，
 * 后到的线程读不到「还没提交的行」而再次 INSERT，撞上 unique(project_id)。
 * 真实 H2 + 真实事务管理器；多项目多轮次放大窗口。
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:memory-commit-order-test;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
        "spring.jpa.hibernate.ddl-auto=create-drop"
})
@Import(MemoryManager.class)
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class MemoryManagerCommitOrderTest {

    @MockBean(name = "memoryEmbeddingStore")
    private EmbeddingStore<TextSegment> memoryEmbeddingStore;
    @MockBean
    private EmbeddingModel embeddingModel;

    @Autowired
    private MemoryManager memoryManager;
    @Autowired
    private ProjectMemoryRepository projectMemoryRepository;

    @Test
    void concurrentFirstWritesForTheSameProjectNeverHitTheUniqueConstraint() throws Exception {
        int threads = 8;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        try {
            for (long projectId = 9000; projectId < 9040; projectId++) {
                final long pid = projectId;
                CountDownLatch go = new CountDownLatch(1);
                List<Future<?>> futures = new ArrayList<>();
                for (int t = 0; t < threads; t++) {
                    final int n = t;
                    futures.add(pool.submit(() -> {
                        go.await();
                        if (n % 2 == 0) {
                            memoryManager.saveProjectMemory(
                                    ProjectMemory.builder().projectId(pid).projectName("p" + n).build());
                        } else {
                            memoryManager.updateProjectField(pid, "projecttype", "t" + n);
                        }
                        return null;
                    }));
                }
                go.countDown();
                for (Future<?> f : futures) {
                    f.get(); // 任何线程的 DataIntegrityViolationException 在此抛出
                }
                assertEquals(1, projectMemoryRepository.findAll().stream()
                        .filter(pm -> pid == pm.getProjectId()).count(), "每个项目恰好一行");
            }
        } finally {
            pool.shutdownNow();
        }
        assertTrue(projectMemoryRepository.count() >= 40);
    }
}
