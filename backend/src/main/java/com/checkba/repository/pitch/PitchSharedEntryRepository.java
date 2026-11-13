// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository.pitch;

import com.checkba.model.entity.pitch.PitchSharedEntry;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PitchSharedEntryRepository extends JpaRepository<PitchSharedEntry, String> {
    Optional<PitchSharedEntry> findByFirmIdAndOwnerUserIdAndLocalId(String firmId, Long ownerUserId, String localId);
    List<PitchSharedEntry> findByFirmIdAndOwnerUserId(String firmId, Long ownerUserId);
    List<PitchSharedEntry> findByFirmIdAndWithdrawnAtIsNull(String firmId);
    long deleteByFirmId(String firmId);
}
