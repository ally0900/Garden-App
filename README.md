# 🌱 GardenGrow AI: Scan. Learn. Grow.

An AI-powered gardening assistant MVP for beginner and community gardeners, built to run on **one shared classroom computer (kiosk)** used by many classes. Each class has its own projects. Upload a photo of a garden and get:

- an assessment (what's visible, possible concerns, what still needs checking)
- a list of plants to keep, remove, or identify first
- a soil amendment plan
- a prioritized action plan
- a chat assistant that discusses the photo
- a progress tracker with before-and-after photos

Built with plain **HTML, CSS, and JavaScript** (no frameworks, nothing to install). Live AI goes through a small Vercel serverless function that keeps the OpenAI key secret.

---

## 1. Start the app

**Nothing to install.** Open the app folder and double-click **`index.html`**. It opens in your web browser (Chrome or Edge work best).

1. The first screen is **Choose your class & project**. Click **Create the first class** (for example, "Environmental Science, Period 2").
2. In the class, click **New project**. Enter a team name, members (optional), and what they want to grow (optional; it can be decided later).
3. The project opens. Click **Scan My Garden**, upload a photo (or try the sample photo), and click **Analyze My Garden**.

Until the app is deployed with an OpenAI key (section 3), it runs in **Demo mode** with sample results.

**Tip for a classroom computer:** right-click `index.html` → **Send to → Desktop (create shortcut)** so students can find it easily.

## 2. Using it in the classroom

- **Students:** go to **All Projects**, find your class, and tap your team's project card. Everything (photos, action plan, chat, progress) belongs to that project only. Use the search box to find a class, project, or team member.
- **Switching:** the chip at the top of the sidebar shows which project is open. Click **Switch** to go back to the list.
- **Any crop:** each project lists what it wants to grow under *My Garden → Intended plants or crops* (for example, "tomatoes, basil"). Built-in guides cover pumpkins and winter squash, zucchini, cucumbers and melons, tomatoes, peppers, beans and peas, leafy greens, root crops, potatoes, corn, herbs, and sunflowers. The guides adjust sunlight needs, pH range, timing, spacing, watering, and pests. Anything else gets general vegetable advice.
- **Settings** (in the sidebar, or the **Settings** button in the bottom menu on phones and tablets):
  - **Read-aloud voice.** Pick the voice Garden Chat uses (see section 3).
  - **Teacher PIN (optional).** Once set, it's required to open Settings, create, edit, or delete classes, delete projects, and download backups. Students can still create and work on projects. It's a light lock to prevent accidents, not strong security.
  - **Kiosk auto-return.** After 5–30 minutes with no activity, the app goes back to the project list so the next class starts fresh. It never interrupts an analysis or an open dialog.
  - **Backup & restore.** Download a `.json` backup of all classes, or of one class with the ⬇ button on that class. Restore merges it back in and keeps the newer copy of each project. Use this at the end of a term, before clearing a computer, or to move projects to another computer.
  - **Erase everything.** This can't be undone, so download a backup first.

**Where data lives:** everything is saved in this computer's browser, in its built-in database (IndexedDB). That's enough room for many classes' worth of photos. It's not shared with other computers. Important for kiosks:
- Always open the app the **same way** in the **same browser**: the same `index.html` file, in the same browser (for example, always Chrome). Moving or renaming the app folder, or opening it in a different browser, shows an empty app (your projects are still saved under the old location).
- Don't use a private or incognito window. It erases everything when closed.
- Clearing the browser's "site data" or "cookies" deletes the projects. Keep backups.

Projects saved by the first (single-project) version of the app are moved automatically into a class called "My Class".

In **demo mode**, the results are clearly labeled **samples**. They were written from the real project-site photos and are adjusted using what you enter in *My Garden*. No AI looks at the photo in demo mode. The only thing measured from your actual photo is the **color check**, which is a simple pixel count and not AI.

Your work saves automatically in the browser's database. Close the tab, come back later, and your plan, checkmarks and photos are still there. It's saved per browser and per computer only.

---

## 3. Turn on real AI (Live AI with OpenAI, hosted on Vercel)

Live AI sends the photo and garden details to an OpenAI vision model. It returns a real assessment, plant list, soil plan, action plan, and chat replies. The OpenAI key lives on the server as an **environment variable**, never in the browser or in Settings.

The app is deployed to **Vercel**. `index.html` is served as a static page, and `api/ai.js` is a small serverless function (at `/api`) that adds your OpenAI key and passes requests on to OpenAI.

### Deploy to Vercel

1. Push this folder to GitHub (section 4), or install the Vercel CLI.
2. At <https://vercel.com/new>, import the GitHub repository. Framework preset: **Other**. No build command is needed.
3. Under **Settings → Environment Variables**, add the variables from `.env.example`:
   - `OPENAI_API_KEY` (**required**): your OpenAI key, starts with `sk-`.
   - `OPENAI_MODEL` (optional): `gpt-6.1-terra` (recommended), `gpt-6-luna` (cheapest), `gpt-6.1-sol`, or `gpt-6-astra` (best).
   - `CLASS_CODE` (optional, recommended for a public link): students enter it once when they click **Live AI**.
   - `DAILY_LIMIT` (optional): AI requests per person per day (default 200).
4. Click **Deploy** (after changing a variable, redeploy so it takes effect).
5. Set a **monthly budget limit** at platform.openai.com → Billing → Limits.

**Running it on your computer:** copy `.env.example` to `.env`, fill in your key, and run `vercel dev`. (Double-clicking `index.html` still works, but only in Demo mode, because Live AI needs the `/api` server.)

`.env` is listed in `.gitignore` and `.vercelignore`, so the key is never uploaded. **To stop Live AI everywhere** right away, delete `OPENAI_API_KEY` in Vercel and redeploy, or delete the key at platform.openai.com.

### Voice in Garden Chat (optional)

Once Live AI is on, Garden Chat has two voice features:

- **🎤 Mic button** (next to Send): tap it, ask your question out loud, then tap it again. Your words appear in the message box so you can check them before pressing **Send**. The first time, the browser asks to use the microphone; click **Allow**. Recordings stop automatically after 60 seconds.
- **🔊 Read replies aloud** (checkbox above the message box): when it's ticked, each answer is read out loud. **Stop reading** stops it, and the **Listen** link under any answer replays it. The checkbox is remembered on this computer.

Choose the voice in **Settings → Read-aloud voice**. There's a card for each of OpenAI's 13 voices: press **▶** to hear a sample (press it again to stop), then click the card to choose that voice. It saves right away. You can type your own **sample sentence** to hear how each voice reads it. **Marin** and **Cedar** are the voices OpenAI recommends for best quality. Each new sample costs a tiny amount; replaying the same sample during the same visit is free. Voice adds a small cost per use (usually well under a cent per question or answer).

To change the voice models later (for example, when OpenAI retires `gpt-4o-mini-tts` in January 2027), edit `AI.speech` in PART 3 of `index.html`.

### If something goes wrong

The app shows a plain-language message: a wrong class code, a device that hit its daily limit, an invalid key, an account out of credit, or the server or OpenAI being unreachable. To check the server, open `https://<your-site>.vercel.app/api/health`: `keySet: true` means the OpenAI key is in place. Function errors show in Vercel → your project → **Logs**.

---

## 4. Upload your changes to GitHub

Double-click **`sync-to-github.bat`**. It saves your changes and uploads them to <https://github.com/ally0900/Garden-App>. The first time, it asks for your name and email and opens a GitHub sign-in window.

You can add a note describing what changed by running it from Command Prompt: `sync-to-github.bat "Added okra to the crop guide"`

It never uploads photos, videos, or zip files. (Your `.env` file with the API key is in `.gitignore`, so it isn't uploaded.) The sample photo inside `index.html` shows the project site, so a **private** repository is the safe default.

(`upload-to-github.sh` does the same job on a Mac.)

## 5. What's in each file

The whole app is **one file: `index.html`**. Open it in a text editor (Notepad works; VS Code is nicer) and press **Ctrl+F** to jump to a part:

| Part (search for this) | What it holds |
|---|---|
| `PART 1: STYLES` | All the looks: colors, fonts, cards, layout, and mobile/tablet sizes. Brand colors are at the top of this part. |
| `PART 2: SCREENS` | The HTML for every screen: All Projects, Home, Scan, Garden Chat, My Garden, Action Plan, Progress, Tips, Settings. Each screen is a `<section class="view">`. |
| `PART 3: LIVE AI` | The gardening rules the AI follows and the calls to OpenAI. |
| `PART 4: APP CODE` | Everything interactive: saving, photo upload, demo and live analysis, crop guide, action plan, chat, and progress tracking. |
| `PART 5: CLASSROOM` | Classes, projects, the project list, and the Settings page (voice, PIN, kiosk auto-return, backup/restore). |
| `PART 6: SAMPLE PHOTO` | At the very bottom: one project-site photo stored as one very long line of text. Don't edit it. |

Other files in the folder: `api/ai.js` (the AI server for Live AI, a Vercel function, see section 3), `vercel.json` (sends `/api/...` requests to it), `.env.example` (the environment variables to set), `school-ai-server/worker.js` (the old Cloudflare version, no longer used), `README.md` (this guide), `sync-to-github.bat` (uploads to GitHub on Windows), `upload-to-github.sh` (the Mac version), and `.gitignore` (keeps photos, backups, and zip files out of GitHub).

### How the pieces talk to each other

```
Browser (index.html on Vercel)
   │  photo + garden details + gardening safety rules (+ class code)
   ▼
AI server (api/ai.js on Vercel; holds the OpenAI key, checks the class code and limits)
   │
   ▼
OpenAI vision model  →  returns JSON  →  app displays it
```

In demo mode nothing is sent anywhere. The app builds the sample results itself.

---

## 6. How to make common changes

All of these are edits to `index.html`. Save the file and refresh the browser to see the result.

- **Change colors:** in PART 1, edit values like `--forest: #2E5D3A;`.
- **Change fonts:** edit the Google Fonts `<link>` near the top of `index.html` and the `--font-head`, `--font-body`, and `--font-script` lines in PART 1.
- **Add or edit a garden tip:** in PART 4, find `const TIPS = [`. Copy one `{ ... }` block and change the text. Available icons: `soil`, `sun`, `drop`, `pumpkin`, `sprout`, `bug`, `calendar`, `bulb`.
- **Add a crop to the crop guide:** in PART 4, find `const CROP_GUIDE = [`. Copy one entry, change `match` (the words that identify the crop, like `/okra/i`), and edit the facts: sun hours, pH range, days to harvest, planting time, spacing, water, and pests.
- **Change class colors:** in PART 5, edit `CLASS_COLORS`.
- **Add or edit an action-plan task:** in PART 4, find `const TASK_LIBRARY = [`. Each task is a small function that receives the garden details (`g`), so it can change priority based on answers. For example, `g.sunlight === "full" ? "medium" : "high"`.
- **Change the demo results:** in PART 4, edit `analyzeDemo()` (observations and concerns), `DEMO_PLANTS` (keep/remove list), and `buildSoilPlan()` (soil plan).
- **Change the demo chat answers:** in PART 4, edit `demoReply()`.
- **Change what the real AI is told:** in PART 3, edit `GARDEN_RULES` (the safety and accuracy rules), `ANALYSIS_FORMAT` (the JSON it must return), and `CHAT_RULES` (how Garden Chat replies).
- **Change the AI model list or default:** in PART 3, edit `AI.models` and `AI.defaultModel`.
- **Start fresh:** go to **Settings → Erase all data**.

---

## 7. Gardening accuracy rules built into the app

Both demo mode and the live AI follow these rules:

- Visible observations are kept separate from possible explanations, and each one is labeled with a confidence level.
- Nutrient deficiencies or pH are never diagnosed from a photo. The app recommends a soil test instead.
- Lime, sulfur, or fertilizer are only suggested when soil test results support it, and the app says to use the amounts on the report.
- An unfamiliar plant is never assumed to be a weed. Uncertain plants get **Identify first**.
- Removing trees is never recommended without the landowner's permission and an arborist's evaluation.
- Every task explains *why* it matters, and caveats are shown when advice is uncertain.

---

## 8. Known limitations (and what's next)

- **Storage:** data lives in one browser on one computer, which is perfect for a kiosk. Photos are shrunk to save space, and each project keeps its 8 most recent progress photos. If students later need to use their own devices, the projects would need to move to a shared database. The app's storage code is in one place (section 2 of PART 4), so that's the part to swap.
- **iPhone HEIC photos** may not open in Chrome or Firefox. Safari handles them, or you can change the iPhone camera setting to "Most Compatible" (JPG).
- **Daily limits are approximate.** The school AI server counts requests per device in memory, so the count can reset early when Vercel starts a new instance. Your OpenAI budget limit is the real cap.
- **Demo chat** answers only common questions. Open-ended questions need Live AI.
- AI can misidentify plants. Always confirm before removing anything.

### Ideas for the next version
Reminders for seasonal tasks · local frost dates from a ZIP code · exporting the plan as a PDF · a shared team task list.
