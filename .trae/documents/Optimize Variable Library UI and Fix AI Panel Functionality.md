I will optimize the UI of the bottom variable library and fix the functionality of the right AI panel.

**1. Fix AI Panel Functionality (Right Side)**
In `src/pages/project-overview/project-overview.vue`, I will add the missing methods that handle the dropdown interactions:
- `toggleContextDropdown()`: To show/hide the file context menu.
- `switchAiContext()`: To select a file as context.
- `toggleModelDropdown()`: To show/hide the model selection menu.
- `switchModel()`: To select an AI model.

**2. Optimize Variable Library UI (Bottom Panel)**
In `src/components/VariablePanel.vue`, I will:
- **Redesign Variable Cards:**
    - Increase the font size of the variable name (title) to make it prominent.
    - Decrease the font size of the date/time and make it less obtrusive.
    - Improve the layout to place the title at the top, value in the middle, and actions/meta at the bottom.
    - Enhance the styling of "Insert" and "Delete" buttons for a better look.
- **Style the Right-side Tabs (Text/Project/User Variables):**
    - Update the styles of the vertical tabs (`scope-rail`) to be consistent with the main bottom panel tabs ("Variable Library", "Favorites", "Clipboard").
    - Ensure a clear visual distinction between selected and unselected states using colors and background highlights.

I will verify the changes by checking the code structure and ensuring the logic aligns with the requirements.