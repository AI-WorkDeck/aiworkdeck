// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service;

import com.checkba.model.entity.Project;
import com.checkba.model.entity.ProjectFile;
import com.checkba.model.entity.ProjectMember;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.repository.ProjectMemberRepository;
import com.checkba.repository.ProjectRepository;
import com.checkba.storage.ProjectStorageResolver;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.io.IOException;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * IDE 化本地文件夹项目：「打开文件夹 / 新建项目文件夹 / 打开文件」的业务入口。
 *
 * 语义与 IDE 对齐：
 * - 打开同一个文件夹永远回到同一个项目（按 localRoot 查重复用，不重复建项目）；
 * - 打开即导入：扫描文件夹现有内容登记进数据库文件树（幂等，重复打开等于对账一次）；
 * - 删除项目永远只删数据库记录，绝不碰用户文件夹（契约，勿改）。
 */
@Service
public class LocalProjectService {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(LocalProjectService.class);

    /** 扫描上限：防止误选超大目录（如整个用户主目录）把数据库灌爆。生产默认 30000，
     * 单元测试可用 setMaxImportEntriesForTest 覆盖成一个小值——不然为了触发截断
     * 就得真的建几万个文件，几十分钟、占磁盘，不能进 CI。 */
    static final int DEFAULT_MAX_IMPORT_ENTRIES = 30000;
    private int maxImportEntries = DEFAULT_MAX_IMPORT_ENTRIES;
    static final int MAX_IMPORT_DEPTH = 20;
    /**
     * 命中导入上限后，被跳过的子树只数不入库；数到这个数就停（标 truncatedCountCapped），
     * 免得为了一个提示数字扫穿一整棵误选的超大目录。
     */
    static final int DEFAULT_TRUNCATED_COUNT_CAP = 100_000;
    private int truncatedCountCap = DEFAULT_TRUNCATED_COUNT_CAP;

    void setTruncatedCountCapForTest(int cap) {
        this.truncatedCountCap = cap;
    }

    /** 仅供测试覆盖导入上限（包内可见）。生产路径永远用 DEFAULT_MAX_IMPORT_ENTRIES。 */
    void setMaxImportEntriesForTest(int maxImportEntries) {
        this.maxImportEntries = maxImportEntries;
    }

    private final ProjectRepository projectRepository;
    private final ProjectMemberRepository projectMemberRepository;
    private final ProjectFileRepository projectFileRepository;
    private final ProjectFileService projectFileService;
    private final ProjectMemberService projectMemberService;
    private final ProjectStorageResolver storageResolver;
    private final org.springframework.context.ApplicationEventPublisher eventPublisher;
    private final com.checkba.service.telemetry.TelemetryService telemetryService;
    private final org.springframework.transaction.support.TransactionTemplate transactionTemplate;

    /**
     * 按项目串行化导入与对账（dev-board#1427）：
     * 此前 openLocalFolder 与 reconcileProject 均无项目级互斥，前端/桌面壳连续触发两次打开或打开同时触发
     * watcher 对账时，两个线程并发跑 importFolder，同时读到空 rowIndex 并各自插入一整套顶层目录与文件，
     * 造成资源管理器出现成对的重复顶层文件夹且 H2 锁竞争与全表扫描耗时翻倍。
     */
    private final java.util.concurrent.ConcurrentHashMap<Long, java.util.concurrent.locks.ReentrantLock> projectLocks =
            new java.util.concurrent.ConcurrentHashMap<>();
    private final Object resolveProjectLock = new Object();

    private java.util.concurrent.locks.ReentrantLock lockForProject(Long projectId) {
        return projectLocks.computeIfAbsent(projectId, k -> new java.util.concurrent.locks.ReentrantLock());
    }

    public LocalProjectService(ProjectRepository projectRepository,
                               ProjectMemberRepository projectMemberRepository,
                               ProjectFileRepository projectFileRepository,
                               ProjectFileService projectFileService,
                               ProjectMemberService projectMemberService,
                               ProjectStorageResolver storageResolver,
                               org.springframework.context.ApplicationEventPublisher eventPublisher,
                               com.checkba.service.telemetry.TelemetryService telemetryService,
                               org.springframework.transaction.PlatformTransactionManager transactionManager) {
        this.projectRepository = projectRepository;
        this.projectMemberRepository = projectMemberRepository;
        this.projectFileRepository = projectFileRepository;
        this.projectFileService = projectFileService;
        this.projectMemberService = projectMemberService;
        this.storageResolver = storageResolver;
        this.eventPublisher = eventPublisher;
        this.telemetryService = telemetryService;
        this.transactionTemplate = new org.springframework.transaction.support.TransactionTemplate(transactionManager);
    }

    /** 本地文件夹项目被打开/创建（LocalRootWatchService 据此启动监听）。 */
    public record LocalProjectOpened(long projectId, String localRoot) {}

    public record OpenLocalResult(Project project, boolean reused, Long openFileId,
                                  int importedCount, boolean truncated, int truncatedCount,
                                  boolean truncatedCountCapped) {}

    public record OpenLocalFileResult(Project project, ProjectFile file, boolean reused) {}

    // Match fileOpenTabs.isFileTypeSupported: registration must not promise an unusable tab.
    private static final java.util.Set<String> OPEN_FILE_TYPES = java.util.Set.of(
            "doc", "docx", "xls", "xlsx", "ppt", "pptx", "pdf",
            "jpg", "jpeg", "png", "gif", "bmp", "svg", "webp",
            "mp4", "webm", "ogg", "mov", "mkv", "avi", "mp3", "wav", "m4a", "flac", "aac",
            "txt", "md", "markdown", "json", "xml", "html", "css", "js", "java", "py", "sh", "sql", "log",
            "zip", "rar", "7z", "drawio", "dd");

