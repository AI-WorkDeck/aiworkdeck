# Implement Due Diligence (DD) File Management Plugin

This plan introduces a new "Due Diligence Files" plugin to manage the document collection process between lawyers and clients.

## 1. Backend Implementation (Java/Spring Boot)

### 1.1 New Entities
Create the following entities in `backend/src/main/java/com/checkba/model/entity`:
*   **`DdRequest`**: Represents a DD project/list.
    *   `id`, `projectId`, `name`, `status` (DRAFT, PUBLISHED, COMPLETED), timestamps.
*   **`DdItem`**: Represents a single file requirement.
    *   `id`, `ddRequestId`, `title`, `description`, `status` (PENDING, UPLOADED, APPROVED, REJECTED), `order`.
    *   `exampleFileId`: ID of an example file (optional).
    *   `uploadedFileId`: ID of the file uploaded by the client.
*   **`DdComment`**: Comments on specific items.
    *   `id`, `ddItemId`, `userId`, `content`, `createdAt`.

### 1.2 Service Layer (`DdService`)
*   **Create Request**: Logic to parse a text list (newline separated) into `DdItem`s.
*   **Upload Handling**:
    *   When a client uploads a file for an item:
        1.  Save the file as a `ProjectFile`.
        2.  Ensure a folder named "Client Provided Files" exists in the project.
        3.  Move the file to this folder.
        4.  Link the file to the `DdItem` and update status to `UPLOADED`.
*   **Communication**: Add/Get comments for items.

### 1.3 API Endpoints (`DdController`)
*   `GET /api/dd/project/{projectId}`: List DD requests.
*   `POST /api/dd/project/{projectId}`: Create a new request (with text content for parsing).
*   `GET /api/dd/request/{requestId}`: Get details (items + status).
*   `POST /api/dd/item/{itemId}/upload`: Client upload endpoint.
*   `POST /api/dd/item/{itemId}/comment`: Post a comment.
*   `PUT /api/dd/item/{itemId}/status`: Lawyer approves/rejects.

### 1.4 User & Roles
*   Support `CLIENT` role in `ProjectMember`.

## 2. Frontend Implementation (Vue.js)

### 2.1 Plugin Registration
*   Update `frontend/src/config/leftSidebarPlugins.js` to include the **Due Diligence** plugin (`key: 'dd-files'`).

### 2.2 Sidebar Component (`DdFilesPanel.vue`)
*   Displays a list of DD Requests for the current project.
*   **Lawyer**: "New Request" button.
*   **Client**: Sees assigned requests.

### 2.3 Main Editor Component (`DdRequestEditor.vue`)
*   This component will act as a "Tab" in the main workspace.
*   **Header**: Request Name, Progress Bar.
*   **List View**:
    *   **Item Name & Description**.
    *   **Example File**: Download link.
    *   **Status**: Icon/Badge.
    *   **Actions**:
        *   **Client**: "Upload" button (opens file picker).
        *   **Lawyer**: "View" (opens file), "Approve", "Reject".
    *   **Comment Section**: Expandable area for each item to show/add comments.

### 2.4 Integration (`project-overview.vue`)
*   Update logic to render `DdFilesPanel` when the plugin is selected.
*   Handle opening a DD Request: Add a new tab type `dd-request` and render `DdRequestEditor` in the main content area.

## 3. Testing Plan

### 3.1 Use Cases
1.  **Lawyer Workflow**:
    *   Create a DD Request named "Initial Due Diligence".
    *   Paste a list: "1. Business License\n2. Articles of Association".
    *   System generates 2 items.
    *   Lawyer adds a description to "Business License".
2.  **Client Workflow**:
    *   Client user logs in.
    *   Opens "Initial Due Diligence".
    *   Uploads `license.pdf` for Item 1.
    *   System saves file to "Client Provided Files".
    *   Item status changes to `UPLOADED`.
3.  **Review Loop**:
    *   Lawyer sees status change.
    *   Lawyer adds comment: "Please provide 2024 version".
    *   Client sees comment, re-uploads.
    *   Lawyer clicks "Approve".

### 3.2 Automated/Manual Verification
*   Verify file appears in the File Tree under "Client Provided Files".
*   Verify comments persist.
