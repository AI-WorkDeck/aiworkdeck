# Implementation Plan: User System & Permissions

I have analyzed the requirements and the existing codebase. Here is the detailed plan to implement the user system, permissions, and related features.

## 1. Backend Implementation (Priority)

### 1.1 Database Schema Updates

* **Update** **`User`** **Entity**:

  * Add `role` (String: "USER", "ADMIN").

  * Add `subscriptionType` (String: "FREE", "PAID").

  * Add `projectQuota` (Integer, optional, or derived from subscription).

* **Create** **`ProjectMember`** **Entity**:

  * Fields: `id`, `projectId`, `userId`, `role` ("ADMIN", "PARTICIPANT", "READ\_ONLY"), `joinedAt`.

* **Create** **`FileVariable`** **Entity**:

  * Fields: `id`, `fileId`, `name`, `value`, `type`. (For "Text Variables").

* **Create** **`UserActivityLog`** **Entity**:

  * Fields: `id`, `userId`, `actionType` ("LOGIN", "OPEN\_FILE", "CLOSE\_FILE", "PAGE\_VIEW"), `targetId` (projectId or fileId), `timestamp`, `duration` (for duration tracking).

* **Verify/Update** **`WebFavorite`** **&** **`ClipboardItem`**:

  * Ensure they are strictly filtered by `userId` in their respective repositories.

### 1.2 Service & API Logic

* **Authentication**:

  * Implement `register` API (Create User).

  * Update `login` to return user info including subscription status.

* **Project Permissions**:

  * Update `ProjectService` to use `ProjectMember` for access control.

  * Implement "Invite User" (Add `ProjectMember` by username).

  * Implement "Remove User" (Delete `ProjectMember`).

  * Enforce roles:

    * **Admin**: Full access.

    * **Participant**: Can't edit project info, can't invite, full file access.

    * **Read-Only**: GET requests only for files/vars.

* **Variable Scopes**:

  * **Project Variables**: Existing logic (filter by `projectId`).

  * **User Variables**: Existing logic (filter by `userId`).

  * **Text Variables**: New logic (filter by `fileId` of the active file).

* **Activity Logging**:

  * Create endpoint `/api/activity/log` to receive frontend events.

## 2. Frontend Implementation

### 2.1 User Profile Page (`userprofile.vue`)

* **Project List**:

  * Fetch and display all projects the user is a member of.

  * **Card Design**: Show project name, role, and **member avatars**.

* **Member Management**:

  * **Add Member**: "+" button on project card (Admin only). Opens modal to search user by username.

  * **Remove Member**: Hover over avatar -> "-" badge (Admin only).

### 2.2 Project Overview Page (`project-overview.vue`)

* **Member Display**:

  * In the bottom-left sidebar (Resource Manager column). relocated from the upper right corner.

  * Show current user's avatar.

  * Above it, show stacked avatars of project members.

  * **Interaction**: Hover to expand the stack to the right, showing names/roles.

### 2.3 User Behavior Tracking

* **Global Tracking**:

  * Record login time.

  * Track time spent on Project Overview page.

* **File Activity**:

  * Hook into `openFile` / `closeFile` actions.

  * Send events to backend: `OPEN_FILE`, `CLOSE_FILE` (with timestamp).

* webview activity:

  * open time, url, close time.
  * send events to backend: open\_url, close url (with timestamp)

## 3. Testing Strategy

* **User Creation**: Register a Free user and a Paid user. Verify project creation limits.

* **Permissions**:

  * User A (Admin) invites User B (Participant) and User C (Read-Only).

  * Verify User B cannot invite/edit project info but can edit files.

  * Verify User C cannot edit anything.

* **Variables**:

  * Verify User A sees their User Vars + Project Vars.

  * Verify User B sees their User Vars (different) + Project Vars (same).

  * Verify File Vars only appear when specific file is open.

* **Logs**: Check database for `UserActivityLog` entries after navigating.

I will start with the Backend modifications as requested.
