// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository;
import com.checkba.model.entity.MobileAssistantConsent;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.*;

public interface MobileAssistantConsentRepository extends JpaRepository<MobileAssistantConsent,Long> {
    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @org.springframework.data.jpa.repository.Query("select c from MobileAssistantConsent c where c.userId=:userId")
    Optional<MobileAssistantConsent> lockByUserId(@org.springframework.data.repository.query.Param("userId") Long userId);
    interface AccessState { boolean getEnabled(); long getRevision(); String getConsentVersion(); }
    @org.springframework.data.jpa.repository.Query("select c.enabled as enabled,c.revision as revision,c.consentVersion as consentVersion from MobileAssistantConsent c where c.userId=:userId")
    Optional<AccessState> accessState(@org.springframework.data.repository.query.Param("userId") Long userId);
    @org.springframework.data.jpa.repository.Query("select u.fileCloudBackupEnabled from User u where u.id=:userId")
    Boolean backupEnabled(@org.springframework.data.repository.query.Param("userId") Long userId);
}
