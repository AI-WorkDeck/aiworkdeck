// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository;
import com.checkba.model.entity.MobileProjectSummary;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.*;

public interface MobileProjectSummaryRepository extends JpaRepository<MobileProjectSummary,Long> {
    Optional<MobileProjectSummary> findByUserIdAndDeviceIdAndProjectKey(Long userId,String deviceId,String projectKey);
    List<MobileProjectSummary> findByUserIdOrderByUpdatedAtDesc(Long userId);
    void deleteByUserId(Long userId);
    void deleteByUserIdAndDeviceIdAndProjectKey(Long userId,String deviceId,String projectKey);
    @org.springframework.data.jpa.repository.Query("select s.updatedAt from MobileProjectSummary s where s.id=:id and s.userId=:userId")
    Optional<java.time.Instant> currentRevision(@org.springframework.data.repository.query.Param("id") Long id,@org.springframework.data.repository.query.Param("userId") Long userId);
    interface BackupSource { String getUid(); String getName(); String getPath(); String getSha256(); Long getSize(); }
    @org.springframework.data.jpa.repository.Query("select f.uid as uid,f.name as name,f.path as path,f.sha256 as sha256,f.size as size from MobileFileBackup f where f.userId=:userId and f.deviceId=:deviceId and f.projectKey=:projectKey and f.pendingDeletion=false order by f.uid")
    List<BackupSource> currentSources(@org.springframework.data.repository.query.Param("userId") Long userId,@org.springframework.data.repository.query.Param("deviceId") String deviceId,@org.springframework.data.repository.query.Param("projectKey") String projectKey);
}
