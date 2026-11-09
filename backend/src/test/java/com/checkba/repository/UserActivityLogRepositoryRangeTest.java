// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.repository;

import com.checkba.model.entity.UserActivityLog;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.context.TestPropertySource;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** 工作记录按日期范围查（dev-board#1713）：派生查询真跑一遍，范围与条数上限都生效。 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:activity-log-range-test;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
        "spring.jpa.hibernate.ddl-auto=create-drop"
})
class UserActivityLogRepositoryRangeTest {

    @Autowired
    private UserActivityLogRepository repository;

    private void save(long userId) {
        UserActivityLog l = new UserActivityLog();
        l.setUserId(userId);
        l.setActionType("OPEN_FILE");
        l.setTargetName("a.docx");
        l.setDuration(1000L);
        repository.saveAndFlush(l);
    }

    @Test
    void rangeAndLimitApply() {
        save(7L);
        save(7L);
        save(7L);
        save(8L);
        LocalDate today = LocalDate.now();

        List<UserActivityLog> todayRows = repository
                .findByUserIdAndTimestampGreaterThanEqualAndTimestampLessThanOrderByTimestampDesc(
                        7L, today.atStartOfDay(), today.plusDays(1).atStartOfDay(), PageRequest.of(0, 2));
        assertEquals(2, todayRows.size());

        List<UserActivityLog> yesterdayRows = repository
                .findByUserIdAndTimestampGreaterThanEqualAndTimestampLessThanOrderByTimestampDesc(
                        7L, today.minusDays(1).atStartOfDay(), today.atStartOfDay(), PageRequest.of(0, 10));
        assertEquals(0, yesterdayRows.size());
    }

    @Test
    void retentionDeleteRemovesOnlyRowsBeyond180Days() {
        save(7L);
        UserActivityLog old = repository.findAll().get(0);
        old.setTimestamp(LocalDateTime.now().minusDays(181));
        repository.saveAndFlush(old);
        save(7L);

        long removed = repository.deleteByTimestampBefore(LocalDateTime.now().minusDays(180));
        repository.flush();

        assertEquals(1, removed);
        assertEquals(1, repository.count());
        assertEquals(7L, repository.findAll().get(0).getUserId());
    }
}
