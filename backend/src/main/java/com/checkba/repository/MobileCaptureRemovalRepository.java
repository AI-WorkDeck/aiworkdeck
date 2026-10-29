// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository;
import com.checkba.model.entity.MobileCaptureRemoval;
import org.springframework.data.jpa.repository.JpaRepository;
public interface MobileCaptureRemovalRepository extends JpaRepository<MobileCaptureRemoval,Long> {
    java.util.Optional<MobileCaptureRemoval> findByAccountScopeAndRequestId(String accountScope,String requestId);
    long deleteByAccountScope(String accountScope);
}
