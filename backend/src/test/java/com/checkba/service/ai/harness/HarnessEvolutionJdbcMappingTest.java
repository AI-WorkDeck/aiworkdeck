// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.harness;

import com.checkba.model.entity.HarnessEvolutionEntry;
import org.hibernate.boot.MetadataSources;
import org.hibernate.boot.registry.StandardServiceRegistryBuilder;
import org.hibernate.type.BasicType;
import org.hibernate.type.descriptor.WrapperOptions;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Types;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class HarnessEvolutionJdbcMappingTest {

    @ParameterizedTest
    @ValueSource(strings = {"org.hibernate.dialect.PostgreSQLDialect", "org.hibernate.dialect.H2Dialect"})
    @SuppressWarnings("unchecked")
    void payloadUsesTextJdbcBindingForBothDialects(String dialect) throws Exception {
        var registry = new StandardServiceRegistryBuilder()
                .applySetting("hibernate.dialect", dialect)
                .applySetting("hibernate.temp.use_jdbc_metadata_defaults", false)
                .build();
        try {
            var metadata = new MetadataSources(registry)
                    .addAnnotatedClass(HarnessEvolutionEntry.class)
                    .buildMetadata();
            var type = (BasicType<String>) metadata.getEntityBinding(HarnessEvolutionEntry.class.getName())
                    .getProperty("payloadJson").getType();
            assertEquals(Types.LONGVARCHAR, type.getJdbcType().getJdbcTypeCode(),
                    "TEXT must use string binding; @Lob resolves to CLOB/OID on PostgreSQL");

            String payload = "{\"rule\":\"" + "规则🙂".repeat(20000) + "\"}";
            var options = mock(WrapperOptions.class);
            var statement = mock(PreparedStatement.class);
            type.getJdbcValueBinder().bind(statement, payload, 1, options);
            verify(statement).setString(1, payload);

            var result = mock(ResultSet.class);
            when(result.getString(1)).thenReturn(payload);
            assertEquals(payload, type.getJdbcValueExtractor().extract(result, 1, options));
            verify(result).getString(1);
        } finally {
            StandardServiceRegistryBuilder.destroy(registry);
        }
    }
}