    /** Register just the selected file. The lock covers transaction commit, including first open. */
    public synchronized OpenLocalFileResult openLocalFile(String rawPath, Long userId) {
        if (userId == null) throw new IllegalArgumentException("请先登录");
        if (!StringUtils.hasText(rawPath)) throw new IllegalArgumentException(LangText.of("请选择文件", "Please select a file"));
        Path selected = Path.of(rawPath);
        if (!selected.isAbsolute()) throw new IllegalArgumentException(LangText.of("文件路径必须是绝对路径", "The file path must be absolute"));
        final Path file;
        final long size;
        try {
            file = selected.toRealPath();
            if (!Files.isRegularFile(file) || !Files.isReadable(file)) throw new IOException("not readable");
            size = Files.size(file);
        } catch (IOException e) {
            throw new IllegalArgumentException(LangText.of("文件不存在或无法读取", "The file does not exist or cannot be read"));
        }
        Path internalRoot = storageResolver.globalRoot().toAbsolutePath().normalize();
        try { if (Files.exists(internalRoot)) internalRoot = internalRoot.toRealPath(); }
        catch (IOException e) { throw new IllegalArgumentException(LangText.of("无法核对文件位置", "Could not verify the file location")); }
        if (file.startsWith(internalRoot)) throw new IllegalArgumentException(LangText.of("请勿通过此入口打开软件内部数据文件", "Application data files cannot be opened here"));
        String filename = file.getFileName().toString();
        int dot = filename.lastIndexOf('.');
        String type = dot < 0 ? "" : filename.substring(dot + 1).toLowerCase(java.util.Locale.ROOT);
        if (!OPEN_FILE_TYPES.contains(type)) throw new IllegalArgumentException(LangText.of("暂不支持打开此类文件", "This file type is not supported"));
        return transactionTemplate.execute(status -> {
            Project project = projectRepository.findFirstByUserIdAndProjectTypeOrderByIdAsc(userId, Project.LOOSE_FILES)
                    .orElseGet(() -> {
                        Project p = new Project();
                        p.setName(LangText.of("独立文件", "Standalone files"));
                        p.setProjectType(Project.LOOSE_FILES);
                        p.setListedCompanyName("");
                        p.setTargetCompanyName("");
                        p.setUserId(userId);
                        p.setVersionOptOut(true);
                        p.setCreatedAt(LocalDateTime.now());
                        p.setUpdatedAt(p.getCreatedAt());
                        p = projectRepository.save(p);
                        ProjectMember member = new ProjectMember();
                        member.setProjectId(p.getId());
                        member.setUserId(userId);
                        member.setRole("ADMIN");
                        projectMemberRepository.save(member);
                        return p;
                    });
            Optional<ProjectFile> previous = projectFileRepository
                    .findFirstByProjectIdAndExternalPathAndIsDeletedFalse(project.getId(), file.toString());
            if (previous.isPresent()) {
                ProjectFile existing = previous.get();
                if (!java.util.Objects.equals(existing.getFileSize(), size)) {
                    existing.setFileSize(size);
                    existing.setUpdatedAt(LocalDateTime.now());
                    projectFileRepository.save(existing);
                }
                return new OpenLocalFileResult(project, existing, true);
            }
            ProjectFile row = new ProjectFile();
            row.setProjectId(project.getId());
            row.setIsFolder(false);
            row.setName(filename);
            row.setFileType(type);
            row.setFileSize(size);
            row.setFilePath("projects/" + project.getId() + "/loose/" + java.util.UUID.randomUUID() + "/" + filename);
            row.setExternalPath(file.toString());
            row.setUserId(userId);
            row.setSortOrder(0);
            row.setCreatedAt(LocalDateTime.now());
            row.setUpdatedAt(row.getCreatedAt());
            // Deliberately no template, directory scan, watcher, RAG or version-created event.
            return new OpenLocalFileResult(project, projectFileRepository.save(row), false);
        });
    }

    /**
     * 打开/复用本地文件夹项目。
     *
     * <p><b>刻意不带 @Transactional</b>，与 {@link #reconcileProject} 同理：方法里调的
     * {@code importFolder} 会逐条调 ProjectFileService 那三个 @Transactional 方法
     * （REQUIRED，会参与外层事务）。磁盘上出现与库中「活着」的文件同名的目录时
     * （用户把某个文件换成了同名文件夹），createFolder 的同名检查抛异常，
     * Spring 对参与型事务默认标 rollback-only；importFolder 的 catch 接住异常继续扫，
     * 却撤不回这个标记——方法体正常返回后，代理提交时抛 UnexpectedRollbackException。
     * 用户看到的是「打开失败」，而且**重开一次还是失败，项目从此打不开**。
     *
     * <p>项目行与成员行仍必须一起落（否则一次失败会留下没有成员的孤儿项目，
     * 之后 findByLocalRoot 命中它、权限检查又不过，这个文件夹就谁都用不了了），
     * 所以那一段单独用 TransactionTemplate 包起来，导入留在事务之外。
     */
    public OpenLocalResult openLocalFolder(String localRootRaw, boolean createFolder,
                                           String name, String openFileName, Long userId) {
        return openLocalFolder(localRootRaw, createFolder, name, openFileName, userId, false);
    }

    public OpenLocalResult openLocalFolder(String localRootRaw, boolean createFolder,
                                           String name, String openFileName, Long userId, boolean allowNested) {
        if (userId == null) {
            throw new IllegalArgumentException("请先登录");
        }
        // Check before creating a directory or registering rows: Cancel must leave no project behind.
        Path candidate = normalizeLocalRoot(localRootRaw);
        checkNestedOpen(candidate, userId, allowNested);
        Path root = validateLocalRoot(localRootRaw, createFolder);
        String canonical = root.toString();

        ProjectResolution resolution;
        synchronized (resolveProjectLock) {
            resolution = transactionTemplate.execute(status -> resolveProject(canonical, root, name, userId));
        }
        Project project = resolution.project();
        boolean reused = resolution.reused();

        ImportStats stats;
        Long openFileId = null;
        java.util.concurrent.locks.ReentrantLock projectLock = lockForProject(project.getId());
        projectLock.lock();
        try {
            stats = importFolder(project.getId(), root, userId);
            if (StringUtils.hasText(openFileName)) {
                openFileId = projectFileRepository
                        .findByProjectIdAndParentIdAndNameAndIsDeletedFalse(project.getId(), null, openFileName)
                        .map(ProjectFile::getId)
                        .orElse(null);
            }
        } finally {
            projectLock.unlock();
        }
        log.info("打开本地文件夹项目: project={}, root={}, reused={}, imported={}, truncated={}, truncatedCount={}",
                project.getId(), canonical, reused, stats.imported, stats.truncated, stats.truncatedCount);
        eventPublisher.publishEvent(new LocalProjectOpened(project.getId(), canonical));
        telemetryService.record("project.created", java.util.Map.of(
                "kind", "local", "reused", reused, "importedCount", stats.imported));
        return new OpenLocalResult(project, reused, openFileId, stats.imported, stats.truncated,
                stats.truncatedCount, stats.truncatedCountCapped);
    }

    private record ProjectResolution(Project project, boolean reused) {}

    /** 复用既有项目或新建一个（项目行 + 成员行必须同一个事务）。 */
    private ProjectResolution resolveProject(String canonical, Path root, String name, Long userId) {
        Optional<Project> existing = projectRepository.findByLocalRoot(canonical);
        if (existing.isPresent()) {
            Project project = existing.get();
            if (!projectMemberService.hasReadPermission(project.getId(), userId)) {
                throw new IllegalArgumentException(LangText.of("该文件夹已被其他账号的项目使用", "This folder is already in use by another account's project"));
            }
            return new ProjectResolution(project, true);
        }
        Project project = new Project();
        project.setName(StringUtils.hasText(name) ? name.trim() : folderDisplayName(root));
        project.setProjectType("BLANK");
        project.setListedCompanyName("");
        project.setTargetCompanyName("");
        project.setUserId(userId);
        project.setLocalRoot(canonical);
        LocalDateTime now = LocalDateTime.now();
        project.setCreatedAt(now);
        project.setUpdatedAt(now);
        project = projectRepository.save(project);

        ProjectMember member = new ProjectMember();
        member.setProjectId(project.getId());
        member.setUserId(userId);
        member.setRole("ADMIN");
        projectMemberRepository.save(member);

        storageResolver.invalidate(project.getId());
        return new ProjectResolution(project, false);
    }

    public record ReconcileResult(int changed, boolean rootMissing, boolean truncated, int truncatedCount,
                                  boolean truncatedCountCapped) {}

