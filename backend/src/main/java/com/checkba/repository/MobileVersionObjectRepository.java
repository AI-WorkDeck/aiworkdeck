// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository;

import com.checkba.model.entity.MobileVersionObject;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface MobileVersionObjectRepository extends JpaRepository<MobileVersionObject,Long> {
    List<MobileVersionObject> findByUserId(Long userId);
    List<MobileVersionObject> findByPendingDeletionTrue();
    List<MobileVersionObject> findByUserIdAndDeviceIdAndProjectKeyAndPartIndex(Long userId,String deviceId,String projectKey,int partIndex);
    List<MobileVersionObject> findByUserIdAndDeviceIdAndProjectKeyAndObjectShaOrderByPartIndex(
            Long userId,String deviceId,String projectKey,String objectSha);
    Optional<MobileVersionObject> findByUserIdAndDeviceIdAndProjectKeyAndObjectShaAndPartIndex(
            Long userId,String deviceId,String projectKey,String objectSha,int partIndex);
}
