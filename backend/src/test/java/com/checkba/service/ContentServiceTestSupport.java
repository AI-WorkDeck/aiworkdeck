// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.mobile.CloudStorageQuotaService;
import com.checkba.storage.ProjectStorageResolver;
import com.checkba.storage.StorageServiceFactory;
import com.checkba.version.WorkSessionService;
import jakarta.persistence.EntityManager;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;
import java.util.function.Supplier;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Unit fixtures execute real content coordination; real JPA behavior is tested separately. */
public final class ContentServiceTestSupport {
    private ContentServiceTestSupport() {}
    public static ProjectFileContentService create(ProjectFileRepository files, StorageServiceFactory factory,
            ProjectMemberService members, ProjectFileAccessService access, ProjectStorageResolver resolver,
            WorkSessionService sessions) {
        if (mockingDetails(sessions).isMock() && !mockingDetails(sessions).isSpy()) {
            lenient().when(sessions.withFileContentWriteLock(anyLong(), any())).thenAnswer(i -> ((Supplier<?>) i.getArgument(1)).get());
        }
        lenient().when(files.updateContentMetadataIfCurrent(any(), any(), anyString(), nullable(Long.class), any())).thenReturn(1);
        var service = new ProjectFileContentService(files, factory, members, access, resolver, sessions,
                new AbstractPlatformTransactionManager() {
                    protected Object doGetTransaction() { return new Object(); }
                    protected void doBegin(Object transaction, TransactionDefinition definition) {}
                    protected void doCommit(DefaultTransactionStatus status) {}
                    protected void doRollback(DefaultTransactionStatus status) {}
                }, mock(CloudStorageQuotaService.class));
        ReflectionTestUtils.setField(service, "entityManager", mock(EntityManager.class));
        return service;
    }
}