    /**
     * 磁盘 ↔ 数据库文件树对账（watcher 触发；幂等，只写数据库、绝不写磁盘）：
     * ① 导入新增/变化的文件（无变化的行一字不动，避免 DB 行翻搅与版本记录噪声）；
     * ② 磁盘上已消失的行直接出索引（{@link ProjectFileService#forgetVanished}，不进回收站——
     * 回收站只收律师在应用里亲手删的东西，外部删掉的字节已经不在，进回收站只会留下还原不了、
     * 彻底删除又失败的幽灵，v0.49.0 BUG-02；signalChange 由服务方法自带，内容可从版本记录找回）。
     * 根目录整个不可达（外置盘拔出/文件夹被移走）时整体跳过——绝不把「暂时看不见」
     * 当成「都被删了」，否则一次误判就把整棵文件树从索引里摘光。
     *
     * 本方法故意不带 @Transactional：它调的 ProjectFileService.createFolder /
     * createOrUpdateFile / forgetVanished 各自都是独立 bean 上的 @Transactional（REQUIRED）方法。
     * 如果这里也开一个外层事务，内层就会"参与"进来共享同一个事务——某一条目录/文件
     * 因为同名冲突等原因抛异常时（比如磁盘上出现一个和库里"活着"的文件同名的目录，
     * createFolder 内部的查重不看 isFolder 类型），Spring 对参与型事务抛异常默认标记
     * rollback-only，下面的 catch 把异常本身接住继续扫下一条，但撤不回这个标记——
     * 方法体正常 return 之后，AOP 代理 commit 时发现 rollback-only，转而抛
     * UnexpectedRollbackException，把本轮已经处理完的其它条目一起回滚，而日志还已经
     * 打过"对账完成"。不开外层事务后，每次对 createFolder/createOrUpdateFile/delete
     * 的调用都各自独立成一个新事务、处理完就提交，一条坏条目只影响它自己那次调用，
     * 与"跳过这条坏数据、把其余导完"的既有设计意图一致。
     */
    public ReconcileResult reconcileProject(Long projectId) {
        if (projectId == null) {
            return new ReconcileResult(0, false, false, 0, false);
        }
        java.util.concurrent.locks.ReentrantLock projectLock = lockForProject(projectId);
        projectLock.lock();
        try {
            return doReconcileProject(projectId);
        } finally {
            projectLock.unlock();
        }
    }

    private ReconcileResult doReconcileProject(Long projectId) {
        Project project = projectRepository.findById(projectId).orElse(null);
        if (project == null || !StringUtils.hasText(project.getLocalRoot())) {
            return new ReconcileResult(0, false, false, 0, false);
        }
        Path root = Paths.get(project.getLocalRoot());
        if (!Files.isDirectory(root)) {
            log.warn("对账跳过：项目文件夹不可达 project={}, root={}", projectId, root);
            return new ReconcileResult(0, true, false, 0, false);
        }
        Long ownerId = project.getUserId();

        // 外部改名 / 移动的旧身份候选：库里活着、磁盘上已经不在的文件行（BUG-14）。
        // 导入时遇到「没有对应行的新文件」先拿它来认领，认上了就原地改这一行（id 不变），
        // 而不是「新建一行 + 旧行进回收站」——已打开的编辑器按 id 保存，id 一换就写回旧路径。
        Map<Long, ProjectFile> vanished = vanishedFileRows(projectId);
        ImportStats stats = importFolder(projectId, root, ownerId, vanished);
        int changed = stats.changed;
        if (stats.truncated) {
            // 此前 stats.truncated 只在 openLocalFolder 那侧被读取，watcher 触发的
            // reconcileProject 从不读它——超出 MAX_IMPORT_ENTRIES 上限的文件永远静默
            // 不进文件树，无日志无 API 信号。这里补上，与 openLocalFolder 的日志对齐。
            log.warn("对账触发导入上限截断: project={}, root={}, 上限={}, truncatedCount={}",
                    projectId, root, maxImportEntries, stats.truncatedCount);
        }

        // 删除同步：行在库、物理不存在 → 出索引（文件按 filePath 解析，文件夹按父链拼相对路径）
        java.util.List<ProjectFile> rows = projectFileRepository.findByProjectId(projectId);
        Map<Long, ProjectFile> byId = new HashMap<>(rows.size() * 2);
        for (ProjectFile f : rows) byId.put(f.getId(), f);
        for (ProjectFile f : rows) {
            if (Boolean.TRUE.equals(f.getIsDeleted())) continue;
            // 文件缓存区是应用内部文件夹，空着的时候磁盘上本就没有目录——不能判成「律师删了它」，
            // 否则工作台每打开一次就懒建一个、对账又送一个进回收站（dev-board#885 现场的
            // .awd/tree.json 里已经攒了两条）。
            if (ProjectFileService.isRootStagingFolder(f)) continue;
            Path physical;
            boolean isFolder = Boolean.TRUE.equals(f.getIsFolder());
            if (isFolder) {
                physical = root.resolve(relativeFolderPath(f, byId));
            } else if (StringUtils.hasText(f.getFilePath())) {
                try {
                    physical = storageResolver.resolve(f.getFilePath());
                } catch (Exception e) {
                    continue; // 路径异常的行不动
                }
            } else {
                continue; // 无物理路径的行（历史遗留）不动
            }
            boolean missing = !Files.exists(physical);
            if (!missing && isFolder) {
                // macOS 默认的 APFS/HFS+ 等大小写不敏感、大小写保留的文件系统上，仅改大小写的
                // 重命名（"Docs" -> "docs"）之后，旧大小写路径的 Files.exists 依然为 true
                // （不敏感匹配命中了同一个物理目录），这一行永远不会被判定为缺失——importFolder
                // 那侧因为 rowKey 按大小写敏感比对，已经在同一轮对账里为新大小写建了一个新行，
                // 于是旧行成为再也清不掉的永久幽灵行。toRealPath() 能拿到磁盘上的真实大小写；
                // 与库里存的名字不一致，说明这一行对应的物理目录已经不是"这个大小写"了，
                // 按缺失处理，交给下面的出索引（新大小写那行成为唯一存活的行）。
                try {
                    String realName = physical.toRealPath().getFileName().toString();
                    if (!realName.equals(f.getName())) {
                        missing = true;
                    }
                } catch (IOException ignored) {
                    // 拿不到真实路径（权限/竞态）时保持原判断，不误伤
                }
            }
            if (missing) {
                // 父级已先出索引的行会随递归一起带走，这里再调一次回 false（幂等）
                try {
                    if (projectFileService.forgetVanished(f.getId(), ownerId)) {
                        changed++;
                    }
                } catch (Exception e) {
                    log.warn("对账移除失败: file={} ({})", f.getId(), e.getMessage());
                }
            }
        }
        if (changed > 0) {
            log.info("对账完成: project={}, changed={}", projectId, changed);
        }
        return new ReconcileResult(changed, false, stats.truncated, stats.truncatedCount, stats.truncatedCountCapped);
    }

