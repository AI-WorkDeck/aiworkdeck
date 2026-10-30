// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository;

import com.checkba.model.entity.MobileCaptureOrganization;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;

public interface MobileCaptureOrganizationRepository extends JpaRepository<MobileCaptureOrganization,Long> {
    Optional<MobileCaptureOrganization> findByUserIdAndClientMediaId(Long userId,String clientMediaId);
    long deleteByUserId(Long userId);
}
