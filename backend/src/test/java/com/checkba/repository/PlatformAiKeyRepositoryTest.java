// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository;

import com.checkba.model.entity.PlatformAiKey;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.TestPropertySource;
import java.time.LocalDateTime;
import static org.junit.jupiter.api.Assertions.*;

@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:platform-key-conditional-test;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect", "spring.jpa.hibernate.ddl-auto=create-drop"
})
class PlatformAiKeyRepositoryTest {
    @Autowired private PlatformAiKeyRepository repository;

    @Test void delayedResponsesCannotDeleteOrVerifyTheReplacementKeyOrAnotherUser() {
        LocalDateTime originalTime = LocalDateTime.of(2026, 10, 1, 0, 0);
        LocalDateTime responseTime = originalTime.plusDays(1);
        PlatformAiKey key = new PlatformAiKey();
        key.setUserId(71L); key.setKeyEnc("synthetic-encrypted"); key.setKeyFingerprint("old-fp");
        key.setFetchedAt(originalTime); key.setLastVerifiedAt(originalTime);
        repository.saveAndFlush(key);
        key.setKeyFingerprint("new-fp"); repository.saveAndFlush(key); // Rotation before the old request completes.

        assertEquals(0, repository.deleteMatchingKey(71L, "old-fp"));
        assertEquals(0, repository.verifyMatchingKey(71L, "old-fp", responseTime));
        assertEquals(0, repository.deleteMatchingKey(72L, "new-fp"));
        assertEquals(0, repository.verifyMatchingKey(72L, "new-fp", responseTime));
        assertEquals(originalTime, repository.findByUserId(71L).orElseThrow().getLastVerifiedAt());
        assertEquals("new-fp", repository.findByUserId(71L).orElseThrow().getKeyFingerprint());
        assertEquals(1, repository.verifyMatchingKey(71L, "new-fp", responseTime));
        assertEquals(responseTime, repository.findByUserId(71L).orElseThrow().getLastVerifiedAt());
        assertEquals(1, repository.deleteMatchingKey(71L, "new-fp"));
        assertTrue(repository.findByUserId(71L).isEmpty());
    }
}
