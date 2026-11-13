// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository.lawfirm;
import com.checkba.model.entity.lawfirm.LawFirmCloudTimeEntry;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
public interface LawFirmCloudTimeEntryRepository extends JpaRepository<LawFirmCloudTimeEntry,String> {
    Optional<LawFirmCloudTimeEntry> findByFirmIdAndLawyerIdAndClientKey(String firmId,Long lawyerId,String clientKey);
    List<LawFirmCloudTimeEntry> findByFirmIdAndLawyerIdOrderByWorkDateDesc(String firmId,Long lawyerId,Pageable page);
    List<LawFirmCloudTimeEntry> findByMatterIdInAndStatusInOrderBySubmittedAtAsc(Collection<String> matterIds,Collection<String> statuses,Pageable page);
    long deleteByFirmId(String firmId);
}
