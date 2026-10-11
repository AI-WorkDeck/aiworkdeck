// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository;
import com.checkba.model.entity.MobileFileBackup;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.*;
public interface MobileFileBackupRepository extends JpaRepository<MobileFileBackup,Long> {
    List<MobileFileBackup> findByUserId(Long userId);
    List<MobileFileBackup> findByUserIdAndDeviceIdAndProjectKey(Long userId,String deviceId,String projectKey);
    List<MobileFileBackup> findByPendingDeletionTrue();
    Optional<MobileFileBackup> findByUserIdAndDeviceIdAndProjectKeyAndFileId(Long userId,String deviceId,String projectKey,String fileId);
}
