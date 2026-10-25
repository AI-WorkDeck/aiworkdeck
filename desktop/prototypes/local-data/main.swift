// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import Foundation
import CoreFoundation
import CryptoKit
import SQLite3
import Darwin

// A deliberately isolated, single-writer prototype. Never opens or migrates H2.
struct Failure: Error {
    let code: String
    let message: String
    init(_ code: String, _ message: String) { self.code = code; self.message = message }
}
func require(_ condition: Bool, _ code: String, _ message: String) throws {
    if !condition { throw Failure(code, message) }
}
func string(_ p: [String: Any], _ key: String) throws -> String {
    guard let value = p[key] as? String, !value.isEmpty else { throw Failure("INVALID_ARGUMENT", "Missing string: \(key)") }
    return value
}
func integer(_ p: [String: Any], _ key: String) throws -> Int64 {
    guard let n = p[key] as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(),
          n.doubleValue > 0, n.doubleValue <= 9_007_199_254_740_991,
          n.doubleValue == Double(n.int64Value) else { throw Failure("INVALID_ARGUMENT", "Invalid positive integer: \(key)") }
    return n.int64Value
}
func optionalInteger(_ p: [String: Any], _ key: String) throws -> Int64 {
    guard let raw = p[key], !(raw is NSNull) else { return 0 }
    return try integer(p, key)
}
func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
func now() -> String { ISO8601DateFormatter().string(from: Date()) }
func checkedPOSIX(_ result: Int32, _ action: String) throws {
    if result != 0 { throw Failure("IO_ERROR", "\(action): \(String(cString: strerror(errno)))") }
}
func syncDirectory(_ path: String) throws {
    let fd = open(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
    try require(fd >= 0, "IO_ERROR", "Cannot open directory for sync")
    defer { close(fd) }
    try checkedPOSIX(fsync(fd), "Directory sync")
}
func noSymlink(_ path: String, directory: Bool) throws {
    var info = stat()
    try require(lstat(path, &info) == 0, "NOT_FOUND", "Path does not exist")
    let kind = info.st_mode & S_IFMT
    try require(kind == (directory ? S_IFDIR : S_IFREG), "UNSAFE_PATH", "Only real \(directory ? "directories" : "files") are allowed")
    if !directory { try require(info.st_nlink == 1, "UNSAFE_PATH", "Hard-linked files are outside this prototype") }
}
func existsWithoutFollowing(_ path: String) throws -> Bool {
    var info = stat()
    if lstat(path, &info) == 0 { return true }
    try require(errno == ENOENT, "IO_ERROR", "Cannot inspect path")
    return false
}
func ensureDirectory(_ path: String) throws {
    if try existsWithoutFollowing(path) { try noSymlink(path, directory: true) }
    else { try checkedPOSIX(mkdir(path, 0o700), "Create directory") }
}

final class Database {
    var handle: OpaquePointer?
    init(_ path: String) throws {
        guard sqlite3_open_v2(path, &handle, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nil) == SQLITE_OK else {
            throw Failure("DATABASE_ERROR", "Cannot open prototype SQLite database")
        }
        sqlite3_busy_timeout(handle, 1000)
        let version = try query("PRAGMA user_version").first?["user_version"] as? Int64 ?? 0
        try require(version <= 3, "UNSUPPORTED_SCHEMA", "Profile was created by a newer data service")
        if version < 3 {
            try require(try query("SELECT name FROM sqlite_master WHERE name='migration_archive'").isEmpty,
                        "NEEDS_REIMPORT", "Imported profiles must be reimported with their original identity and permissions")
        }
        try execute("PRAGMA journal_mode=WAL")
        try execute("PRAGMA synchronous=FULL")
        try execute("PRAGMA foreign_keys=ON")
        if version < 3 { try migrateSyntheticProfile() }
    }
    // Old standalone samples have one synthetic owner. Imported archives must never acquire
    // that identity. Tree and ACL upgrades share one transaction, including FK validation.
    func migrateSyntheticProfile() throws {
        try execute("PRAGMA foreign_keys=OFF")
        defer { try? execute("PRAGMA foreign_keys=ON") }
        try transaction {
            let fileColumns = try query("PRAGMA table_info(files)").compactMap { $0["name"] as? String }
            if !fileColumns.isEmpty && !fileColumns.contains("parent_id") { try migrateFlatFiles() }
            try execute("CREATE TABLE IF NOT EXISTS projects(id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)")
            try execute("CREATE TABLE IF NOT EXISTS files(id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, project_id INTEGER NOT NULL REFERENCES projects(id), parent_id INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL, kind INTEGER NOT NULL DEFAULT 0, size INTEGER NOT NULL, generation TEXT NOT NULL, live INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, UNIQUE(project_id,parent_id,name))")
            try execute("CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            try execute("CREATE TABLE IF NOT EXISTS pending(file_id INTEGER PRIMARY KEY REFERENCES files(id), stage TEXT NOT NULL, expected TEXT, generation TEXT NOT NULL, size INTEGER NOT NULL, updated_at TEXT NOT NULL)")
            try execute("CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT NOT NULL UNIQUE,display_name TEXT,role TEXT NOT NULL)")
            try execute("CREATE TABLE profile_identity(id INTEGER PRIMARY KEY CHECK(id=1),selected_user_id INTEGER NOT NULL REFERENCES users(id))")
            try execute("CREATE TABLE project_members(project_id INTEGER NOT NULL REFERENCES projects(id),user_id INTEGER NOT NULL REFERENCES users(id),role TEXT NOT NULL,PRIMARY KEY(project_id,user_id))")
            try execute("INSERT INTO users VALUES(1,'local','本机用户','USER')")
            try execute("INSERT INTO profile_identity VALUES(1,1)")
            try execute("ALTER TABLE projects ADD COLUMN user_id INTEGER REFERENCES users(id)")
            try execute("ALTER TABLE projects ADD COLUMN project_type TEXT NOT NULL DEFAULT 'BLANK'")
            try execute("ALTER TABLE files ADD COLUMN user_id INTEGER REFERENCES users(id)")
            try execute("ALTER TABLE files ADD COLUMN client_visible INTEGER NOT NULL DEFAULT 0 CHECK(client_visible IN (0,1))")
            try execute("UPDATE projects SET user_id=1")
            try execute("UPDATE files SET user_id=1")
            try require(try query("PRAGMA foreign_key_check").isEmpty, "MIGRATION_CONFLICT", "Existing profile references are inconsistent")
            try execute("PRAGMA user_version=3")
        }
    }
    // Called within the schema transaction with foreign keys temporarily disabled.
    // Preserve the identity high-water mark even when the greatest file was deleted.
    func migrateFlatFiles() throws {
        try execute("CREATE TABLE files_tree(id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, project_id INTEGER NOT NULL REFERENCES projects(id), parent_id INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL, kind INTEGER NOT NULL DEFAULT 0, size INTEGER NOT NULL, generation TEXT NOT NULL, live INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, UNIQUE(project_id,parent_id,name))")
        try execute("INSERT INTO files_tree(id,uid,project_id,parent_id,name,kind,size,generation,live,updated_at) SELECT id,uid,project_id,0,name,0,size,generation,live,updated_at FROM files")
        let oldSequence = (try query("SELECT seq FROM sqlite_sequence WHERE name='files'").first?["seq"] as? Int64) ?? 0
        try execute("DROP TABLE files")
        try execute("ALTER TABLE files_tree RENAME TO files")
        try execute("UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name='files'", [oldSequence])
    }
    deinit { sqlite3_close(handle) }
    func query(_ sql: String, _ values: [Any?] = []) throws -> [[String: Any]] {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK else { throw Failure("DATABASE_ERROR", String(cString: sqlite3_errmsg(handle))) }
        defer { sqlite3_finalize(statement) }
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        for (offset, value) in values.enumerated() {
            let i = Int32(offset + 1)
            let result: Int32
            if let n = value as? Int64 { result = sqlite3_bind_int64(statement, i, n) }
            else if let n = value as? Int { result = sqlite3_bind_int64(statement, i, Int64(n)) }
            else if let s = value as? String {
                try require(!s.contains("\0"), "INVALID_ARGUMENT", "Text metadata must not contain U+0000")
                result = sqlite3_bind_text(statement, i, s, -1, transient)
            }
            else { result = sqlite3_bind_null(statement, i) }
            guard result == SQLITE_OK else { throw Failure("DATABASE_ERROR", "Cannot bind query parameter") }
        }
        var rows: [[String: Any]] = []
        while true {
            let result = sqlite3_step(statement)
            if result == SQLITE_DONE { return rows }
            guard result == SQLITE_ROW else { throw Failure("DATABASE_ERROR", String(cString: sqlite3_errmsg(handle))) }
            var row: [String: Any] = [:]
            for i in 0..<sqlite3_column_count(statement) {
                let key = String(cString: sqlite3_column_name(statement, i))
                switch sqlite3_column_type(statement, i) {
                case SQLITE_INTEGER: row[key] = sqlite3_column_int64(statement, i)
                case SQLITE_TEXT: row[key] = String(cString: sqlite3_column_text(statement, i))
                default: row[key] = NSNull()
                }
            }
            rows.append(row)
        }
    }
    func execute(_ sql: String, _ values: [Any?] = []) throws { _ = try query(sql, values) }
    func transaction(_ body: () throws -> Void) throws {
        try execute("BEGIN IMMEDIATE")
        do { try body(); try execute("COMMIT") }
        catch { try? execute("ROLLBACK"); throw error }
    }
    // Call inside the insertion transaction, before creating any file or directory.
    // Returning a larger ID would create data the JSON protocol cannot address.
    func generatedID() throws -> Int64 {
        let id = sqlite3_last_insert_rowid(handle)
        try require(id > 0 && id <= 9_007_199_254_740_991, "IDENTITY_EXHAUSTED", "No safe numeric IDs remain")
        return id
    }
}

final class Store {
    let root: String
    let storage: String
    let db: Database
    let lockFD: Int32
    var blocked = false
    let launchTime = DispatchTime.now().uptimeNanoseconds
    init(profile: String) throws {
        try require(profile.hasPrefix("/"), "UNSAFE_PROFILE", "An absolute isolated profile is required")
        let raw = URL(fileURLWithPath: profile).standardizedFileURL
        try require(raw.path == raw.resolvingSymlinksInPath().path, "UNSAFE_PROFILE", "Profile must not contain symlinks")
        root = raw.path
        storage = root + "/storage/projects"
        let fm = FileManager.default
        let marker = root + "/.awd-local-data-prototype"
        if try existsWithoutFollowing(root) {
            try noSymlink(root, directory: true)
            let children = try fm.contentsOfDirectory(atPath: root)
            try require(children.isEmpty || (try existsWithoutFollowing(marker)), "UNSAFE_PROFILE", "Refusing a nonempty profile without the prototype marker")
        } else { try fm.createDirectory(atPath: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]) }
        if try !existsWithoutFollowing(marker) { try Data("isolated-native-data-prototype-v1\n".utf8).write(to: URL(fileURLWithPath: marker), options: .withoutOverwriting) }
        try noSymlink(marker, directory: false)
        try require(try String(contentsOfFile: marker, encoding: .utf8) == "isolated-native-data-prototype-v1\n", "UNSAFE_PROFILE", "Invalid prototype profile marker")
        lockFD = open(root + "/owner.lock", O_RDWR | O_CREAT | O_NOFOLLOW, 0o600)
        try require(lockFD >= 0, "UNSAFE_PROFILE", "Cannot open ownership lock")
        try require(flock(lockFD, LOCK_EX | LOCK_NB) == 0, "PROFILE_BUSY", "Another process owns this prototype profile")
        try ensureDirectory(root + "/storage")
        try ensureDirectory(storage)
        let dbPath = root + "/local.sqlite"
        for suffix in ["", "-wal", "-shm"] {
            if try existsWithoutFollowing(dbPath + suffix) { try noSymlink(dbPath + suffix, directory: false) }
        }
        db = try Database(dbPath)
        try recover()
    }
    deinit { flock(lockFD, LOCK_UN); close(lockFD) }
    func selectedUser() throws -> [String: Any]? {
        guard let user = try db.query("SELECT u.* FROM profile_identity i JOIN users u ON u.id=i.selected_user_id WHERE i.id=1").first,
              let id = user["id"] as? Int64, id > 0, id <= 9_007_199_254_740_991,
              let role = user["role"] as? String, ["USER", "ADMIN", "CLIENT"].contains(role.uppercased()) else { return nil }
        return user
    }
    func identityStatus() throws -> [String: Any] {
        let user = try selectedUser()
        return ["localMode": true, "userId": user?["id"] ?? NSNull(), "needsSelection": user == nil]
    }
    struct ProjectAccess {
        let userID: Int64
        let role: String
        let client: Bool
        let canWrite: Bool
    }
    func isGlobalClient(_ user: [String: Any]) -> Bool {
        (user["role"] as? String)?.uppercased() == "CLIENT"
    }
    // Match ProjectMemberService: owner wins over a member role, but a global CLIENT
    // remains a client even when the project owner. Never cache ACLs across requests.
    func projectAccess(_ row: [String: Any], _ user: [String: Any]) throws -> ProjectAccess {
        guard let owner = row["user_id"] as? Int64,
              try !db.query("SELECT id FROM users WHERE id=?", [owner]).isEmpty else {
            throw Failure("ACCESS_DENIED", "Project is not accessible")
        }
        let userID = user["id"] as! Int64
        let role: String
        if owner == userID { role = "OWNER" }
        else {
            guard let member = try db.query("SELECT role FROM project_members WHERE project_id=? AND user_id=?", [row["id"], userID]).first,
                  let memberRole = member["role"] as? String,
                  ["ADMIN", "PARTICIPANT", "READ_ONLY", "CLIENT", "CLIENT_NAMED", "CLIENT_GENERIC"].contains(memberRole) else {
                throw Failure("ACCESS_DENIED", "Project is not accessible")
            }
            role = memberRole
        }
        let client = isGlobalClient(user) || ["CLIENT", "CLIENT_NAMED", "CLIENT_GENERIC"].contains(role)
        return ProjectAccess(userID: userID, role: role, client: client,
                             canWrite: !client && ["OWNER", "ADMIN", "PARTICIPANT"].contains(role))
    }
    func requireWrite(_ access: ProjectAccess) throws {
        try require(access.canWrite, "ACCESS_DENIED", "Project does not allow document changes")
    }
    func requireRead(_ row: [String: Any], _ access: ProjectAccess) throws {
        try require(!access.client || row["user_id"] as? Int64 == access.userID || row["client_visible"] as? Int64 == 1,
                    "NOT_FOUND", "File is not available")
    }
    func project(_ id: Int64) throws -> [String: Any] {
        guard let row = try db.query("SELECT * FROM projects WHERE id=?", [id]).first else { throw Failure("NOT_FOUND", "Project does not exist") }
        return row
    }
    func projectPath(_ id: Int64) throws -> String {
        _ = try project(id)
        try checkStorage()
        let path = storage + "/\(id)"
        try noSymlink(path, directory: true)
        return path
    }
    func checkStorage() throws {
        try noSymlink(root, directory: true)
        try noSymlink(root + "/storage", directory: true)
        try noSymlink(storage, directory: true)
    }
    func file(_ projectID: Int64, _ fileID: Int64, includePending: Bool = false) throws -> [String: Any] {
        guard let row = try db.query("SELECT * FROM files WHERE project_id=? AND id=?" + (includePending ? "" : " AND live=1"), [projectID, fileID]).first else { throw Failure("NOT_FOUND", "File does not exist in this project") }
        return row
    }
    func directory(_ projectID: Int64, _ dirID: Int64) throws -> [String: Any] {
        guard let row = try db.query("SELECT * FROM files WHERE project_id=? AND id=? AND kind=1 AND live=1", [projectID, dirID]).first else { throw Failure("NOT_FOUND", "Directory does not exist in this project") }
        return row
    }
    func isDirectory(_ row: [String: Any]) -> Bool { (row["kind"] as? Int64 ?? 0) == 1 }
    // Ancestor directory names of a file row, root-first. The chain is resolved per access
    // (never a startup full-tree scan); a broken, cross-project, cyclic or over-deep chain is rejected.
    func chain(_ row: [String: Any]) throws -> [String] {
        let projectID = row["project_id"] as! Int64
        var names: [String] = []
        var current = row
        var visited: Set<Int64> = []
        while let parentID = current["parent_id"] as? Int64, parentID != 0 {
            guard let parent = try db.query("SELECT * FROM files WHERE id=? AND project_id=? AND kind=1 AND live=1", [parentID, projectID]).first else { throw Failure("UNSAFE_PATH", "Directory parent chain is broken") }
            let parentFileID = parent["id"] as! Int64
            try require(!visited.contains(parentFileID) && visited.count < 64, "CYCLE_DETECTED", "Directory parent chain is cyclic or too deep")
            visited.insert(parentFileID)
            let name = parent["name"] as! String
            try validateName(name)
            names.insert(name, at: 0)
            current = parent
        }
        return names
    }
    // Resolves the on-disk path from the parent chain and rejects symlink escapes at every level.
    func filePath(_ row: [String: Any]) throws -> String {
        var path = try projectPath(row["project_id"] as! Int64)
        for component in try chain(row) {
            path += "/" + component
            try noSymlink(path, directory: true)
        }
        let name = row["name"] as! String
        try validateName(name)
        return path + "/" + name
    }
    func directoryPath(_ projectID: Int64, _ parentID: Int64) throws -> String {
        if parentID == 0 { return try projectPath(projectID) }
        let path = try filePath(directory(projectID, parentID))
        try noSymlink(path, directory: true)
        return path
    }
    func validateName(_ name: String) throws {
        try require(!name.isEmpty && name.utf8.count <= 240 && name != "." && name != ".." && !name.hasPrefix(".awd") && !name.hasPrefix(".native-") && !name.contains("/") && !name.contains("\\") && !name.contains("\0"), "UNSAFE_PATH", "Use a single safe file name")
    }
    func readBytes(_ path: String) throws -> Data {
        try noSymlink(path, directory: false)
        let fd = open(path, O_RDONLY | O_NOFOLLOW)
        try require(fd >= 0, "IO_ERROR", "Cannot read file")
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        var info = stat()
        try checkedPOSIX(fstat(fd, &info), "Read file attributes")
        try require(info.st_size <= 32 * 1024 * 1024, "UNSUPPORTED", "Prototype reads are limited to 32 MiB")
        return try handle.readToEnd() ?? Data()
    }
    func fileDTO(_ row: [String: Any], _ access: ProjectAccess) throws -> [String: Any] {
        let projectID = row["project_id"] as! Int64
        let name = row["name"] as! String
        let parentID = row["parent_id"] as? Int64 ?? 0
        let folder = isDirectory(row)
        var result: [String: Any] = ["id": row["id"]!, "uid": row["uid"]!, "projectId": projectID, "name": name,
                "fileType": folder ? "" : (name as NSString).pathExtension,
                "isFolder": folder, "fileSize": row["size"]!, "generation": row["generation"]!, "updatedAt": row["updated_at"]!, "tags": [],
                "canWrite": access.canWrite]
        // Direct customer reads can refer to a visible file below a hidden folder.
        // Do not expose that folder's ID/name through a path or reconstruct an Explorer tree.
        if !access.client {
            result["parentId"] = parentID == 0 ? NSNull() : parentID
            result["filePath"] = "projects/\(projectID)/" + (try chain(row) + [name]).joined(separator: "/")
        }
        return result
    }
    func projectDTO(_ row: [String: Any], _ access: ProjectAccess) -> [String: Any] {
        ["id": row["id"]!, "uid": row["uid"]!, "name": row["name"]!, "projectType": row["project_type"]!, "myRole": access.role, "canWrite": access.canWrite, "canBrowseFiles": !access.client,
         "createdAt": row["created_at"]!, "updatedAt": row["updated_at"]!, "lastActivityAt": row["updated_at"]!]
    }
    func decoded(_ p: [String: Any]) throws -> Data {
        guard let encoded = p["contentBase64"] as? String, let data = Data(base64Encoded: encoded), data.count <= 32 * 1024 * 1024 else { throw Failure("INVALID_ARGUMENT", "contentBase64 must contain at most 32 MiB") }
        return data
    }
    func writeStage(_ data: Data, _ path: String) throws {
        let fd = open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        try require(fd >= 0, "IO_ERROR", "Cannot create staged file")
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        try handle.write(contentsOf: data)
        try checkedPOSIX(fsync(fd), "Staged file sync")
    }
    func complete(_ fileID: Int64, _ pending: [String: Any], _ projectID: Int64) throws {
        try db.transaction {
            try db.execute("UPDATE files SET generation=?,size=?,live=1,updated_at=? WHERE id=?", [pending["generation"], pending["size"], pending["updated_at"], fileID])
            try db.execute("UPDATE projects SET updated_at=? WHERE id=?", [pending["updated_at"], projectID])
            try db.execute("DELETE FROM pending WHERE file_id=?", [fileID])
        }
    }
    func publish(_ row: [String: Any], _ pending: [String: Any]) throws {
        let target = try filePath(row)
        let parent = (target as NSString).deletingLastPathComponent
        let stageName = pending["stage"] as! String
        try require(stageName.hasPrefix(".native-") && !stageName.contains("/") && !stageName.contains("\\"), "RECOVERY_CONFLICT", "Invalid journal stage")
        let stage = parent + "/" + stageName
        let expected = pending["expected"] as? String
        let newGeneration = pending["generation"] as! String
        let exists = FileManager.default.fileExists(atPath: target)
        if exists {
            let current = digest(try readBytes(target))
            if current == newGeneration {
                try complete(row["id"] as! Int64, pending, row["project_id"] as! Int64)
                try? FileManager.default.removeItem(atPath: stage)
                return
            }
            try require(expected != nil && current == expected, "CONFLICT", "File changed outside this save; original preserved")
            try require(access(target, W_OK) == 0, "IO_ERROR", "File is not writable")
        } else { try require(expected == nil, "NOT_FOUND", "Original file disappeared; refusing to recreate it") }
        try require(digest(try readBytes(stage)) == newGeneration, "RECOVERY_CONFLICT", "Staged content hash does not match journal")
        // Darwin's exclusive rename creates without overwriting an unrelated file.
        if expected == nil {
            try checkedPOSIX(renamex_np(stage, target, UInt32(RENAME_EXCL)), "Publish new file")
        } else { try checkedPOSIX(rename(stage, target), "Atomic replace") }
        try syncDirectory(parent)
        if ProcessInfo.processInfo.environment["AWD_LOCAL_DATA_TEST_FAULT"] == "afterRename" { _exit(77) }
        try complete(row["id"] as! Int64, pending, row["project_id"] as! Int64)
    }
    func recover() throws {
        for pending in try db.query("SELECT * FROM pending ORDER BY file_id") {
            guard let row = try db.query("SELECT * FROM files WHERE id=?", [pending["file_id"]]).first else { throw Failure("RECOVERY_CONFLICT", "Journal references missing file") }
            try publish(row, pending)
        }
    }
    func save(_ row: [String: Any], _ data: Data, expected: String?, access: ProjectAccess) throws -> [String: Any] {
        let target = try filePath(row)
        if let expected = expected {
            try require(digest(try readBytes(target)) == expected, "CONFLICT", "File changed since it was read")
            try require(Darwin.access(target, W_OK) == 0, "IO_ERROR", "File is not writable")
        } else { try require(!FileManager.default.fileExists(atPath: target), "CONFLICT", "File name already exists") }
        let stageName = ".native-" + UUID().uuidString + ".pending"
        let stage = (target as NSString).deletingLastPathComponent + "/" + stageName
        let newGeneration = digest(data)
        var journaled = false
        do {
            try writeStage(data, stage)
            if expected != nil {
                var info = stat()
                try checkedPOSIX(lstat(target, &info), "Read original permissions")
                try checkedPOSIX(chmod(stage, info.st_mode & 0o777), "Preserve file permissions")
            }
            try syncDirectory((target as NSString).deletingLastPathComponent)
            try db.execute("INSERT INTO pending(file_id,stage,expected,generation,size,updated_at) VALUES(?,?,?,?,?,?)", [row["id"], stageName, expected, newGeneration, data.count, now()])
            journaled = true
            if ProcessInfo.processInfo.environment["AWD_LOCAL_DATA_TEST_FAULT"] == "afterJournal" { _exit(77) }
            let pending = try db.query("SELECT * FROM pending WHERE file_id=?", [row["id"]]).first!
            try publish(row, pending)
        } catch {
            if journaled {
                // The disk may have changed before a failed database commit. Never guess success.
                blocked = true
                throw Failure("RECOVERY_REQUIRED", "Save outcome is unresolved. Close and restart this profile before further operations.")
            }
            try? FileManager.default.removeItem(atPath: stage)
            throw error
        }
        let result = try file(row["project_id"] as! Int64, row["id"] as! Int64)
        return try fileDTO(result, access)
    }
    func call(_ method: String, _ p: [String: Any]) throws -> Any {
        if method == "health" {
            return ["ready": !blocked, "protocolVersion": 1, "backend": "swift-sqlite-isolated-prototype", "profile": root,
                    "capabilities": ["projects", "flat-files", "file-tree", "atomic-save", "ui-settings", "local-identity-acl"],
                    "unavailable": ["h2-migration", "ai", "git-versions", "cloud-acl", "watcher", "external-files"],
                    "identityStatus": try identityStatus(),
                    "elapsedMs": Double(DispatchTime.now().uptimeNanoseconds - launchTime) / 1_000_000]
        }
        if method == "identity.status" { return try identityStatus() }
        try require(!blocked, "RECOVERY_REQUIRED", "A previous save has an unresolved outcome; restart required")
        guard let user = try selectedUser() else { throw Failure("IDENTITY_REQUIRED", "Select a valid identity in this profile before continuing") }
        switch method {
        case "projects.list":
            return try db.query("SELECT p.* FROM projects p JOIN users u ON u.id=p.user_id WHERE p.project_type<>'LOOSE_FILES' AND (p.user_id=? OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=?)) ORDER BY p.id", [user["id"], user["id"]])
                .map { row in projectDTO(row, try projectAccess(row, user)) }
        case "projects.get":
            let row = try project(integer(p, "projectId"))
            return try projectDTO(row, projectAccess(row, user))
        case "projects.create":
            try require(!isGlobalClient(user), "ACCESS_DENIED", "Customer accounts cannot create projects")
            try checkStorage()
            let name = try string(p, "name")
            try require(name.utf8.count <= 240, "INVALID_ARGUMENT", "Project name is too long")
            var id: Int64 = 0
            var path: String?
            var createdDirectory = false
            do {
                try db.transaction {
                    let timestamp = now()
                    try db.execute("INSERT INTO projects(uid,name,created_at,updated_at,user_id) VALUES(?,?,?,?,?)", [UUID().uuidString, name, timestamp, timestamp, user["id"]])
                    id = try db.generatedID()
                    path = storage + "/\(id)"
                    try require(!FileManager.default.fileExists(atPath: path!), "CONFLICT", "Project storage already exists")
                    try FileManager.default.createDirectory(atPath: path!, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
                    createdDirectory = true
                    try syncDirectory(storage)
                }
            } catch { if createdDirectory, let path = path { try? FileManager.default.removeItem(atPath: path) }; throw error }
            let row = try project(id)
            return try projectDTO(row, projectAccess(row, user))
        case "files.list":
            let id = try integer(p, "projectId")
            let access = try projectAccess(project(id), user)
            try require(!access.client, "ACCESS_DENIED", "Customer accounts cannot browse the project file tree")
            _ = try projectPath(id)
            return try db.query("SELECT * FROM files WHERE project_id=? AND live=1 ORDER BY id", [id]).map { try fileDTO($0, access) }
        case "files.read":
            let projectID = try integer(p, "projectId")
            let access = try projectAccess(project(projectID), user)
            let row = try file(projectID, integer(p, "fileId"))
            try requireRead(row, access)
            try require(!isDirectory(row), "IS_DIRECTORY", "Directories cannot be read as files")
            let path = try filePath(row)
            let bytes = try readBytes(path)
            var result = try fileDTO(row, access)
            result["generation"] = digest(bytes)
            result["fileSize"] = bytes.count
            result["contentBase64"] = bytes.base64EncodedString()
            if !access.client { result["physicalPath"] = path }
            return result
        case "files.mkdir":
            let projectID = try integer(p, "projectId")
            let access = try projectAccess(project(projectID), user)
            try requireWrite(access)
            let parentID = try optionalInteger(p, "parentId")
            let parentPath = try directoryPath(projectID, parentID)
            let name = try string(p, "name")
            try validateName(name)
            try require(try db.query("SELECT id FROM files WHERE project_id=? AND parent_id=? AND name=?", [projectID, parentID, name]).isEmpty, "CONFLICT", "Name already exists in this directory")
            let target = parentPath + "/" + name
            try require(try !existsWithoutFollowing(target), "CONFLICT", "Name already exists on disk")
            var createdDirectory = false
            var id: Int64 = 0
            do {
                try db.transaction {
                    try db.execute("INSERT INTO files(uid,project_id,parent_id,name,kind,size,generation,live,updated_at,user_id) VALUES(?,?,?,?,1,0,'',1,?,?)", [UUID().uuidString, projectID, parentID, name, now(), access.userID])
                    id = try db.generatedID()
                    try checkedPOSIX(mkdir(target, 0o700), "Create directory")
                    createdDirectory = true
                    try syncDirectory(parentPath)
                }
            } catch {
                if createdDirectory { _ = rmdir(target) } // Preserve any uncoordinated external additions.
                throw error
            }
            return try fileDTO(file(projectID, id), access)
        case "files.create":
            let projectID = try integer(p, "projectId")
            let access = try projectAccess(project(projectID), user)
            try requireWrite(access)
            _ = try projectPath(projectID)
            let parentID = try optionalInteger(p, "parentId")
            if parentID != 0 { _ = try directory(projectID, parentID) }
            let name = try string(p, "name")
            try validateName(name)
            let data = try decoded(p)
            try require(try db.query("SELECT id FROM files WHERE project_id=? AND parent_id=? AND name=?", [projectID, parentID, name]).isEmpty, "CONFLICT", "File name already exists in this directory")
            var id: Int64 = 0
            try db.transaction {
                try db.execute("INSERT INTO files(uid,project_id,parent_id,name,kind,size,generation,updated_at,user_id) VALUES(?,?,?,?,0,0,?,?,?)", [UUID().uuidString, projectID, parentID, name, "", now(), access.userID])
                id = try db.generatedID()
            }
            do { return try save(file(projectID, id, includePending: true), data, expected: nil, access: access) }
            catch { if !blocked { try? db.execute("DELETE FROM files WHERE id=? AND live=0", [id]) }; throw error }
        case "files.save":
            let projectID = try integer(p, "projectId")
            let access = try projectAccess(project(projectID), user)
            try requireWrite(access)
            let row = try file(projectID, integer(p, "fileId"))
            try require(!isDirectory(row), "IS_DIRECTORY", "Directories cannot be saved as files")
            return try save(row, decoded(p), expected: string(p, "expectedGeneration"), access: access)
        case "settings.get", "settings.set":
            let key = try string(p, "key")
            try require(key.hasPrefix("local.ui.") && key.utf8.count <= 128, "UNSUPPORTED", "Only local.ui.* settings are owned by this prototype")
            if method == "settings.set" {
                guard let value = p["value"], JSONSerialization.isValidJSONObject([value]) else { throw Failure("INVALID_ARGUMENT", "Expected a JSON setting value") }
                let data = try JSONSerialization.data(withJSONObject: [value], options: [.sortedKeys])
                try require(data.count <= 65536, "INVALID_ARGUMENT", "Setting value is too large")
                try db.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, String(data: data, encoding: .utf8)!])
            }
            guard let row = try db.query("SELECT value FROM settings WHERE key=?", [key]).first else { return NSNull() }
            return (try JSONSerialization.jsonObject(with: Data((row["value"] as! String).utf8)) as! [Any])[0]
        default: throw Failure("UNSUPPORTED", "Method is not implemented by this prototype: \(method)")
        }
    }
}

