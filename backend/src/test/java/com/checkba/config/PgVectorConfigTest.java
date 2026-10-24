// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.config;

import dev.langchain4j.data.embedding.Embedding;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.model.output.Response;
import dev.langchain4j.store.embedding.EmbeddingSearchRequest;
import dev.langchain4j.store.embedding.inmemory.InMemoryEmbeddingStore;
import dev.langchain4j.store.embedding.pgvector.PgVectorEmbeddingStore;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * PgVectorConfig 测试：向量维度从 EmbeddingModel 动态读取
 */
class PgVectorConfigTest {

    /** 固定维度的测试用 EmbeddingModel */
    private static EmbeddingModel modelWithDimension(int dim) {
        return new EmbeddingModel() {
            @Override
            public Response<Embedding> embed(String text) {
                return Response.from(Embedding.from(new float[dim]));
            }

            @Override
            public Response<Embedding> embed(TextSegment textSegment) {
                return embed(textSegment.text());
            }

            @Override
            public Response<List<Embedding>> embedAll(List<TextSegment> textSegments) {
                throw new UnsupportedOperationException();
            }
        };
    }

    @Test
    @DisplayName("维度从 EmbeddingModel 动态读取（如 nomic-embed-text 为 768）")
    void shouldResolveDimensionFromModel() {
        assertEquals(768, PgVectorConfig.resolveDimension(modelWithDimension(768)));
        assertEquals(1536, PgVectorConfig.resolveDimension(modelWithDimension(1536)));
    }

    @Test
    @DisplayName("模型不可用时回退到默认维度")
    void shouldFallBackWhenModelUnavailable() {
        EmbeddingModel broken = new EmbeddingModel() {
            @Override
            public Response<Embedding> embed(String text) {
                throw new RuntimeException("embedding service down");
            }

            @Override
            public Response<Embedding> embed(TextSegment textSegment) {
                return embed(textSegment.text());
            }

            @Override
            public Response<List<Embedding>> embedAll(List<TextSegment> textSegments) {
                throw new UnsupportedOperationException();
            }
        };

        assertEquals(PgVectorConfig.FALLBACK_DIMENSION, PgVectorConfig.resolveDimension(broken));
    }

    @Test
    @DisplayName("H2 桌面启动不调用向量模型或 PG，两个内存存储仍可独立检索")
    void desktopStoresDoNotProbeEmbeddingModelOrPostgres() {
        PgVectorConfig config = new PgVectorConfig();
        ReflectionTestUtils.setField(config, "jdbcUrl", "jdbc:h2:mem:startup");
        EmbeddingModel model = mock(EmbeddingModel.class);
        try (var pg = mockStatic(PgVectorEmbeddingStore.class)) {
            var memory = config.memoryEmbeddingStore(model);
            var documents = config.projectDocEmbeddingStore(model);
            verifyNoInteractions(model);
            pg.verifyNoInteractions();
            assertInstanceOf(InMemoryEmbeddingStore.class, memory);
            assertInstanceOf(InMemoryEmbeddingStore.class, documents);
            assertNotSame(memory, documents);

            Embedding vector = Embedding.from(new float[]{1, 0, 0});
            memory.add(vector, TextSegment.from("memory fixture"));
            documents.add(vector, TextSegment.from("document fixture"));
            var query = EmbeddingSearchRequest.builder().queryEmbedding(vector).maxResults(2).build();
            var memoryMatches = memory.search(query).matches();
            var documentMatches = documents.search(query).matches();
            assertEquals(1, memoryMatches.size());
            assertEquals(1, documentMatches.size());
            assertEquals("memory fixture", memoryMatches.get(0).embedded().text());
            assertEquals("document fixture", documentMatches.get(0).embedded().text());
        }
    }

    @Test
    @DisplayName("PostgreSQL 仍按模型维度建两个存储，并仅探测一次维度")
    void postgresRetainsDynamicDimensionAndStores() {
        PgVectorConfig config = new PgVectorConfig();
        ReflectionTestUtils.setField(config, "jdbcUrl", "jdbc:postgresql://db.example:5440/workdeck");
        ReflectionTestUtils.setField(config, "username", "fixture");
        ReflectionTestUtils.setField(config, "password", "fixture");
        EmbeddingModel model = mock(EmbeddingModel.class);
        when(model.dimension()).thenReturn(768);
        var builder = mock(PgVectorEmbeddingStore.PgVectorEmbeddingStoreBuilder.class, RETURNS_SELF);
        var store = mock(PgVectorEmbeddingStore.class);
        when(builder.build()).thenReturn(store);
        try (var pg = mockStatic(PgVectorEmbeddingStore.class)) {
            pg.when(PgVectorEmbeddingStore::builder).thenReturn(builder);
            assertSame(store, config.memoryEmbeddingStore(model));
            assertSame(store, config.projectDocEmbeddingStore(model));
            verify(model).dimension();
            verify(builder, times(2)).dimension(768);
            verify(builder, times(2)).host("db.example");
            verify(builder, times(2)).port(5440);
            verify(builder, times(2)).database("workdeck");
            verify(builder).table("memory_embedding_store");
            verify(builder).table("project_doc_embedding");
        }
    }
}
