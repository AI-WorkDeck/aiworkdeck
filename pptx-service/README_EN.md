<div align="center">

<img width="256" src="https://github.com/user-attachments/assets/6f9e4cf9-912d-4faa-9d37-54fb676f547e">

*Vibe your PPT like vibing code.*

**[中文](README.md) | English**

<p>

[![GitHub Stars](https://img.shields.io/github/stars/Anionex/banana-slides?style=square)](https://github.com/Anionex/banana-slides/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/Anionex/banana-slides?style=square)](https://github.com/Anionex/banana-slides/network)
[![GitHub Watchers](https://img.shields.io/github/watchers/Anionex/banana-slides?style=square)](https://github.com/Anionex/banana-slides/watchers)

[![Version](https://img.shields.io/badge/version-v0.1.0-4CAF50.svg)](https://github.com/Anionex/banana-slides)
![Docker](https://img.shields.io/badge/Docker-Build-2496ED?logo=docker&logoColor=white)
[![GitHub issues](https://img.shields.io/github/issues-raw/Anionex/banana-slides)](https://github.com/Anionex/banana-slides/issues)
[![GitHub pull requests](https://img.shields.io/github/issues-pr-raw/Anionex/banana-slides)](https://github.com/Anionex/banana-slides/pulls)


</p> 

<b>A native AI PPT generation application based on nano banana pro🍌. It supports generating full PPT presentations from ideas, outlines, or page descriptions.<br></b>
<b> Automatically extract charts from attachments, upload custom assets, and make modifications via natural language—moving towards a true "Vibe PPT". </b>

<b>🎯 Lowering the barrier to PPT creation, allowing everyone to quickly craft beautiful and professional presentations.</b>

<br>

*If this project is helpful to you, please star🌟 & fork🍴*

<br>

</p>

</div>



## ✨ Project Origin
Have you ever been stuck in this situation: a report is due tomorrow, but your PPT is still a blank canvas; you have countless brilliant ideas in your head, but all your passion is drained by tedious layout and design work?

We long to quickly create presentations that are both professional and well-designed. While traditional AI PPT generation apps generally meet the "speed" requirement, they still suffer from the following issues:

- 1️⃣ Limited to preset templates with no flexibility to adjust styles.
- 2️⃣ Low degree of freedom, making multi-round revisions difficult.
- 3️⃣ Homogenized output with a repetitive "AI-generated" look.
- 4️⃣ Low-quality or irrelevant assets/images.
- 5️⃣ Disconnected text-image layouts with poor design sensibility.

These flaws make it difficult for traditional AI PPT generators to simultaneously satisfy the two major needs of PPT production: "speed" and "beauty." Even those claiming to be "Vibe PPT" are often far from being truly "Vibe."

However, the emergence of the nano banana🍌 model changed everything. I tried using 🍌pro for PPT page generation and found that the results were exceptional in terms of quality, aesthetics, and consistency. It can precisely render almost all text requested in the prompt and follow the style of reference images. So, why not build a native "Vibe PPT" application based on 🍌pro?

## 👨‍💻 Use Cases

1. **Beginners**: Quickly generate beautiful PPTs with zero barriers and no design experience required.
2. **PPT Professionals**: Get design inspiration by referencing AI-generated layouts and text-image combinations.
3. **Educators**: Quickly convert teaching content into illustrated lesson plans to enhance classroom effectiveness.
4. **Students**: Rapidly complete presentation assignments, focusing energy on content rather than formatting.
5. **Business Professionals**: Visualize business proposals and product introductions quickly for various scenarios.


## 🎨 Showcase


<div align="center">

| | |
|:---:|:---:|
| <img src="https://github.com/user-attachments/assets/d58ce3f7-bcec-451d-a3b9-ca3c16223644" width="500" alt="Case 3"> | <img src="https://github.com/user-attachments/assets/c64cd952-2cdf-4a92-8c34-0322cbf3de4e" width="500" alt="Case 2"> |
| **Software Development Best Practices** | **DeepSeek-V3.2 Technical Showcase** |
| <img src="https://github.com/user-attachments/assets/383eb011-a167-4343-99eb-e1d0568830c7" width="500" alt="Case 4"> | <img src="https://github.com/user-attachments/assets/1a63afc9-ad05-4755-8480-fc4aa64987f1" width="500" alt="Case 1"> |
| **Smart Production Equipment for Prepared Food** | **The Evolution of Money: From Shells to Banknotes** |

</div>

More can be found in <a href="https://github.com/Anionex/banana-slides/issues/2" > Use Cases </a>


## 🎯 Features

### 1. Flexible Creation Paths
Supports three starting modes: **Idea**, **Outline**, and **Page Description** to fit different creative habits.
- **One-sentence generation**: Enter a topic, and AI automatically generates a structured outline and page-by-page descriptions.
- **Natural language editing**: Modify outlines or descriptions via "Vibe" commands (e.g., "Change page 3 to a case study"), with real-time AI response.
- **Outline/Description mode**: Supports both one-click batch generation and manual detail adjustment.

<img width="2000" height="1125" alt="image" src="https://github.com/user-attachments/assets/7fc1ecc6-433d-4157-b4ca-95fcebac66ba" />


### 2. Powerful Asset Parsing
- **Multi-format support**: Upload PDF/Docx/MD/Txt files for automatic content parsing.
- **Intelligent extraction**: Automatically identifies key points, image links, and chart information to provide rich material for generation.
- **Style reference**: Upload reference images or templates to customize the PPT style.

<img width="1920" height="1080" alt="File parsing and asset processing" src="https://github.com/user-attachments/assets/8cda1fd2-2369-4028-b310-ea6604183936" />

### 3. "Vibe" Style Natural Language Modification
No longer restricted by complex menus; issue modification commands directly through **natural language**.
- **Local redraw**: Verbally modify specific areas (e.g., "Change this chart to a pie chart").
- **Full-page optimization**: Generate high-definition, stylistically consistent pages based on nano banana pro🍌.

<img width="2000" height="1125" alt="image" src="https://github.com/user-attachments/assets/929ba24a-996c-4f6d-9ec6-818be6b08ea3" />


### 4. Out-of-the-Box Format Export
- **Multi-format support**: One-click export to standard **PPTX** or **PDF** files.
- **Perfect fit**: Default 16:9 ratio, no secondary layout adjustment needed—ready for presentation.

<img width="1000" alt="image" src="https://github.com/user-attachments/assets/3e54bbba-88be-4f69-90a1-02e875c25420" />
<img width="1748" height="538" alt="PPT and PDF Export" src="https://github.com/user-attachments/assets/647eb9b1-d0b6-42cb-a898-378ebe06c984" />

### 5. Editable Component PPTX Export (Beta)
- **Intelligent recursive analysis for component extraction, text extraction, and table extraction to generate manually editable PPTX files.**
<img width="1000"  alt="image" src="https://github.com/user-attachments/assets/a85d2d48-1966-4800-a4bf-73d17f914062" />


## 🔥 Recent Updates
- [12-27]: Added support for image-free template mode and high-quality text presets. Now you can control PPT styles via pure text descriptions.
- [12-25]: [PR #82](https://github.com/Anionex/banana-slides/pull/82) supports editable PPTX export based on layout recognition, local redraw, and recursive analysis. Developers can switch to this branch for early access. ⛱️
- [12-24]: Main branch added a Beta version of editable PPTX export based on nano-banana-pro background extraction.


## 🗺️ Roadmap

| Status | Milestone |
| --- | --- |
| ✅ Completed | Create PPT from Idea, Outline, and Page Description paths |
| ✅ Completed | Parse Markdown formatted images in text |
| ✅ Completed | Add more assets to a single PPT page |
| ✅ Completed | "Vibe" natural language editing for specific areas on a page |
| ✅ Completed | Material Module: Material generation, upload, etc. |
| ✅ Completed | Support for uploading and parsing multiple file types |
| ✅ Completed | Support for "Vibe" adjustments to outlines and descriptions |
| ✅ Completed | Initial editable PPTX file export (mineru) |
| 🔄 In Progress | Element segmentation and further editing for generated images (segment + inpaint) |
| 🔄 In Progress | Web search integration |
| 🔄 In Progress | Agent Mode |
| 🧭 Planned | Optimize frontend loading speed |
| 🧭 Planned | Online presentation mode |
| 🧭 Planned | Simple animations and page transitions |
| 🧭 Planned | Multi-language support |
| 🧭 Planned | User system |

## 📦 Usage

### Using Docker Compose 🐳 (Recommended)
The easiest deployment method to start both frontend and backend services with one command.

<details>
  <summary>📒 Instructions for Windows Users</summary>

If you are using Windows, please install Docker Desktop for Windows first. Check the Docker icon in the system tray to ensure it is running, then follow the same steps.

> **Tip**: If you encounter issues, ensure WSL 2 backend is enabled in Docker Desktop settings (recommended) and that ports 3000 and 5000 are not occupied.

</details>

0. **Clone the Repository**
```bash
git clone https://github.com/Anionex/banana-slides
cd banana-slides
```

1. **Configure Environment Variables**

Create a `.env` file (refer to `.env.example`):
```bash
cp .env.example .env
```

Edit the `.env` file and configure necessary variables:
> **The LLM interface in this project follows the AIHubMix format. It is recommended to use [AIHubMix](https://aihubmix.com/?aff=17EC) to obtain an API key for reduced migration costs.**  
```env
# AI Provider Format (gemini / openai / vertex)
AI_PROVIDER_FORMAT=gemini

# Gemini Configuration (Used when AI_PROVIDER_FORMAT=gemini)
GOOGLE_API_KEY=your-api-key-here
GOOGLE_API_BASE=https://generativelanguage.googleapis.com
# Proxy example: https://aihubmix.com/gemini

# OpenAI Configuration (Used when AI_PROVIDER_FORMAT=openai)
OPENAI_API_KEY=your-api-key-here
OPENAI_API_BASE=https://api.openai.com/v1
# Proxy example: https://aihubmix.com/v1

# Vertex AI Configuration (Used when AI_PROVIDER_FORMAT=vertex)
# Requires GCP service account, GCP free credits can be used
# VERTEX_PROJECT_ID=your-gcp-project-id
# VERTEX_LOCATION=global
# GOOGLE_APPLICATION_CREDENTIALS=./gcp-service-account.json
...
```

<details>
  <summary>📒 Using Vertex AI (GCP Free Tier)</summary>

If you want to use Google Cloud Vertex AI (GCP new user credits can be used), you need additional configuration:

1. Create a service account and download the JSON key file in the [GCP Console](https://console.cloud.google.com/).
2. Rename the key file to `gcp-service-account.json` and place it in the project root.
3. Edit the `.env` file:
   ```env
   AI_PROVIDER_FORMAT=vertex
   VERTEX_PROJECT_ID=your-gcp-project-id
   VERTEX_LOCATION=global
   ```
4. Edit `docker-compose.yml` and uncomment the following:
   ```yaml
   # environment:
   #   - GOOGLE_APPLICATION_CREDENTIALS=/app/gcp-service-account.json
   # ...
   # - ./gcp-service-account.json:/app/gcp-service-account.json:ro
   ```

> **Note**: `gemini-3-*` series models require `VERTEX_LOCATION=global`.

</details>

2. **Start Services**

```bash
docker compose up -d
```

> [!TIP]
> If you encounter network issues, you can uncomment mirror sources in the `.env` file and rerun the start command:
> ```env
> # Uncomment the following in .env to use Chinese mirrors
> DOCKER_REGISTRY=docker.1ms.run/
> GHCR_REGISTRY=ghcr.nju.edu.cn/
> APT_MIRROR=mirrors.aliyun.com
> PYPI_INDEX_URL=https://mirrors.cloud.tencent.com/pypi/simple
> NPM_REGISTRY=https://registry.npmmirror.com/
> ```


3. **Access the App**

- Frontend: http://localhost:3000
- Backend API: http://localhost:5000

4. **View Logs**

```bash
# View backend logs (real-time, last 50 lines)
sudo docker compose logs -f --tail 50 backend

# View all service logs
sudo docker compose logs -f --tail 50

# View frontend logs
sudo docker compose logs -f --tail 50 frontend
```

5. **Stop Services**

```bash
docker compose down
```

6. **Update Project**

Pull the latest code and rebuild/restart:

```bash
git pull
docker compose down
docker compose build --no-cache
docker compose up -d
```

### Deployment from Source

#### Requirements
- Python 3.10 or higher
- [uv](https://github.com/astral-sh/uv) - Python package manager
- Node.js 16+ and npm
- Valid Google Gemini API Key

#### Backend Installation

0. **Clone the Repository**
```bash
git clone https://github.com/Anionex/banana-slides
cd banana-slides
```

1. **Install uv (if not already installed)**
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

2. **Install Dependencies**

Run in the project root:
```bash
uv sync
```
This will automatically install all dependencies based on `pyproject.toml`.

3. **Configure Environment Variables**

Copy the template:
```bash
cp .env.example .env
```

Edit `.env` and configure your API key:
> **The project standardizes on the AIHubMix format. It is recommended to use [AIHubMix](https://aihubmix.com/?aff=17EC) to get an API key.** 
```env
# AI Provider Format (gemini / openai / vertex)
AI_PROVIDER_FORMAT=gemini

# ... same as above ...

PORT=5000
...
```

#### Frontend Installation

1. **Enter Frontend Directory**
```bash
cd frontend
```

2. **Install Dependencies**
```bash
npm install
```

3. **Configure API Address**
The frontend connects to the backend at `http://localhost:5000` by default. To change this, edit `src/api/client.ts`.


#### Start Backend Service
> (Optional) If you have important local data, backup the database before upgrading:  
> `cp backend/instance/database.db backend/instance/database.db.bak`

```bash
cd backend
uv run alembic upgrade head && uv run python app.py
```

The backend will start at `http://localhost:5000`.

Visit `http://localhost:5000/health` to verify service status.

#### Start Frontend Dev Server

```bash
cd frontend
npm run dev
```

The frontend will start at `http://localhost:3000`.

## 🛠️ Tech Stack

### Frontend
- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite 5
- **State Management**: Zustand
- **Routing**: React Router v6
- **UI Components**: Tailwind CSS
- **Drag & Drop**: @dnd-kit
- **Icons**: Lucide React
- **HTTP Client**: Axios

### Backend
- **Language**: Python 3.10+
- **Framework**: Flask 3.0
- **Package Management**: uv
- **Database**: SQLite + Flask-SQLAlchemy
- **AI Engine**: Google Gemini API
- **PPT Processing**: python-pptx
- **Image Processing**: Pillow
- **Concurrency**: ThreadPoolExecutor
- **CORS Support**: Flask-CORS

## 📁 Project Structure

```
banana-slides/
├── frontend/                    # React frontend application
│   ├── src/
│   │   ├── pages/              # Page components
│   │   │   ├── Home.tsx        # Homepage (Create project)
│   │   │   ├── OutlineEditor.tsx    # Outline editor
│   │   │   ├── DetailEditor.tsx     # Description editor
│   │   │   ├── SlidePreview.tsx     # Preview page
│   │   │   └── History.tsx          # History management
│   │   ├── components/         # UI Components
│   │   │   ├── outline/        # Outline components
│   │   │   ├── preview/        # Preview components
│   │   │   ├── shared/         # Shared components
│   │   │   ├── layout/         # Layout components
│   │   │   └── history/        # History components
│   │   ├── store/              # Zustand state management
│   │   ├── api/                # API interface
│   │   ├── types/              # TypeScript types
│   │   ├── utils/              # Utilities
│   │   ├── constants/          # Constants
│   │   └── styles/             # Styles
│   ├── public/                 # Static assets
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js      # Tailwind CSS config
│   ├── Dockerfile
│   └── nginx.conf              # Nginx config
│
├── backend/                    # Flask backend application
│   ├── app.py                  # Entry point
│   ├── config.py               # Configuration
│   ├── models/                 # DB Models
│   ├── services/               # Service layer
│   │   ├── ai_service.py       # AI generation (Gemini)
│   │   ├── file_service.py     # File management
│   │   ├── file_parser_service.py # Parsing service
│   │   ├── export_service.py   # PPTX/PDF export
│   │   ├── task_manager.py     # Async tasks
│   │   ├── prompts.py          # AI prompt templates
│   ├── controllers/            # API Controllers
│   ├── utils/                  # Utility functions
│   ├── instance/               # SQLite DB (auto-generated)
│   ├── exports/                # Exported files
│   ├── Dockerfile
│   └── README.md
│
├── tests/                      # Testing
├── v0_demo/                    # Early demo version
├── output/                     # Output files
│
├── pyproject.toml              # Python config (uv)
├── uv.lock                     # Dependency lockfile
├── docker-compose.yml          # Docker Compose config
├── .env.example                 # Env template
├── LICENSE                     # License
└── README.md                   # This file
```

## Community
For communication and mutual help, we have established this WeChat group.

Feel free to propose new features or provide feedback. I will also answer questions here from time to time.

<img width="300" alt="image" src="https://github.com/user-attachments/assets/b37b6144-5152-4f30-9b90-0c0678374437" />


**FAQ**
1.  **Does it support the Gemini API Key free tier?**
    *   The free tier only supports text generation, not image generation.
2.  **Getting 503 error or Retry Error during generation**
    *   Check Docker logs using the command in README to locate the detailed error. Usually, this is caused by incorrect model configuration.
3.  **Why does the API Key in .env not take effect?**
    1.  Restart the Docker container to apply changes to `.env`.
    2.  If set via the web settings page, it overrides the `.env` value. Use "Restore Defaults" to revert to `.env`.
4.  **Garbled characters in generated text**
    *   Try higher resolution output (OpenAI format might not support this).
    *   Ensure the page description includes the specific text to be rendered.
  

## 🤝 Contribution Guidelines

Contributions are welcome via 
[Issues](https://github.com/Anionex/banana-slides/issues) 
and 
[Pull Requests](https://github.com/Anionex/banana-slides/pulls)!

## 📄 License

This project is open-sourced under the CC BY-NC-SA 4.0 license.

It is free for non-commercial use, such as personal learning, research, testing, education, or non-profit scientific activities.

<details> 

<summary> Details </summary>
The license for this project is Non-Commercial (CC BY-NC-SA). 
Any commercial use requires a separate commercial license.

**Commercial Use** includes but is not limited to:

1. Internal use within companies or institutions.
2. External services provided to others.
3. Any other use for profit.

**Examples of Non-Commercial Use** (No license required):

- Personal learning, research, testing, education, or non-profit scientific activities.
- Open-source community contributions, personal portfolio displays, and other uses that do not generate economic benefit.

> Note: If you have questions about usage scenarios, please contact the author for authorization.

</details>



<h2>🚀 Sponsor </h2>

<div align="center">
<a href="https://aihubmix.com/?aff=17EC">
  <img src="./assets/logo_aihubmix.png" alt="AIHubMix" style="height:48px;">
</a>
<p>Thanks to AIHubMix for sponsoring this project</p>
</div>

## Acknowledgments

- Contributors:

[![Contributors](https://contrib.rocks/image?repo=Anionex/banana-slides)](https://github.com/Anionex/banana-slides/graphs/contributors)

- [Linux.do](https://linux.do/): A new ideal community
  
## Donations

Open source is not easy 🙏 If this project is valuable to you, feel free to buy the developer a coffee ☕️

<img width="240" alt="image" src="https://github.com/user-attachments/assets/fd7a286d-711b-445e-aecf-43e3fe356473" />

Thanks to the following friends for their selfless sponsorship:
> @雅俗共赏、@曹峥、@以年观日、@John、@azazo1、@刘聪NLP、@🍟、@苍何、@biubiu  
> If you have questions about the list (e.g., your name is missing), please <a href="mailto:anionex@qq.com">contact the author</a>.
 
## 📈 Project Statistics

<a href="https://www.star-history.com/#Anionex/banana-slides&type=Timeline&legend=top-left">

 <picture>

   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Anionex/banana-slides&type=Timeline&theme=dark&legend=top-left" />

   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Anionex/banana-slides&type=Timeline&legend=top-left" />

   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Anionex/banana-slides&type=Timeline&legend=top-left" />

 </picture>

</a>

<br>