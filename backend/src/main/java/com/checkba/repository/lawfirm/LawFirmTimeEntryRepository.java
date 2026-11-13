// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.repository.lawfirm;

import com.checkba.model.entity.lawfirm.LawFirmTimeEntry;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface LawFirmTimeEntryRepository extends JpaRepository<LawFirmTimeEntry, Long> {

    List<LawFirmTimeEntry> findByUserIdAndWorkDateBetweenOrderByWorkDateDescIdDesc(Long userId, LocalDate from, LocalDate to);

    List<LawFirmTimeEntry> findByWorkDateBetweenOrderByWorkDateAscIdAsc(LocalDate from, LocalDate to);

    List<LawFirmTimeEntry> findByBillId(Long billId);

    List<LawFirmTimeEntry> findByBillIdIn(Collection<Long> billIds);

    Optional<LawFirmTimeEntry> findByUserIdAndSourceKey(Long userId, String sourceKey);
}
