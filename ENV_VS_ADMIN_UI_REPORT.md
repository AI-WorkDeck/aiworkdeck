# Configuration Mechanisms: .env vs Admin UI

## 1. Overview
You currently have two ways to configure the backend application. Here is the comparison of how they work and their precedence.

| Feature | `.env` Files (Environment Variables) | Admin UI (`/admin`) |
| :--- | :--- | :--- |
| **Source** | Static text file (`backend/.env.production`) | Database Table (`system_setting`) |
| **Loading Time** | **Startup Only**. Requires application restart to take effect. | **Runtime**. Checks DB immediately (mostly). |
| **Mechanism** | Shell exports vars -> Java `application.yml` resolves placeholders. | Java Code (`AdminConfigController`) reads from DB. |
| **Scope** | Global, system-level defaults. | Dynamic, application-level overrides. |
| **Security** | Files on disk (risk if committed to git). | stored in Database (protected by access control). |

## 2. Relationships & Precedence

The backend logic (`AdminConfigController.java`) uses a **Default + Override** strategy:

1.  **Level 1 (Lowest): Code Defaults**
    - Hardcoded empty strings or fallback values in Java `@Value` annotations.
    - Example: `defaultWpsCallbackBaseUrl` defaults to empty if not found.

2.  **Level 2: Environment Variables (`.env`)**
    - When you set a key in `.env.production` (e.g., `QICHACHA_KEY=abc`), the start script now loads it (after my update to `restart-all.sh`).
    - `application-prod.yml` sees `${QICHACHA_KEY}` and injects `abc` into the Spring configuration.
    - **This becomes the "System Default"**.

3.  **Level 3 (Highest): Admin UI (Database)**
    - The Admin UI reads/writes to the `system_setting` table.
    - **The Code Logic**: `systemSettingService.getMany(defaults)`
    - If a value exists in the database (set via UI), **IT WINS**.
    - If the database value is missing/null, it falls back to the System Default (Level 2).

## 3. Summary of Changes
- **Updated `restart-all.sh`**: I have modified the script to explicitly load `backend/.env.production` before starting the backend.
    - **Effect**: Any keys defined in that file will now correctly populate the "Defaults" in the Admin UI.
- **Admin UI**: If you see empty fields in the Admin UI, hitting "Save" will write to the database and permanently override whatever is in the `.env` file for the running application.

## 4. Recommendation
1.  **Use `.env.production`** for "Infrastructure" secrets (Database passwords, AWS keys) and initial bootstrapping of API keys.
2.  **Use Admin UI** for "Business" configuration (Prompt tuning, temporary API key switching, Feature flags) that you want to change without restarting the server.