    private String relativeFolderPath(ProjectFile folder, Map<Long, ProjectFile> byId) {
        StringBuilder sb = new StringBuilder(folder.getName());
        Long pid = folder.getParentId();
        int depth = 0;
        while (pid != null && depth < 30) {
            ProjectFile parent = byId.get(pid);
            if (parent == null) break;
            sb.insert(0, parent.getName() + "/");
            pid = parent.getParentId();
            depth++;
        }
        return sb.toString();
    }

    /** 校验并规范化用户选择的文件夹。 */
    private Path validateLocalRoot(String raw, boolean createFolder) {
        Path p = normalizeLocalRoot(raw);
        if (createFolder) {
            try {
                Files.createDirectories(p);
            } catch (IOException e) {
                throw new IllegalArgumentException(LangText.of("创建文件夹失败: ", "Failed to create folder: ") + e.getMessage());
            }
        }
        if (!Files.isDirectory(p)) {
            throw new IllegalArgumentException(LangText.of("文件夹不存在或不是目录: ", "Folder does not exist or is not a directory: ") + p);
        }
        return p;
    }

    /** 系统浏览文件夹时自己落下的杂项：只有这些时仍算「空文件夹」。 */
    private static final java.util.Set<String> OS_JUNK_NAMES = java.util.Set.of(".DS_Store", "Thumbs.db", "desktop.ini");

    /** {@link #prepareCloneTarget} 的结果：created=这个目录是这次新建的（取回失败时连目录一起清掉）。 */
    public record CloneTarget(Path root, boolean created) {}

    /**
     * 「从案件库取回」落到用户自选文件夹（dev-board#1040）：与 open-local 同一套路径校验
     * （绝对路径、非磁盘根、不在软件内部数据目录、不与已有本地文件夹项目嵌套），外加一条：
     * 目标必须是空文件夹或还不存在——取回是整仓 checkout，写进一个有东西的文件夹会覆盖用户文件。
     * 不存在就建出来。只清掉系统自己落的 .DS_Store 这类杂项（否则 git clone 拒绝非空目录）。
     */
    public CloneTarget prepareCloneTarget(String raw) {
        Path p = normalizeLocalRoot(raw);
        rejectNestedRoot(p);
        if (!Files.exists(p)) {
            try {
                Files.createDirectories(p);
            } catch (IOException e) {
                throw new IllegalArgumentException(LangText.of("创建文件夹失败: ", "Failed to create folder: ") + e.getMessage());
            }
            return new CloneTarget(p, true);
        }
        if (!Files.isDirectory(p)) {
            throw new IllegalArgumentException(LangText.of("文件夹不存在或不是目录: ", "Folder does not exist or is not a directory: ") + p);
        }
        try (var entries = Files.list(p)) {
            List<Path> all = entries.toList();
            boolean hasUserContent = all.stream()
                    .anyMatch(e -> !OS_JUNK_NAMES.contains(e.getFileName().toString()));
            if (hasUserContent) {
                throw new IllegalArgumentException(LangText.of(
                        "这个文件夹里已经有东西了，取回会覆盖其中的文件。请选择一个空文件夹",
                        "This folder is not empty, and pulling the case file here could overwrite its files. Please choose an empty folder"));
            }
            for (Path junk : all) Files.deleteIfExists(junk);
        } catch (IOException e) {
            throw new IllegalArgumentException(LangText.of("读取文件夹失败: ", "Failed to read folder: ") + e.getMessage());
        }
        return new CloneTarget(p, false);
    }

    /** 本地文件夹项目由别的入口建好之后（取回到自选文件夹），让监听照常挂上。 */
    public void announceLocalRoot(long projectId, String localRoot) {
        storageResolver.invalidate(projectId);
        eventPublisher.publishEvent(new LocalProjectOpened(projectId, localRoot));
    }

    /** 不落盘的那部分校验：open-local 与取回到自选文件夹共用。 */
    private Path normalizeLocalRoot(String raw) {
        if (!StringUtils.hasText(raw)) {
            throw new IllegalArgumentException(LangText.of("请选择一个文件夹", "Please select a folder"));
        }
        Path p = Paths.get(raw.trim());
        if (!p.isAbsolute()) {
            throw new IllegalArgumentException(LangText.of("文件夹路径必须是绝对路径", "The folder path must be absolute"));
        }
        p = p.normalize();
        if (p.getParent() == null) {
            throw new IllegalArgumentException(LangText.of("不能把整个磁盘根目录作为项目", "You cannot use an entire drive root as a project"));
        }
        Path global = storageResolver.globalRoot();
        if (p.startsWith(global)) {
            throw new IllegalArgumentException(LangText.of("该位置是软件内部数据目录，请选择其他文件夹", "This location is the application's internal data directory; please choose another folder"));
        }
        return p;
    }

    /** A normal user decision, returned by the controller without creating/importing anything. */
    public static class NestedFolderConfirmationRequired extends IllegalArgumentException {
        private final List<String> projectNames;

        public NestedFolderConfirmationRequired(List<String> projectNames) {
            super("Nested folder confirmation required");
            this.projectNames = List.copyOf(projectNames);
        }

        public List<String> projectNames() { return projectNames; }
    }

    private void checkNestedOpen(Path root, Long userId, boolean allowNested) {
        // Reopening the exact folder keeps its existing permission check and never prompts again.
        if (projectRepository.findByLocalRoot(root.toString()).isPresent()) return;
        java.util.ArrayList<String> names = new java.util.ArrayList<>();
        for (Project other : projectRepository.findByLocalRootIsNotNull()) {
            if (!StringUtils.hasText(other.getLocalRoot())) continue;
            Path otherRoot = Paths.get(other.getLocalRoot());
            if (!root.startsWith(otherRoot) && !otherRoot.startsWith(root)) continue;
            // Parent access also exposes every child file. Confirmation cannot grant account access.
            if (!java.util.Objects.equals(other.getUserId(), userId)) {
                throw new IllegalArgumentException(LangText.of(
                        "该文件夹与其他账号的项目文件夹重叠，请使用该项目所属账号打开",
                        "This folder overlaps with another account's project. Open it with that project's account."));
            }
            names.add(other.getName());
        }
        if (!allowNested && !names.isEmpty()) throw new NestedFolderConfirmationRequired(names);
    }

    /** 拒绝与已有本地文件夹项目互相嵌套（父子重叠会让两边的文件树互相踩踏）。 */
    private void rejectNestedRoot(Path root) {
        for (Project other : projectRepository.findByLocalRootIsNotNull()) {
            if (!StringUtils.hasText(other.getLocalRoot())) continue;
            Path otherRoot = Paths.get(other.getLocalRoot());
            if (root.startsWith(otherRoot) || otherRoot.startsWith(root)) {
                throw new IllegalArgumentException(
                        LangText.of("该文件夹与已有项目「", "This folder overlaps with the folder of the existing project “") + other.getName()
                                + LangText.of("」的文件夹嵌套，请选择互不包含的文件夹", "”; please choose folders that do not contain each other"));
            }
        }
    }

    private String folderDisplayName(Path root) {
        Path fn = root.getFileName();
        return fn != null ? fn.toString() : root.toString();
    }

    private static final class ImportStats {
        int imported;   // 本次处理（含无变化跳过）的条目数，用于上限控制
        int changed;    // 真正新建/更新的条目数，用于「有没有发生变化」判断
        boolean truncated;
        int truncatedCount; // 命中上限之后未纳入的条目数（被跳过的子树做有界计数，见 countSkippedSubtree）
        boolean truncatedCountCapped; // 计数本身也撞了 truncatedCountCap：真实数字只会更大
    }

