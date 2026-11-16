// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.repository;

import com.checkba.model.entity.MobileProjectDir;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface MobileProjectDirRepository extends JpaRepository<MobileProjectDir, Long> {

    List<MobileProjectDir> findByUserIdOrderByUpdatedAtDesc(Long userId);

    List<MobileProjectDir> findByUserIdAndDeviceId(Long userId, String deviceId);

    void deleteByUserIdAndDeviceId(Long userId, String deviceId);

    long deleteByUserId(Long userId);
}
