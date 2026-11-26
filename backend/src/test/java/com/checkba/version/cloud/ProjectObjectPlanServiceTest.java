// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version.cloud;

import com.checkba.model.entity.Project;
import com.checkba.model.entity.ProjectObjectPlan;
import com.checkba.repository.ProjectObjectPlanRepository;
import com.checkba.repository.ProjectRepository;
import com.checkba.version.objects.LocalVersionObjectStore.ObjectRef;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.*;

import static org.junit.jupiter.api.Assertions.*;

/** C12 server: free allowance per file and per matter (lifetime, atomic), local-only declarations. */
@DataJpaTest(showSql = false, properties = {
        "spring.datasource.url=jdbc:h2:mem:object-plan;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "collab.objects.free-per-file-bytes=100",
        "collab.objects.free-per-project-bytes=250"
})
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import(ProjectObjectPlanService.class)
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class ProjectObjectPlanServiceTest {
    @Autowired ProjectObjectPlanService service;
    @Autowired ProjectObjectPlanRepository plans;
    @Autowired ProjectRepository projects;
    long project;

    static ObjectRef obj(char c, long size) { return new ObjectRef(String.valueOf(c).repeat(64), size); }

    @BeforeEach void setup() {
        plans.deleteAll();
        Project p = new Project(); p.setName("C12"); p.setProjectType("TEST"); p.setUserId(1L);
        p.setListedCompanyName(""); p.setTargetCompanyName("");
        project = projects.save(p).getId();
    }

    @Test void freeAcceptedAtExactlyThePerFileLimitAndRefusedOneByteOver() {
        service.reserveFree(project, obj('a', 100));
        var refused = assertThrows(ProjectObjectPlanService.FreeLimitException.class, () -> service.reserveFree(project, obj('b', 101)));
        assertEquals("FREE_LIMIT", refused.body().get("code"));
        assertEquals(100L, refused.body().get("freePerFileBytes"));
        assertEquals(100L, refused.body().get("projectFreeUsedBytes"));
        assertTrue(plans.findByProjectIdAndObjectSha(project, "b".repeat(64)).isEmpty(), "nothing stored on refusal");
    }

    @Test void projectCapIsLifetimeAndARepeatCountsOnce() {
        service.reserveFree(project, obj('a', 100));
        service.reserveFree(project, obj('a', 100)); // same object again: idempotent
        service.reserveFree(project, obj('b', 100));
        assertEquals(200, service.projectFreeUsedBytes(project));
        assertThrows(ProjectObjectPlanService.FreeLimitException.class, () -> service.reserveFree(project, obj('c', 51)));
        service.reserveFree(project, obj('c', 50));
        assertEquals(250, service.projectFreeUsedBytes(project));
        service.markComplete(project, obj('a', 100));
        assertEquals(250, service.projectFreeUsedBytes(project), "completing never gives free bytes back");
        assertEquals(100, service.completedFreeBytes(project));
    }

    @Test void concurrentReservationsNeverExceedTheMatterCap() throws Exception {
        var pool = Executors.newFixedThreadPool(6);
        List<Future<Boolean>> results = new ArrayList<>();
        for (char c = 'a'; c <= 'f'; c++) {
            final char id = c;
            results.add(pool.submit(() -> {
                try { service.reserveFree(project, obj(id, 90)); return true; }
                catch (ProjectObjectPlanService.FreeLimitException e) { return false; }
            }));
        }
        int accepted = 0;
        for (var r : results) if (r.get(20, TimeUnit.SECONDS)) accepted++;
        pool.shutdown();
        assertEquals(2, accepted, "250 bytes fit two 90-byte objects, never three");
        assertEquals(180, service.projectFreeUsedBytes(project));
    }

    @Test void staleReservationsAreReleasedAfter24Hours() {
        service.reserveFree(project, obj('a', 100));
        service.reserveFree(project, obj('b', 100));
        var stale = plans.findByProjectIdAndObjectSha(project, "a".repeat(64)).orElseThrow();
        stale.setReservedAt(LocalDateTime.now().minusHours(25));
        plans.save(stale);
        assertEquals(100, service.projectFreeUsedBytes(project));
        service.reserveFree(project, obj('c', 100)); // fits again once the stale one is gone
    }

    @Test void localOnlyDeclarationIsIdempotentSizeCheckedAndClearedOnArrival() {
        ObjectRef video = obj('e', 70_000_000L);
        service.declareLocalOnly(project, video, 5L, "证据/庭审录像.mp4");
        service.declareLocalOnly(project, video, 5L, "证据/庭审录像.mp4");
        assertEquals(1, service.localOnly(project).size());
        assertEquals("庭审录像.mp4", service.localOnly(project).get(0).getNameHint(), "basename only, never the folder");
        assertTrue(service.isDeclaredLocalOnly(project, video));
        assertFalse(service.isDeclaredLocalOnly(project, obj('e', 1)), "declared size must match the pointer");
        assertThrows(IllegalArgumentException.class, () -> service.declareLocalOnly(project, obj('e', 1), 5L, "x.mp4"));
        service.markComplete(project, video);
        assertFalse(service.isDeclaredLocalOnly(project, video), "arrival clears the declaration");
        assertTrue(plans.findByProjectIdAndObjectSha(project, "e".repeat(64)).isEmpty(), "no plan row invented for a paid/legacy arrival");
    }

    @Test void nameHintIsASanitisedBasename() {
        assertEquals("录像.mp4", ProjectObjectPlanService.nameHint("a/b\\c/录像.mp4"));
        assertNull(ProjectObjectPlanService.nameHint("../.."));
        assertEquals(200, ProjectObjectPlanService.nameHint("x".repeat(300)).length());
        assertEquals("ab", ProjectObjectPlanService.nameHint("a\u0000b"));
    }

    @Test void aPlanRowIsFreeOrPaidOnly() {
        service.reserveFree(project, obj('a', 10));
        assertEquals(ProjectObjectPlan.FREE, plans.findByProjectIdAndObjectSha(project, "a".repeat(64)).orElseThrow().getPlan());
    }

    /** W review must-fix 2: a resumed upload more than 24 h after its first part is still free. */
    @Test void aResumedFreeUploadKeepsItsReservationAndCompletesFree() {
        service.reserveFree(project, obj('a', 100));
        var row = plans.findByProjectIdAndObjectSha(project, "a".repeat(64)).orElseThrow();
        row.setReservedAt(LocalDateTime.now().minusHours(25));
        plans.save(row);
        service.reserveFree(project, obj('a', 100)); // the next part arrives: the reservation is refreshed, not lost
        assertEquals(100, service.projectFreeUsedBytes(project), "still reserved after the sweep");
        service.markComplete(project, obj('a', 100));
        assertEquals(100, service.completedFreeBytes(project));
    }

    @Test void aSweptReservationIsRecordedFreeAtComplete() {
        service.reserveFree(project, obj('b', 100));
        plans.deleteAll(); // swept before complete
        service.markCompleteFree(project, obj('b', 100));
        assertEquals(100, service.completedFreeBytes(project), "never billed through the object store usage");
        assertTrue(service.isFreePlan(project, obj('b', 100)));
    }

    @Test void laterPartsOfAFreeObjectAreFree() {
        assertFalse(service.isFreePlan(project, obj('c', 100)));
        service.reserveFree(project, obj('c', 100));
        assertTrue(service.isFreePlan(project, obj('c', 100)));
        assertFalse(service.isFreePlan(project, obj('c', 99)), "size must match");
    }
}

