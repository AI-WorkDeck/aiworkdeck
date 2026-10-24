// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import org.junit.jupiter.api.Test;
import org.springframework.boot.availability.ApplicationAvailability;
import org.springframework.boot.availability.ReadinessState;
import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class DesktopHealthControllerTest {
    private ApplicationAvailability ready() {
        var availability = mock(ApplicationAvailability.class);
        when(availability.getReadinessState()).thenReturn(ReadinessState.ACCEPTING_TRAFFIC);
        return availability;
    }

    @Test
    void refusesTrafficWithoutTouchingDatabaseBeforeStartupOrDuringShutdown() {
        DataSource ds = mock(DataSource.class);
        var availability = mock(ApplicationAvailability.class);
        when(availability.getReadinessState()).thenReturn(ReadinessState.REFUSING_TRAFFIC);
        var response = new DesktopHealthController(ds, availability).health();
        assertEquals(503, response.getStatusCode().value());
        assertEquals(Map.of("status", "DOWN"), response.getBody());
        verifyNoInteractions(ds);
    }

    @Test
    void realExhaustedPoolReturnsUnavailableWithinAcquisitionTimeout() throws Exception {
        try (var pool = new com.zaxxer.hikari.HikariDataSource()) {
            pool.setJdbcUrl("jdbc:h2:mem:desktop-health-pool");
            pool.setMaximumPoolSize(1);
            pool.setConnectionTimeout(250);
            var controller = new DesktopHealthController(pool, ready());
            assertEquals(200, controller.health().getStatusCode().value());
            try (Connection held = pool.getConnection()) {
                assertTimeoutPreemptively(java.time.Duration.ofSeconds(2), () ->
                        assertEquals(503, controller.health().getStatusCode().value()));
                assertFalse(held.isClosed());
            }
            assertEquals(200, controller.health().getStatusCode().value());
        }
    }

    @Test
    void checksDatabaseAndClosesResources() throws Exception {
        DataSource ds = mock(DataSource.class);
        Connection connection = mock(Connection.class);
        Statement statement = mock(Statement.class);
        ResultSet rows = mock(ResultSet.class);
        when(ds.getConnection()).thenReturn(connection);
        when(connection.createStatement()).thenReturn(statement);
        when(statement.executeQuery("SELECT 1")).thenReturn(rows);
        when(rows.next()).thenReturn(true);
        when(rows.getInt(1)).thenReturn(1);
        var response = new DesktopHealthController(ds, ready()).health();
        assertEquals(200, response.getStatusCode().value());
        assertEquals("UP", response.getBody().get("status"));
        verify(statement).setQueryTimeout(1);
        verify(rows).close();
        verify(statement).close();
        verify(connection).close();
    }

    @Test
    void exhaustedPoolIsUnavailableWithoutLeakingDetails() throws Exception {
        DataSource ds = mock(DataSource.class);
        when(ds.getConnection()).thenThrow(new SQLException("private database details"));
        var response = new DesktopHealthController(ds, ready()).health();
        assertEquals(503, response.getStatusCode().value());
        assertEquals(Map.of("status", "DOWN"), response.getBody());
    }

    @Test
    void failedQueryClosesBorrowedConnection() throws Exception {
        DataSource ds = mock(DataSource.class);
        Connection connection = mock(Connection.class);
        Statement statement = mock(Statement.class);
        when(ds.getConnection()).thenReturn(connection);
        when(connection.createStatement()).thenReturn(statement);
        when(statement.executeQuery("SELECT 1")).thenThrow(new SQLException("timed out"));
        assertEquals(503, new DesktopHealthController(ds, ready()).health().getStatusCode().value());
        verify(statement).close();
        verify(connection).close();
    }
}
