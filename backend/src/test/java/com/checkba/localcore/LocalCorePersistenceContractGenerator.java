// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.localcore;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.autoconfigure.AutoConfigurationPackage;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration;
import org.springframework.boot.autoconfigure.orm.jpa.HibernateJpaAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.io.ClassPathResource;
import org.springframework.beans.factory.config.YamlPropertiesFactoryBean;
import org.springframework.core.env.PropertiesPropertySource;

import javax.sql.DataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicReference;

/** Build-only generator: real Boot desktop mappings, no application services or external providers. */
public final class LocalCorePersistenceContractGenerator {
    @Configuration(proxyBeanMethods = false)
    @AutoConfigurationPackage(basePackages = "com.checkba")
    static class Mappings {}

    static StandardEnvironment desktopEnvironment() {
        var environment = new StandardEnvironment();
        environment.getPropertySources().remove(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME);
        environment.getPropertySources().remove(StandardEnvironment.SYSTEM_PROPERTIES_PROPERTY_SOURCE_NAME);
        for (String file : new String[]{"application.yml", "application-desktop.yml"}) {
            var yaml = new YamlPropertiesFactoryBean(); yaml.setResources(new ClassPathResource(file));
            environment.getPropertySources().addFirst(new PropertiesPropertySource(file, yaml.getObject()));
        }
        return environment;
    }

    static String schema() throws Exception {
        var result = new AtomicReference<String>();
        new ApplicationContextRunner().withConfiguration(AutoConfigurations.of(
                DataSourceAutoConfiguration.class, HibernateJpaAutoConfiguration.class))
                .withUserConfiguration(Mappings.class)
                .withInitializer(context -> context.getEnvironment().merge(desktopEnvironment()))
                .withPropertyValues("spring.datasource.url=jdbc:h2:mem:desktop-contract;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE",
                        "spring.datasource.username=sa", "spring.datasource.driver-class-name=org.h2.Driver",
                        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
                        "spring.jpa.hibernate.ddl-auto=create-drop", "spring.jpa.show-sql=false",
                        "spring.jpa.properties.hibernate.hbm2ddl.halt_on_error=true",
                        "spring.jpa.properties.hibernate.types.print.banner=false")
                .run(context -> {
                    if (context.getStartupFailure() != null) throw new IllegalStateException(context.getStartupFailure());
                    try (var connection = context.getBean(DataSource.class).getConnection()) {
                        var shape = LocalCoreSchemaProof.inspect(connection);
                        if (!shape.compatible()) throw new IllegalStateException("Full desktop schema required");
                        result.set(shape.digest());
                    }
                });
        return result.get();
    }

    public static void main(String[] args) throws Exception {
        Path output = Path.of(args[0]);
        Files.deleteIfExists(output);
        // Runtime fingerprints the application's archive. A future external mapping module must
        // extend this contract explicitly, never silently escape the byte check.
        var resolver = new org.springframework.core.io.support.PathMatchingResourcePatternResolver();
        String own = LocalCorePersistenceContract.class.getResource("LocalCorePersistenceContract.class").toExternalForm();
        String root = own.substring(0, own.length() - "com/checkba/localcore/LocalCorePersistenceContract.class".length());
        for (String name : new org.springframework.orm.jpa.persistenceunit.PersistenceManagedTypesScanner(resolver)
                .scan("com.checkba").getManagedClassNames()) {
            if (!resolver.getResource("classpath:" + name.replace('.', '/') + ".class").getURL().toExternalForm().startsWith(root))
                throw new IllegalStateException("Persistence mappings outside the application archive need an explicit contract");
        }
        String first = schema(), second = schema();
        if (!first.equals(second)) throw new IllegalStateException("Desktop schema generation is not deterministic");
        Files.createDirectories(output.getParent());
        new ObjectMapper().writerWithDefaultPrettyPrinter().writeValue(output.toFile(),
                new LocalCorePersistenceContract.Manifest(LocalCorePersistenceContract.FORMAT, first,
                        LocalCorePersistenceContract.version("org.h2.Driver"),
                        LocalCorePersistenceContract.version("org.hibernate.Version"),
                        LocalCorePersistenceContract.BOOTSTRAP_EPOCH, LocalCorePersistenceContract.applicationInputs(),
                        LocalCorePersistenceContract.configuration(desktopEnvironment())));
    }
}
