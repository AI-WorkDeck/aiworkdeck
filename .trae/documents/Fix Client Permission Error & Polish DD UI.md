I will perform the following changes to address your requests:

1.  **Prevent "Client Permission" Popup**:
    *   I will modify `project-overview.vue` to initialize the sidebar view state (`leftPaneKey`) to `null` instead of `'files'`. This ensures the "Resource Explorer" (FileTree) never attempts to load for clients before their role is confirmed, preventing the backend permission error.
    *   The view will only be set to `'dd-files'` (Due Diligence) or `'files'` after the user's role is verified in the `created` hook.

2.  **Hide "Add List" for Clients**:
    *   I will update `project-overview.vue` to pass the `currentUser` prop to the `DdFilesPanel` component.
    *   I will modify `DdFilesPanel.vue` to accept this prop and use it to conditionally render the "New List" (＋) button, hiding it if the user's role is `CLIENT`.

3.  **Style DD Files Header**:
    *   I will update `DdFilesPanel.vue` to match the "Resource Explorer" header style as requested:
        *   Single row layout.
        *   Title on the left.
        *   Actions on the right.
        *   Matching height (40px) and background color.
    *   I will also ensure that when the DD panel is active, the default sidebar header in `project-overview.vue` is hidden to avoid duplication.

These changes will create a smoother, error-free experience for clients with a correct and consistent UI.