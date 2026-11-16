// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.repository.lawfirm;

import com.checkba.model.entity.lawfirm.LawFirmCollection;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface LawFirmCollectionRepository extends JpaRepository<LawFirmCollection, Long> {

    List<LawFirmCollection> findAllByOrderByCreatedAtDescIdDesc();

    Optional<LawFirmCollection> findByCollectionNo(String collectionNo);

    List<LawFirmCollection> findByInvoiceIdOrderByCreatedAtDescIdDesc(Long invoiceId);

    List<LawFirmCollection> findByIntakeIdOrderByCreatedAtDescIdDesc(Long intakeId);
}
