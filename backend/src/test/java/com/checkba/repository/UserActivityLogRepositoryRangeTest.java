// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.repository;

import com.checkba.model.entity.UserActivityLog;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.TestPropertySource;

import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.assertEquals;

@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:activity-log-retention-test;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
        "spring.jpa.hibernate.ddl-auto=create-drop"
})
class UserActivityLogRepositoryRangeTest {

    @Autowired
    private UserActivityLogRepository repository;

    @Test
    void retentionDeleteRemovesOnlyRowsBeyond180Days() {
        UserActivityLog old = new UserActivityLog();
        old.setUserId(7L);
        old.setActionType("mobile_assistant_content");
        repository.saveAndFlush(old);
        old.setTimestamp(LocalDateTime.now().minusDays(181));
        repository.saveAndFlush(old);

        UserActivityLog recent = new UserActivityLog();
        recent.setUserId(7L);
        recent.setActionType("mobile_assistant_content");
        repository.saveAndFlush(recent);

        long removed = repository.deleteByTimestampBefore(LocalDateTime.now().minusDays(180));
        repository.flush();

        assertEquals(1, removed);
        assertEquals(1, repository.count());
        assertEquals(7L, repository.findAll().get(0).getUserId());
    }
}