    /**
     * 对一棵不再入库的子树做有界计数（目录自身 + 其下非隐藏的文件/目录），累加进 stats.truncatedCount。
     * 此前这里只给整棵子树记 1，前端却据此写「N 项未纳入」——一个 5 万文件的目录被报成 1 项。
     * 计数到 truncatedCountCap 即终止并置 truncatedCountCapped，调用方据此把文案改成「超过 N 项」。
     */
    private void countSkippedSubtree(Path dir, ImportStats stats) {
        stats.truncated = true;
        int remaining = truncatedCountCap - stats.truncatedCount;
        if (remaining <= 0) {
            stats.truncatedCountCapped = true;
            return;
        }
        final int[] counted = {0};
        try {
            Files.walkFileTree(dir, java.util.Collections.emptySet(), MAX_IMPORT_DEPTH, new SimpleFileVisitor<>() {
                private FileVisitResult tally() {
                    if (counted[0] >= remaining) {
                        stats.truncatedCountCapped = true;
                        return FileVisitResult.TERMINATE;
                    }
                    counted[0]++;
                    return FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult preVisitDirectory(Path d, BasicFileAttributes attrs) {
                    if (!d.equals(dir) && isIgnoredDirectoryName(d.getFileName().toString())) return FileVisitResult.SKIP_SUBTREE;
                    return tally();
                }

                @Override
                public FileVisitResult visitFile(Path f, BasicFileAttributes attrs) {
                    if (isIgnoredEntryName(f.getFileName().toString())) return FileVisitResult.CONTINUE;
                    if (!attrs.isRegularFile() && !attrs.isDirectory()) return FileVisitResult.CONTINUE;
                    return tally();
                }

                @Override
                public FileVisitResult visitFileFailed(Path f, IOException exc) {
                    return FileVisitResult.CONTINUE;
                }
            });
        } catch (IOException e) {
            log.warn("统计被截断子树失败（已数 {} 项）: {} ({})", counted[0], dir, e.getMessage());
        }
        stats.truncatedCount += counted[0];
    }

    /**
     * 磁盘扫描与监听时一律跳过的重型依赖/运行环境目录名（dev-board#1427）：
     * 用户项目文件夹内若内嵌前端/Python/小程序工程，单个 {@code node_modules} 就可达十余万文件
     * （如真机现场 17.2 万个非隐藏条目中 {@code node_modules} 占 13.9 万、{@code site-packages}
     * 占 1330），深度优先扫描会把 30,000 条导入上限全部耗尽在依赖包里，导致根目录上百个业务
     * 文件夹被成片截断、打开耗时超过 5 分钟。只列无歧义的包管理与运行时缓存目录，不列
     * {@code target}/{@code build} 等可能与业务命名重合的通用词。
     */
    private static final java.util.Set<String> IGNORED_DIRECTORY_NAMES = java.util.Set.of(
            "node_modules",
            "bower_components",
            "__pycache__",
            "site-packages",
            "venv",
            "virtualenv",
            "Pods"
    );

    /**
     * 目录名是否应在本地文件夹导入、对账、监听与版本估算中整棵跳过：
     * 点开头的隐藏目录（{@code .git}/{@code .awd}/{@code .venv}/{@code .idea} 等）
     * 以及 {@link #IGNORED_DIRECTORY_NAMES} 中的重型依赖目录。
     */
    public static boolean isIgnoredDirectoryName(String name) {
        return name != null && (name.startsWith(".") || IGNORED_DIRECTORY_NAMES.contains(name));
    }

    /**
     * 磁盘扫描时要跳过的条目名（dev-board#463）。两类：
     * <ul>
     *   <li>点开头的隐藏项——{@code .git}/{@code .awd}/{@code .DS_Store} 一并覆盖；</li>
     *   <li>{@code ~$} 开头的 Office 锁文件——Word/WPS 打开 {@code 合同.docx} 时会在
     *       同目录落一个 {@code ~$合同.docx}，它不以点开头，旧规则拦不住：进了资源
     *       管理器，等 Word 关闭把它删掉，对账又把这行软删进回收站，一次开关文档就
     *       留一个幽灵，还顺带触发一次没有意义的版本记录存档。</li>
     * </ul>
     * <b>只用在文件站点</b>：目录站点按 {@link #isIgnoredDirectoryName} 判断——一个名字以 {@code ~$} 开头的
     * 目录（Office 从不创建）若被 SKIP_SUBTREE，整棵子树会从文件树上消失却照样进
     * 版本库，白添一种"看不见但被收录"的不对称。
     */
    static boolean isIgnoredEntryName(String name) {
        return name != null && (name.startsWith(".") || name.startsWith("~$"));
    }

    /**
     * 文件系统监听事件路径是否属于应忽略的噪声路径（dev-board#1427）：
     * 此前 {@code LocalRootWatchService} 只检查 {@code changed.getFileName()}，导致
     * {@code .awd/tree.json}、{@code .git/index.lock}、{@code node_modules/pkg/index.js}
     * 的末段文件名不以点开头而漏网，每一次内部写清单或依赖变动都触发全量对账。
     * 这里沿相对于项目根的每一段父目录检查 {@link #isIgnoredDirectoryName}，末段同时检查
     * {@link #isIgnoredEntryName} 与 {@link #isIgnoredDirectoryName}。
     */
    static boolean isIgnoredWatchPath(Path root, Path changed) {
        if (changed == null) return false;
        if (root != null && changed.equals(root)) return false;
        if (root != null && changed.startsWith(root)) {
            Path rel = root.relativize(changed);
            int count = rel.getNameCount();
            if (count == 0) return false;
            for (int i = 0; i < count - 1; i++) {
                if (isIgnoredDirectoryName(rel.getName(i).toString())) {
                    return true;
                }
            }
            String leaf = rel.getName(count - 1).toString();
            return isIgnoredEntryName(leaf) || isIgnoredDirectoryName(leaf);
        }
        Path fn = changed.getFileName();
        return fn != null && (isIgnoredEntryName(fn.toString()) || isIgnoredDirectoryName(fn.toString()));
    }

    private static final int BATCH_SAVE_CHUNK_SIZE = 500;

    private record DirLevelNode(Path dir, Long folderId, int depth) {}
    private record DiskEntry(Path path, String name, BasicFileAttributes attrs) {}
    private record PendingFolder(Path dir, int depth, ProjectFile entity) {}

    /**
     * 把文件夹现有内容按广度优先（层序）批量登记进数据库文件树（dev-board#1427）。幂等：
     * - 已有同名同大小同路径的行一字不动（避免 DB 行翻搅与版本记录噪声）；
     * - <b>回收站里的行（isDeleted）不复活</b>——软删除不动磁盘文件，重扫时把磁盘上
     *   仍存在的它当「新文件」再导入会静默撤销律师刚做的删除；
     * - 跳过噪声目录（{@link #isIgnoredDirectoryName}）与噪声文件（{@link #isIgnoredEntryName}）；
     * - 广度优先（Level-Order）：先导入根目录（第 1 层）、再第 2 层、第 3 层……即使超大项目触发
     *   {@code maxImportEntries} 上限，根目录和浅层业务文件夹也永远完整呈现，不会被某个深层子目录饥饿截断；
     * - 内存维护 {@code maxSortByParent} + 按层分批 {@code saveAll} + 末尾单次 {@code signalChange}：
     *   消除逐文件事务提交、逐文件 {@code maxSortOrder} 全表扫描与逐文件模板检查。
     */
    private ImportStats importFolder(Long projectId, Path root, Long userId) {
        return importFolder(projectId, root, userId, java.util.Collections.emptyMap());
    }

    private ImportStats importFolder(Long projectId, Path root, Long userId, Map<Long, ProjectFile> vanished) {
        ImportStats stats = new ImportStats();

        // 一次拉全量行并自愈历史并发重复行与噪声目录行
        List<ProjectFile> existingRows = healExistingRows(projectId, projectFileRepository.findByProjectId(projectId));
        Map<String, ProjectFile> rowIndex = new HashMap<>(Math.max(16, existingRows.size() * 2));
        Map<Long, Integer> maxSortByParent = new HashMap<>();
        for (ProjectFile f : existingRows) {
            Long normParent = normalizeParentId(f.getParentId());
            String key = rowKey(normParent, f.getName());
            ProjectFile prev = rowIndex.get(key);
            // 同键多行时非删除行优先
            if (prev == null || Boolean.TRUE.equals(prev.getIsDeleted())) {
                rowIndex.put(key, f);
            }
            if (!Boolean.TRUE.equals(f.getIsDeleted()) && f.getSortOrder() != null) {
                maxSortByParent.merge(normParent, f.getSortOrder(), Math::max);
            }
        }

        List<DirLevelNode> currentLevel = List.of(new DirLevelNode(root, null, 0));
        while (!currentLevel.isEmpty()) {
            List<DiskEntry> levelFiles = new java.util.ArrayList<>();
            List<Long> levelFileParents = new java.util.ArrayList<>();
            List<DiskEntry> levelDirs = new java.util.ArrayList<>();
            List<DirLevelNode> levelDirParents = new java.util.ArrayList<>();

            for (DirLevelNode parentNode : currentLevel) {
                List<Path> children;
                try (java.util.stream.Stream<Path> stream = Files.list(parentNode.dir())) {
                    children = stream
                            .sorted(java.util.Comparator.comparing(p -> p.getFileName().toString()))
                            .toList();
                } catch (IOException e) {
                    log.warn("导入时无法访问目录，跳过: {} ({})", parentNode.dir(), e.getMessage());
                    continue;
                }
                for (Path child : children) {
                    String name = child.getFileName().toString();
                    BasicFileAttributes attrs;
                    try {
                        attrs = Files.readAttributes(child, BasicFileAttributes.class, java.nio.file.LinkOption.NOFOLLOW_LINKS);
                    } catch (IOException e) {
                        log.warn("导入时无法访问，跳过: {} ({})", child, e.getMessage());
                        continue;
                    }
                    if (attrs.isDirectory()) {
                        if (isIgnoredDirectoryName(name)) continue;
                        levelDirs.add(new DiskEntry(child, name, attrs));
                        levelDirParents.add(parentNode);
                    } else if (attrs.isRegularFile()) {
                        if (isIgnoredEntryName(name)) continue;
                        levelFiles.add(new DiskEntry(child, name, attrs));
                        levelFileParents.add(parentNode.folderId());
                    }
                }
            }

            List<ProjectFile> filesToSave = new java.util.ArrayList<>();
            for (int i = 0; i < levelFiles.size(); i++) {
                DiskEntry entry = levelFiles.get(i);
                Long parentId = levelFileParents.get(i);
                String fileName = entry.name();
                if (stats.imported >= maxImportEntries) {
                    stats.truncated = true;
                    if (stats.truncatedCount < truncatedCountCap) {
                        stats.truncatedCount++;
                    } else {
                        stats.truncatedCountCapped = true;
                    }
                    continue;
                }
                String rel = root.relativize(entry.path()).toString().replace('\\', '/');
                String logicalPath = "projects/" + projectId + "/" + rel;
                ProjectFile row = rowIndex.get(rowKey(parentId, fileName));
                if (row != null && !Boolean.TRUE.equals(row.getIsFolder())) {
                    if (Boolean.TRUE.equals(row.getIsDeleted())) {
                        stats.imported++;
                        continue; // 回收站里的文件不复活
                    }
                    boolean sameSize = row.getFileSize() != null && row.getFileSize() == entry.attrs().size();
                    boolean samePath = logicalPath.equals(row.getFilePath());
                    if (sameSize && samePath) {
                        stats.imported++;
                        continue; // 无变化不动行
                    }
                    row.setFileSize(entry.attrs().size());
                    row.setFileType(safeExtensionOf(fileName));
                    row.setFilePath(logicalPath);
                    row.setUpdatedAt(LocalDateTime.now());
                    filesToSave.add(row);
                    stats.imported++;
                    stats.changed++;
                    continue;
                }
                if (row != null && Boolean.TRUE.equals(row.getIsFolder()) && !Boolean.TRUE.equals(row.getIsDeleted())) {
                    log.warn("导入文件失败，跳过: {} (同名文件夹已存在)", entry.path());
                    continue;
                }
                if (row == null) {
                    ProjectFile moved = claimMovedRow(vanished, parentId, fileName, entry.attrs().size());
                    if (moved != null) {
                        try {
                            ProjectFile saved = projectFileService.relinkExternallyMoved(
                                    moved.getId(), parentId, fileName, logicalPath, userId);
                            vanished.remove(moved.getId());
                            rowIndex.put(rowKey(parentId, fileName), saved);
                            stats.imported++;
                            stats.changed++;
                            continue;
                        } catch (Exception e) {
                            log.warn("外部改名对齐失败，按新文件导入: {} ({})", entry.path(), e.getMessage());
                        }
                    }
                }
                if (!isValidNodeName(fileName)) {
                    log.warn("导入文件失败，跳过非法名称: {}", entry.path());
                    continue;
                }
                ProjectFile createdFile = buildNewFileEntity(
                        projectId, parentId, fileName, safeExtensionOf(fileName),
                        entry.attrs().size(), logicalPath, nextSortOrder(parentId, maxSortByParent), userId);
                filesToSave.add(createdFile);
                rowIndex.put(rowKey(parentId, fileName), createdFile);
                stats.imported++;
                stats.changed++;
            }

            if (!filesToSave.isEmpty()) {
                saveFilesBatchSafely(filesToSave);
            }

            List<PendingFolder> foldersToCreate = new java.util.ArrayList<>();
            List<DirLevelNode> nextLevel = new java.util.ArrayList<>();
            for (int i = 0; i < levelDirs.size(); i++) {
                DiskEntry entry = levelDirs.get(i);
                DirLevelNode parentNode = levelDirParents.get(i);
                Long parentId = parentNode.folderId();
                int childDepth = parentNode.depth() + 1;
                String dirName = entry.name();
                if (childDepth >= MAX_IMPORT_DEPTH) {
                    countSkippedSubtree(entry.path(), stats);
                    continue;
                }
                if (stats.imported >= maxImportEntries) {
                    countSkippedSubtree(entry.path(), stats);
                    continue;
                }
                ProjectFile row = rowIndex.get(rowKey(parentId, dirName));
                if (row != null && Boolean.TRUE.equals(row.getIsFolder())) {
                    if (Boolean.TRUE.equals(row.getIsDeleted())) {
                        continue; // 回收站里的文件夹不复活
                    }
                    stats.imported++;
                    nextLevel.add(new DirLevelNode(entry.path(), row.getId(), childDepth));
                    continue;
                }
                if (row != null && !Boolean.TRUE.equals(row.getIsFolder()) && !Boolean.TRUE.equals(row.getIsDeleted())) {
                    log.warn("导入文件夹失败，跳过子树: {} (同名文件已存在)", entry.path());
                    continue;
                }
                if (!isValidNodeName(dirName)) {
                    log.warn("导入文件夹失败，跳过非法名称: {}", entry.path());
                    continue;
                }
                ProjectFile createdFolder = buildNewFolderEntity(
                        projectId, parentId, dirName, nextSortOrder(parentId, maxSortByParent), userId);
                foldersToCreate.add(new PendingFolder(entry.path(), childDepth, createdFolder));
                rowIndex.put(rowKey(parentId, dirName), createdFolder);
                stats.imported++;
                stats.changed++;
            }

            if (!foldersToCreate.isEmpty()) {
                nextLevel.addAll(saveFoldersBatchSafely(foldersToCreate));
            }
            currentLevel = nextLevel;
        }

        if (stats.changed > 0) {
            projectFileService.signalChange(projectId, userId);
        }
        return stats;
    }

    /**
     * 自愈清理：
     * 1) 历史已入库的重型依赖目录（如 {@code node_modules}）及其子孙直接出索引（不碰磁盘）；
     * 2) 历史因无锁并发打开而产生的同父、同名、同类型存活重复行自动合并（子项归并到最早创建的唯一存活行，多余壳行删除）。
     */
    private static final Long HEAL_ROOT_KEY = 0L;

    private List<ProjectFile> healExistingRows(Long projectId, List<ProjectFile> rawRows) {
        if (rawRows == null || rawRows.isEmpty()) {
            return List.of();
        }
        Map<Long, List<ProjectFile>> byParent = new HashMap<>();
        for (ProjectFile f : rawRows) {
            Long normParent = normalizeParentId(f.getParentId());
            Long pKey = normParent == null ? HEAL_ROOT_KEY : normParent;
            byParent.computeIfAbsent(pKey, k -> new java.util.ArrayList<>()).add(f);
        }

        java.util.Set<Long> idsToPurge = new java.util.LinkedHashSet<>();
        java.util.Deque<Long> purgeQueue = new java.util.ArrayDeque<>();
        for (ProjectFile f : rawRows) {
            if (f.getId() == null) continue;
            boolean ignoredDir = Boolean.TRUE.equals(f.getIsFolder())
                    && !ProjectFileService.isRootStagingFolder(f)
                    && isIgnoredDirectoryName(f.getName());
            boolean ignoredFile = !Boolean.TRUE.equals(f.getIsFolder())
                    && isIgnoredEntryName(f.getName());
            if (ignoredDir || ignoredFile) {
                if (idsToPurge.add(f.getId()) && Boolean.TRUE.equals(f.getIsFolder())) {
                    purgeQueue.add(f.getId());
                }
            }
        }
        while (!purgeQueue.isEmpty()) {
            Long folderId = purgeQueue.poll();
            for (ProjectFile child : byParent.getOrDefault(folderId, List.of())) {
                if (child.getId() != null && idsToPurge.add(child.getId()) && Boolean.TRUE.equals(child.getIsFolder())) {
                    purgeQueue.add(child.getId());
                }
            }
        }

        List<ProjectFile> reparented = new java.util.ArrayList<>();
        java.util.Deque<Long> bfsParents = new java.util.ArrayDeque<>();
        java.util.Set<Long> visitedParents = new java.util.HashSet<>();
        bfsParents.add(HEAL_ROOT_KEY);
        visitedParents.add(HEAL_ROOT_KEY);

        while (!bfsParents.isEmpty()) {
            Long parentKey = bfsParents.poll();
            List<ProjectFile> children = byParent.getOrDefault(parentKey, List.of());
            if (children.isEmpty()) continue;

            Map<String, List<ProjectFile>> liveGroups = new java.util.LinkedHashMap<>();
            for (ProjectFile c : children) {
                if (c.getId() == null || idsToPurge.contains(c.getId()) || Boolean.TRUE.equals(c.getIsDeleted())) {
                    continue;
                }
                String groupKey = (Boolean.TRUE.equals(c.getIsFolder()) ? "D:" : "F:") + c.getName();
                liveGroups.computeIfAbsent(groupKey, k -> new java.util.ArrayList<>()).add(c);
            }

            for (List<ProjectFile> group : liveGroups.values()) {
                group.sort(java.util.Comparator.comparing(ProjectFile::getId));
                ProjectFile canonical = group.get(0);
                if (group.size() > 1) {
                    for (int i = 1; i < group.size(); i++) {
                        ProjectFile dup = group.get(i);
                        idsToPurge.add(dup.getId());
                        if (Boolean.TRUE.equals(canonical.getIsFolder())) {
                            List<ProjectFile> dupChildren = byParent.getOrDefault(dup.getId(), List.of());
                            for (ProjectFile dc : dupChildren) {
                                if (dc.getId() == null || idsToPurge.contains(dc.getId())) continue;
                                dc.setParentId(canonical.getId());
                                reparented.add(dc);
                                byParent.computeIfAbsent(canonical.getId(), k -> new java.util.ArrayList<>()).add(dc);
                            }
                        }
                    }
                }
                if (Boolean.TRUE.equals(canonical.getIsFolder()) && visitedParents.add(canonical.getId())) {
                    bfsParents.add(canonical.getId());
                }
            }
        }

        if (idsToPurge.isEmpty() && reparented.isEmpty()) {
            return rawRows;
        }

        List<ProjectFile> validReparented = reparented.stream()
                .filter(r -> r.getId() != null && !idsToPurge.contains(r.getId()))
                .toList();
        List<Long> purgeList = new java.util.ArrayList<>(idsToPurge);
        try {
            transactionTemplate.executeWithoutResult(status -> {
                if (!validReparented.isEmpty()) {
                    projectFileRepository.saveAll(validReparented);
                }
                for (int i = 0; i < purgeList.size(); i += BATCH_SAVE_CHUNK_SIZE) {
                    List<Long> chunk = purgeList.subList(i, Math.min(i + BATCH_SAVE_CHUNK_SIZE, purgeList.size()));
                    projectFileRepository.deleteAllByIdInBatch(chunk);
                }
            });
            log.info("自动清理本地项目历史重复/噪声行: project={}, purged={}, reparented={}",
                    projectId, purgeList.size(), validReparented.size());
        } catch (Exception e) {
            log.warn("自动清理本地项目历史重复/噪声行失败，继续正常导入: project={} ({})", projectId, e.getMessage());
            return rawRows;
        }

        return rawRows.stream()
                .filter(r -> r.getId() == null || !idsToPurge.contains(r.getId()))
                .toList();
    }

    private void saveFilesBatchSafely(List<ProjectFile> files) {
        for (int i = 0; i < files.size(); i += BATCH_SAVE_CHUNK_SIZE) {
            List<ProjectFile> chunk = files.subList(i, Math.min(i + BATCH_SAVE_CHUNK_SIZE, files.size()));
            try {
                transactionTemplate.executeWithoutResult(status -> projectFileRepository.saveAll(chunk));
            } catch (Exception batchEx) {
                log.warn("批量保存文件块失败，退回逐条保存: size={} ({})", chunk.size(), batchEx.getMessage());
                for (ProjectFile f : chunk) {
                    try {
                        transactionTemplate.executeWithoutResult(status -> projectFileRepository.save(f));
                    } catch (Exception singleEx) {
                        log.warn("导入文件失败，跳过: {} ({})", f.getName(), singleEx.getMessage());
                    }
                }
            }
        }
    }

    private List<DirLevelNode> saveFoldersBatchSafely(List<PendingFolder> folders) {
        List<DirLevelNode> savedNodes = new java.util.ArrayList<>(folders.size());
        for (int i = 0; i < folders.size(); i += BATCH_SAVE_CHUNK_SIZE) {
            List<PendingFolder> chunk = folders.subList(i, Math.min(i + BATCH_SAVE_CHUNK_SIZE, folders.size()));
            List<ProjectFile> entities = chunk.stream().map(PendingFolder::entity).toList();
            try {
                transactionTemplate.executeWithoutResult(status -> projectFileRepository.saveAll(entities));
                for (PendingFolder pf : chunk) {
                    if (pf.entity().getId() != null) {
                        savedNodes.add(new DirLevelNode(pf.dir(), pf.entity().getId(), pf.depth()));
                    }
                }
            } catch (Exception batchEx) {
                log.warn("批量保存文件夹块失败，退回逐条保存: size={} ({})", chunk.size(), batchEx.getMessage());
                for (PendingFolder pf : chunk) {
                    try {
                        ProjectFile saved = transactionTemplate.execute(status -> projectFileRepository.save(pf.entity()));
                        if (saved != null && saved.getId() != null) {
                            savedNodes.add(new DirLevelNode(pf.dir(), saved.getId(), pf.depth()));
                        }
                    } catch (Exception singleEx) {
                        log.warn("导入文件夹失败，跳过子树: {} ({})", pf.dir(), singleEx.getMessage());
                    }
                }
            }
        }
        return savedNodes;
    }

    private static Long normalizeParentId(Long parentId) {
        return (parentId != null && parentId == 0L) ? null : parentId;
    }

    private static int nextSortOrder(Long parentId, Map<Long, Integer> maxSortByParent) {
        Long normParent = normalizeParentId(parentId);
        Integer currentMax = maxSortByParent.get(normParent);
        int next = currentMax == null ? 0 : currentMax + 1;
        maxSortByParent.put(normParent, next);
        return next;
    }

    private static boolean isValidNodeName(String raw) {
        if (!StringUtils.hasText(raw)) return false;
        String trimmed = raw.trim();
        if (trimmed.length() > 200) return false;
        if (trimmed.contains("/") || trimmed.contains("\\")) return false;
        return !".".equals(trimmed) && !"..".equals(trimmed);
    }

    private static String safeExtensionOf(String name) {
        String ext = extensionOf(name);
        return ext.length() > 32 ? ext.substring(0, 32) : ext;
    }

    private static ProjectFile buildNewFolderEntity(Long projectId, Long parentId, String dirName, int sortOrder, Long userId) {
        ProjectFile folder = new ProjectFile();
        folder.setProjectId(projectId);
        folder.setParentId(normalizeParentId(parentId));
        folder.setIsFolder(true);
        folder.setName(dirName.trim());
        folder.setSortOrder(sortOrder);
        folder.setUserId(userId);
        LocalDateTime now = LocalDateTime.now();
        folder.setCreatedAt(now);
        folder.setUpdatedAt(now);
        folder.setIsDeleted(false);
        return folder;
    }

    private ProjectFile buildNewFileEntity(Long projectId, Long parentId, String fileName, String fileType,
                                           long fileSize, String logicalPath, int sortOrder, Long userId) {
        ProjectFile file = new ProjectFile();
        file.setProjectId(projectId);
        file.setParentId(normalizeParentId(parentId));
        file.setIsFolder(false);
        file.setName(fileName.trim());
        file.setFileType(fileType);
        file.setFileSize(fileSize);
        file.setFilePath(logicalPath);
        file.setWpsFileId(projectFileService.generateWpsFileId(projectId));
        file.setSortOrder(sortOrder);
        file.setUserId(userId);
        LocalDateTime now = LocalDateTime.now();
        file.setCreatedAt(now);
        file.setUpdatedAt(now);
        file.setIsDeleted(false);
        return file;
    }

    /** 库里活着、按 filePath 在磁盘上已找不到的文件行（按 id 索引，可变：认领后移除）。 */
    private Map<Long, ProjectFile> vanishedFileRows(Long projectId) {
        Map<Long, ProjectFile> out = new HashMap<>();
        for (ProjectFile f : projectFileRepository.findByProjectId(projectId)) {
            if (Boolean.TRUE.equals(f.getIsDeleted()) || Boolean.TRUE.equals(f.getIsFolder())) continue;
            if (!StringUtils.hasText(f.getFilePath())) continue;
            try {
                if (!Files.exists(storageResolver.resolve(f.getFilePath()))) out.put(f.getId(), f);
            } catch (Exception ignored) {
                // 路径异常的行不参与认领
            }
        }
        return out;
    }

    /**
     * 给一个「没有对应行的新文件」找它的旧身份：大小相同、扩展名相同，且要么同目录
     * （改名）、要么同名（移到别的目录）。<b>恰好一个候选才认</b>——认不准就退回
     * 「新建 + 旧行进回收站」的旧语义，宁可多一条回收站记录也不把两份文件认成一份。
     * （不存 inode：库里没有这一列，而旧文件已经不在，事后也 stat 不到。）
     */
    static ProjectFile claimMovedRow(Map<Long, ProjectFile> vanished, Long parentId, String fileName, long size) {
        if (vanished == null || vanished.isEmpty()) return null;
        String ext = extensionOf(fileName);
        ProjectFile hit = null;
        for (ProjectFile f : vanished.values()) {
            if (f.getFileSize() == null || f.getFileSize() != size) continue;
            if (!ext.equals(extensionOf(f.getName()))) continue;
            boolean sameDir = java.util.Objects.equals(f.getParentId(), parentId);
            boolean sameName = fileName.equals(f.getName());
            if (!sameDir && !sameName) continue;
            if (hit != null) return null; // 不止一个候选：有歧义，不认
            hit = f;
        }
        return hit;
    }

    private static String extensionOf(String name) {
        if (name == null) return "";
        int dot = name.lastIndexOf('.');
        return dot > 0 ? name.substring(dot + 1).toLowerCase() : "";
    }

    private static String rowKey(Long parentId, String name) {
        return (parentId == null ? "root" : String.valueOf(parentId)) + "/" + name;
    }
}