func output(_ object: [String: Any]) {
    do {
        let bytes = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .fragmentsAllowed])
        FileHandle.standardOutput.write(bytes)
        FileHandle.standardOutput.write(Data([10]))
    } catch { FileHandle.standardError.write(Data("Cannot encode response\n".utf8)); exit(1) }
}
do {
    try require(CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "--profile", "INVALID_ARGUMENT", "Usage: awd-local-data --profile /absolute/isolated/profile")
    let store = try Store(profile: CommandLine.arguments[2])
    while let line = readLine() {
        var requestID: Any = NSNull()
        do {
            try require(line.utf8.count <= 45 * 1024 * 1024, "INVALID_ARGUMENT", "Request is too large")
            guard let request = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any] else { throw Failure("INVALID_ARGUMENT", "Expected request object") }
            requestID = request["id"] ?? NSNull()
            let result = try store.call(string(request, "method"), request["params"] as? [String: Any] ?? [:])
            output(["id": requestID, "result": result])
        } catch let error as Failure { output(["id": requestID, "error": ["code": error.code, "message": error.message]]) }
        catch { output(["id": requestID, "error": ["code": "IO_ERROR", "message": String(describing: error)]]) }
    }
} catch let error as Failure {
    output(["id": NSNull(), "error": ["code": error.code, "message": error.message]])
    exit(1)
} catch { output(["id": NSNull(), "error": ["code": "STARTUP_ERROR", "message": String(describing: error)]]); exit(1) }
