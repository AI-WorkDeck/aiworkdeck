// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository.pitch;

import com.checkba.model.entity.pitch.PitchEntryUse;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PitchEntryUseRepository extends JpaRepository<PitchEntryUse, Long> {
    List<PitchEntryUse> findByFirmIdAndEntryIdOrderByUsedAtDesc(String firmId, String entryId);
    long countByFirmIdAndEntryId(String firmId, String entryId);
    List<PitchEntryUse> findByFirmIdAndEntryIdIn(String firmId, Collection<String> entryIds);
    long deleteByFirmId(String firmId);
}
