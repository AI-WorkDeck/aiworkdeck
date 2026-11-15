// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.repository.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.*;

/** PostgreSQL @Lob (oid) columns fail with "Unable to access lob stream" when read outside a transaction. */
class MobileMediaMoveAdvanceTxTest {
    @Test void scheduledScanReadsMovesInsideATransaction() {
        var begun=new int[1];
        var manager=new AbstractPlatformTransactionManager() {
            @Override protected Object doGetTransaction() {return new Object();}
            @Override protected void doBegin(Object t,org.springframework.transaction.TransactionDefinition d) {begun[0]++;}
            @Override protected void doCommit(DefaultTransactionStatus s) {}
            @Override protected void doRollback(DefaultTransactionStatus s) {}
        };
        var moves=mock(MobileMediaMoveRepository.class);
        var inTx=new boolean[1];
        when(moves.findByStatusIn(anyCollection())).thenAnswer(i->{inTx[0]=TransactionSynchronizationManager.isActualTransactionActive();return List.of();});
        var service=new MobileMediaMoveService(moves,null,null,null,null,null,null,null,null,new ObjectMapper(),manager);
        service.advanceCloudMoves();
        assertTrue(inTx[0],"findByStatusIn must run in a transaction (LOB columns)");
        assertEquals(1,begun[0]);
    }
}
