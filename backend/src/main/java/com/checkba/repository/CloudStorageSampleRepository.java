// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.repository;
import com.checkba.model.entity.CloudStorageSample;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
public interface CloudStorageSampleRepository extends JpaRepository<CloudStorageSample,Long> {
    List<CloudStorageSample> findByUserIdOrderByObservedAtAscIdAsc(Long userId);
}
