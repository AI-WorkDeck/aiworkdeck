// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.repository;

import com.checkba.model.entity.UserFeedback;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.boot.autoconfigure.orm.jpa.HibernateJpaAutoConfiguration;
import org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration;
import org.springframework.boot.autoconfigure.jdbc.DataSourceTransactionManagerAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class UserFeedbackVersionMigrationTest {

    @EntityScan(basePackageClasses = UserFeedback.class)
    static class EntityConfig {}

    @Test
    void schemaUpdateBackfillsVersionForExistingFeedbackRows() throws Exception {
        String url = "jdbc:h2:mem:feedback-version-migration;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1";
        JdbcDataSource dataSource = new JdbcDataSource();
        dataSource.setURL(url);
        dataSource.setUser("sa");
        try (Connection connection = dataSource.getConnection();
             Statement statement = connection.createStatement()) {
            statement.execute("create table user_feedback (id bigint primary key, kind varchar(16), status varchar(32), uploaded boolean, attempts integer)");
            statement.executeUpdate("insert into user_feedback values (7, 'BUG', 'NEW', true, 0)");
        }

        new ApplicationContextRunner()
                .withBean(javax.sql.DataSource.class, () -> dataSource)
                .withConfiguration(AutoConfigurations.of(DataSourceAutoConfiguration.class,
                        DataSourceTransactionManagerAutoConfiguration.class, HibernateJpaAutoConfiguration.class))
                .withUserConfiguration(EntityConfig.class)
                .withPropertyValues("spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
                        "spring.jpa.hibernate.ddl-auto=update")
                .run(context -> {
                    assertTrue(context.isRunning());
                    try (Connection connection = dataSource.getConnection();
                         Statement statement = connection.createStatement();
                         ResultSet result = statement.executeQuery("select version from user_feedback where id=7")) {
                        assertTrue(result.next());
                        assertEquals(0L, result.getLong(1));
                        assertFalse(result.wasNull());
                    }
                });
    }
}
