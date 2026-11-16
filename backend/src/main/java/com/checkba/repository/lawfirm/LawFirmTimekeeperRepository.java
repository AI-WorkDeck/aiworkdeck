// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.repository.lawfirm;

import com.checkba.model.entity.lawfirm.LawFirmTimekeeper;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface LawFirmTimekeeperRepository extends JpaRepository<LawFirmTimekeeper, Long> {

    Optional<LawFirmTimekeeper> findByUserId(Long userId);
}
