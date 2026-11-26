// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version.cloud;

import com.checkba.model.entity.User;
import com.checkba.repository.UserRepository;
import com.checkba.service.DeviceTokenService;
import com.checkba.service.UserService;
import com.checkba.service.mobile.MobileRelayClientService;
import com.checkba.storage.ProjectStorageResolver;
import com.checkba.storage.StorageProperties;
import com.checkba.version.ProjectRepoService;
import com.checkba.version.VersionException;
import com.checkba.version.objects.LocalVersionObjectStore.ObjectRef;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.transport.RefSpec;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * C12 desktop half against a real library: without backup consent the smallest files go up free while they fit,
 * the rest are declared local-only, and the push is accepted; a colleague's pull fetches the free ones and keeps
 * a placeholder for the local-only one instead of failing.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "security.local-mode=false",
        "collab.objects.free-per-file-bytes=1000",
        "collab.objects.free-per-project-bytes=1500"})
@ActiveProfiles("desktop")
class LargeFileSharingDesktopTest {
    static Path root;
    private static final String DB_URL = "jdbc:h2:mem:c12-desktop-" + System.nanoTime()
            + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE";

    @DynamicPropertySource
    static void storage(DynamicPropertyRegistry registry) throws Exception {
        root = Files.createTempDirectory("c12-desktop");
        registry.add("storage.local.root-path", () -> root.toAbsolutePath().toString());
        registry.add("spring.datasource.url", () -> DB_URL);
    }

    @LocalServerPort int port;
    @Autowired ProjectRepoService library;
    @Autowired GitHttpController git;
    @Autowired UserRepository users;
    @Autowired JdbcTemplate jdbc;
    @Autowired DeviceTokenService tokens;

    String token(long projectId) throws Exception {
        Files.createDirectories(root.resolve("projects/" + projectId));
        Files.writeString(root.resolve("projects/" + projectId + "/合同.txt"), "初稿");
        library.init(projectId, "Synthetic", "test@example.com");
        User user = new User();
        user.setUsername("c12d_" + projectId); user.setDisplayName("沈砚"); user.setPassword(UserService.encodePassword("x"));
        user = users.save(user);
        jdbc.update("insert into project (id, name, project_type, listed_company_name, target_company_name, user_id) values (?, ?, ?, ?, ?, ?)",
                projectId, "c12d-" + projectId, "BLANK", "", "", user.getId());
        return tokens.issue(user.getId(), "c12-desktop").plaintext();
    }

    static ProjectRepoService machine(Path dir) {
        var props = new StorageProperties(); props.getLocal().setRootPath(dir.toString());
        return spy(new ProjectRepoService(new ProjectStorageResolver(props, null)));
    }

    static void media(Path file, int bytes, int seed) throws Exception {
        byte[] b = new byte[bytes]; new java.util.Random(seed).nextBytes(b); Files.write(file, b);
    }

    @SuppressWarnings("unchecked")
    ProjectObjectSyncService sync(ProjectRepoService repos, ProjectObjectPlanService desktopPlans) {
        MobileRelayClientService relay = mock(MobileRelayClientService.class);
        doThrow(VersionException.userFacing("backup off")).when(relay).requireVersionObjectCloudConsent(); // no consent
        ObjectProvider<MobileRelayClientService> relayProvider = mock(ObjectProvider.class);
        when(relayProvider.getIfAvailable()).thenReturn(relay);
        var sync = new ProjectObjectSyncService(repos, relayProvider, new ObjectMapper());
        ObjectProvider<ProjectObjectPlanService> plans = mock(ObjectProvider.class);
        when(plans.getIfAvailable()).thenReturn(desktopPlans);
        ReflectionTestUtils.setField(sync, "objectPlans", plans);
        return sync;
    }

    @Test
    void smallestGoFreeTheRestStayLocalAndAColleaguesPullKeepsAPlaceholder(@TempDir Path machines) throws Exception {
        long remote = 12201L;
        String token = token(remote);
        String url = "http://localhost:" + port + "/git/" + remote + ".git";

        ProjectRepoService sender = machine(machines.resolve("sender"));
        doReturn(Map.of()).when(sender).cloudWriteHeaders(anyLong(), anyString(), any(), any());
        Files.createDirectories(sender.workTree(1));
        media(sender.workTree(1).resolve("a.mp4"), 300, 1);
        media(sender.workTree(1).resolve("b.mp4"), 900, 2);
        media(sender.workTree(1).resolve("庭审录像.mp4"), 1200, 3);
        sender.init(1, "Synthetic", "s@example.test");
        List<ObjectRef> objects = sender.objects().list(1).stream().sorted(Comparator.comparingLong(ObjectRef::size)).toList();
        ObjectRef small = objects.get(0), medium = objects.get(1), big = objects.get(2);

        ProjectObjectPlanService senderPlans = mock(ProjectObjectPlanService.class);
        sync(sender, senderPlans).upload(1, url, "u", token);

        library.objects().verify(remote, small); // free, uploaded
        library.objects().verify(remote, medium); // free, uploaded (300 + 900 <= 1500)
        assertThrows(java.io.IOException.class, () -> library.objects().verify(remote, big), "over the per-file allowance: not uploaded");
        for (ObjectRef o : objects) git.requireObjectOrDeclared(remote, o); // the push would be accepted
        verify(senderPlans).recordLocalOnly(eq(1L), eq(big), eq("庭审录像.mp4"), isNull(), eq(true));

        // A colleague pulls the same history.
        ProjectRepoService colleague = machine(machines.resolve("colleague"));
        Files.createDirectories(colleague.workTree(2));
        colleague.init(2, "Synthetic", "c@example.test");
        try (var repo = colleague.open(2); Git g = new Git(repo)) {
            g.fetch().setRemote(sender.gitDir(1).toUri().toString()).setRefSpecs(new RefSpec("+refs/heads/master:refs/remotes/origin/master")).call();
        }
        ProjectObjectPlanService colleaguePlans = mock(ProjectObjectPlanService.class);
        sync(colleague, colleaguePlans).download(2, url, "u", token, "refs/remotes/origin/master");
        colleague.objects().verify(2, small);
        colleague.objects().verify(2, medium);
        verify(colleaguePlans).recordLocalOnly(eq(2L), eq(big), eq("庭审录像.mp4"), eq("沈砚"), eq(false));
    }
}
