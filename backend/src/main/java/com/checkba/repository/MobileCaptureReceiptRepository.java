// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository;
import com.checkba.model.entity.MobileCaptureReceipt;
import org.springframework.data.jpa.repository.JpaRepository;
public interface MobileCaptureReceiptRepository extends JpaRepository<MobileCaptureReceipt,Long> {
    java.util.Optional<MobileCaptureReceipt> findByUserIdAndClientMediaId(Long userId,String clientMediaId);
    java.util.List<MobileCaptureReceipt> findByUserId(Long userId);
    long deleteByUserId(Long userId);
}
