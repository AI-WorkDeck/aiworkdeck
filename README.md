# AI Workdeck Community Edition (Kernel)

> **AI Workdeck Community Edition (Kernel) — open-source core for document workflows (AGPLv3). Commercial license available for proprietary SaaS / enterprise use.**

## 1. Project Positioning
This repository hosts the **Community Edition (Kernel)** of AI Workdeck. It provides the core open-source infrastructure for verifiable, integrable document workflow and evidence chain capabilities.

**It is NOT the full commercial SaaS product.**
We open-source this kernel to empower developers to audit, integrate, and build upon our core document processing technologies.

## 2. Intellectual Property & "Look and Feel"
**Important Notice on Project Structure & Design:**
The value of AI Workdeck lies not just in the lines of code, but in the specific **Structure, Sequence, and Organization (SSO)** of its IDE-based document workflow.

*   **Protected Expression:** We assert copyright over the unique arrangement of our "Document-as-Code" workflow, the specific orchestration of AI agents within the editor context, and the visual/functional hierarchy of the IDE panels.
*   **Anti-Cloning:** If you create a derivative work that mimics this project's unique "IDE Structure and Logic Flow"—even if you reimplement the code from scratch—we generally consider this a derivative work of our **Trade Dress** and **Creative Expression**.
*   **Good Faith:** If you are inspired by this architecture, strict compliance with the AGPLv3 is expected. If you attempt to clone the *concept* and *workflow* for a closed-source product, you are violating the spirit and potentially the letter of our IP rights.

## 3. Licensing Strategy
We believe in sustainable open source.
- **Community / Open Source Use:** You are free to use, modify, and distribute this software under the terms of the **GNU Affero General Public License v3.0 (AGPLv3)**.
- **Proprietary / Commercial SaaS Use:** If you wish to use this software in a closed-source SaaS environment, proprietary enterprise deployment, or distribute it without releasing your modifications, **you must obtain a Commercial License**.

This dual-licensing model ensures the project remains free for the open-source community while providing a sustainable path for commercial integrations compared to closed-source copying.

## 3. Licensing Terms

### Community Edition (AGPLv3)
The "Community Edition / Kernel" of this project is released under the **AGPLv3**.

> If you modify this program and provide it as a network service to others (typical SaaS scenario), you must provide the corresponding source code to the users of that service under the AGPLv3.

### Commercial License
If you wish to use this project for:
- Closed-source SaaS delivery
- Proprietary on-premise delivery
- Distributing as part of a commercial non-open-source product

Please [contact us to acquire a Commercial License](mailto:hi@aiworkdeck.com).

*See [LICENSE](legal/LICENSE) for the full AGPLv3 text and [COMMERCIAL-LICENSE](legal/COMMERCIAL-LICENSE.md) for commercial licensing details.*

## Quick Start

### 1. Clone Repository
```bash
git clone https://github.com/zeweihan/aiworkdeck.git
cd aiworkdeck
```

### 2. Prerequisites
Before running the project, ensure you have the following installed:
- **Docker**: Required for PPTX generation and MinerU services.
- **Java 17+**: Required for the Backend service.
- **Node.js 18+**: Required for Frontend and Desktop services.

### 3. Configuration
Copy the example configuration files to their production counterparts and fill in your API keys.

#### 3.1 Backend Configuration
Copy `backend/.env.example` to `backend/.env.production`.

| Variable | Description | Impacted Feature |
| :--- | :--- | :--- |
| **Server** | | |
| `SERVER_PORT` | Port for the Java backend (Default: 9696) | API access |
| **Database** | | |
| `DB_HOST`, `DB_PORT` | PostgreSQL connection details | core data storage |
| `DB_NAME`, `DB_USERNAME`, `DB_PASSWORD` | Database credentials | core data storage |
| **External APIs** | | |
| `QICHACHA_KEY`, `QICHACHA_SECRET` | Qichacha API credentials | **Enterprise Data**: Company search & details |
| `TUSHARE_TOKEN` | Tushare API Token | **Financial Data**: Stock market data retrieval |
| `ELEVENLABS_API_KEY` | ElevenLabs API Key | **TTS**: High-quality text-to-speech generation |
| `PKULAW_TOKEN` | PKULaw API Token | **Legal Data**: Search laws and regulations |
| `WPS_APP_ID`, `WPS_APP_SECRET` | WPS WebOffice credentials | **Document Editor**: Embedded WPS editor integration |
| **AI Models** | | |
| `OPENROUTER_API_KEY` | OpenRouter API Key | **LLM**: Access to various LLMs via OpenRouter |
| `GEMINI_API_KEY` | Google Gemini API Key | **LLM**: Access to Google Gemini models |
| **Cloud Storage** | | |
| `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET` | Aliyun OSS credentials | **OCR/Storage**: File upload & OCR processing |

#### 3.2 PPTX Service Configuration (AI Slides)
Copy `pptx-service/.env.example` to `pptx-service/.env`.

| Variable | Description | Impacted Feature |
| :--- | :--- | :--- |
| `AI_PROVIDER_FORMAT` | `gemini` or `openai` | Determines which SDK to use for generation |
| **Gemini Provider** | (Used when `AI_PROVIDER_FORMAT=gemini`) | |
| `GOOGLE_API_KEY` | Google GenAI API Key | **AI Slides**: Content generation via Gemini |
| `GOOGLE_API_BASE` | API Base URL (optional proxy) | Connectivity |
| **OpenAI Provider** | (Used when `AI_PROVIDER_FORMAT=openai`) | |
| `OPENAI_API_KEY` | OpenAI API Key | **AI Slides**: Content generation via OpenAI-compatible API |
| `OPENAI_API_BASE` | API Base URL | Connectivity |
| **Common** | | |
| `TEXT_MODEL` | LLM Model Name (e.g., `gpt-4o`) | **AI Slides**: Text content generation quality |
| `IMAGE_MODEL` | Image Model Name | **AI Slides**: Image generation (if enabled) |
| `MINERU_LOCAL_URL` | Local MinerU Service URL | **File Parsing**: PDF/Doc parsing via local docker |
| `MINERU_TOKEN` | Cloud MinerU Token (optional) | **File Parsing**: Fallback to cloud parsing |
| `OUTPUT_LANGUAGE` | Output language (e.g., `zh`, `en`) | **AI Slides**: Default language of generated slides |

### 4. Build & Run
We provide a one-click script to build and start all services (Backend, Frontend, Desktop, and Docker containers).

```bash
chmod +x restart-all.sh
./restart-all.sh
```
*Note: This script automatically checks for dependencies, stops old processes, packages the backend, and starts all services in the correct order.*

### 5. Local Access (Intranet Penetration)
If you are running this locally and need to expose it to the internet (e.g., for external API callbacks or remote access), we recommend using **cpolar**.

- **Official Website**: [https://www.cpolar.com/](https://www.cpolar.com/)

You can use cpolar to easily map your local ports (e.g., 5173 for Frontend, 9696 for Backend) to a public URL.
