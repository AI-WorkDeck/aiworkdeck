// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.repository;

import com.checkba.model.entity.HarnessEvolutionEntry;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface HarnessEvolutionEntryRepository extends JpaRepository<HarnessEvolutionEntry, String> {
    List<HarnessEvolutionEntry> findTop200ByUserIdOrderByCreatedAtDesc(Long userId);

    List<HarnessEvolutionEntry> findByConversationIdOrderByCreatedAtDesc(String conversationId);
}
