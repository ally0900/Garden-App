# 🌱 GardenGrow AI: Scan. Learn. Grow.

An AI-powered gardening assistant MVP for beginner and community gardeners, built to run on **one shared classroom computer (kiosk)** used by many classes. Each class has its own projects. Upload a photo of a garden and get:

- an assessment (what's visible, possible concerns, what still needs checking)
- a list of plants to keep, remove, or identify first
- a soil amendment plan
- a prioritized action plan
- a chat assistant that discusses the photo
- a progress tracker with before-and-after photos

Built with plain **HTML, CSS, and JavaScript** (no frameworks, nothing to install). Live AI talks to OpenAI straight from the browser.

---

## 1. Start the app

**Nothing to install.** Open the app folder and double-click **`index.html`**. It opens in your web browser (Chrome or Edge work best).

1. The first screen is **Choose your class & project**. Click **Create the first class** (for example, "Environmental Science, Period 2").
2. In the class, click **New project**. Enter a team name, members (optional), and what they want to grow (optional; it can be decided later).
3. The project opens. Click **Scan My Garden**, upload a photo (or try the sample photo), and click **Analyze My Garden**.

Until an OpenAI key is added (section 3), the app runs in **Demo mode** with sample results.

**Tip for a classroom computer:** right-click `index.html` → **Send to → Desktop (create shortcut)** so students can find it easily.

## 2. Using it in the classroom

- **Students:** go to **All Projects**, find your class, and tap your team's project card. Everything (photos, action plan, chat, progress) belongs to that project only. Use the search box to find a class, project, or team member.
- **Switching:** the chip at the top of the sidebar shows which project is open. Click **Switch** to go back to the list.
- **Any crop:** each project lists what it wants to grow under *My Garden → Intended plants or crops* (for example, "tomatoes, basil"). Built-in guides cover pumpkins and winter squash, zucchini, cucumbers and melons, tomatoes, peppers, beans and peas, leafy greens, root crops, potatoes, corn, herbs, and sunflowers. The guides adjust sunlight needs, pH range, timing, spacing, watering, and pests. Anything else gets general vegetable advice.
- **Settings** (in the sidebar, or the **Settings** button in the bottom menu on phones and tablets):
  - **AI (Live AI).** Add the OpenAI API key and pick a model (see section 3).
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

## 3. Turn on real AI (Live AI with OpenAI)

Live AI sends the photo and garden details to an OpenAI vision model. It returns a real assessment, plant list, soil plan, action plan, and chat replies. There are two ways to turn it on:

| | **A. School AI server** (recommended) | **B. A key on each device** |
|---|---|---|
| Best for | The public link, student devices, more than one computer | One classroom computer, quick testing |
| Setup | Once, about 15 minutes, all in your web browser | Paste the key on every device |
| Where the OpenAI key lives | Hidden on the server; never in anyone's browser | In that device's browser |
| Keeps strangers out | Yes: class code + daily limits | Only a Teacher PIN on that device |

Either way, first:

1. **Get an OpenAI API key.** Sign in at <https://platform.openai.com>, add a payment method under **Billing**, then go to **API keys → Create new secret key**. Copy the key (it starts with `sk-`). One photo analysis usually costs a few cents.
2. **Set a monthly budget limit** in OpenAI's Billing settings (for example, $10–20 a month). This is the hard cap on what the app can ever cost.

### A. Set up the school AI server (Cloudflare, free)

The file `school-ai-server/worker.js` is a small server. You paste it into Cloudflare's website; nothing to install.

1. Go to <https://dash.cloudflare.com/sign-up> and create a free account (verify your email).
2. In the left menu, open **Workers & Pages** (it may be under **Compute**), then click **Create** → **Create Worker** (pick "Start with Hello World" if asked).
3. Name it `gardengrow-ai` and click **Deploy**.
4. Click **Edit code**. Delete everything in the editor, open `school-ai-server/worker.js` (on GitHub: open the file → **Copy raw file**), paste it in, and click **Deploy**.
5. Go back to the worker → **Settings** → **Variables and Secrets** → **Add**, and add these two, each with type **Secret**:
   - `OPENAI_API_KEY`: your OpenAI key (`sk-...`)
   - `CLASS_CODE`: a code you'll give students, for example `GROW2027` (not case-sensitive)

   Click **Deploy** (or **Save**) after adding them.
6. Copy the worker's address from the top of its page. It looks like `https://gardengrow-ai.your-name.workers.dev`. Open it in a browser: you should see `"app":"GardenGrow AI"` and `"keySet":true`.
7. **Put the address into the app** so every device uses it automatically: in `index.html`, PART 3, set `serverUrl: "https://gardengrow-ai.your-name.workers.dev",` then upload to GitHub (section 4). Or ask Claude to do it.

   To try it first on one device: **Settings → AI → School AI server**, paste the address and class code, click **Test server**, then **Save settings**.

**Students:** the first time they click **Live AI** on a device, the app asks for the class code. They enter it once and Live AI stays on for that device.

**Optional server settings** (Cloudflare → worker → Settings → Variables, type **Text**):
- `DAILY_LIMIT`: AI requests per device per day (default 200).
- `ALLOWED_ORIGINS`: which websites may use the server. Default: `https://ally0900.github.io,null` (`null` means the app opened as a file on a computer).

**To change the class code** (for example, each new term), edit `CLASS_CODE` in Cloudflare. Everyone will be asked for the new code. **To stop Live AI everywhere** right away, delete `OPENAI_API_KEY` in Cloudflare or delete the key at platform.openai.com.

**Cost:** Cloudflare's free plan allows 100,000 requests a day, far more than a class needs. OpenAI usage is billed to your OpenAI account and capped by your budget limit.

### B. Or: an OpenAI key on each device

1. Open the app and click **Settings** (in the sidebar, or in the bottom menu on phones and tablets).
2. Open **Or: an OpenAI key on this device**, paste the key, and click **Test key**.
3. Pick a model under **AI model** (**GPT-6.1 Terra** is recommended; **GPT-6 Luna** is cheapest).
4. Click **Save settings**. The app switches to **Live AI** automatically.
5. **Set a Teacher PIN** in the same window so students can't open Settings.

The key is saved in that browser only, never uploaded or put in backups. Someone with access to that computer and some technical know-how could still find it, which is why the budget limit and PIN matter.

### Voice in Garden Chat (optional)

Once Live AI is on (either way above), Garden Chat has two voice features:

- **🎤 Mic button** (next to Send): tap it, ask your question out loud, then tap it again. Your words appear in the message box so you can check them before pressing **Send**. The first time, the browser asks to use the microphone; click **Allow**. Recordings stop automatically after 60 seconds.
- **🔊 Read replies aloud** (checkbox above the message box): when it's ticked, each answer is read out loud. **Stop reading** stops it, and the **Listen** link under any answer replays it. The checkbox is remembered on this computer.

Choose the voice in **Settings → Read-aloud voice**. There's a card for each of OpenAI's 13 voices: press **▶** to hear a sample (press it again to stop), then click the card to choose that voice. It saves right away. You can type your own **sample sentence** to hear how each voice reads it. **Marin** and **Cedar** are the voices OpenAI recommends for best quality. Each new sample costs a tiny amount; replaying the same sample during the same visit is free. Voice adds a small cost per use (usually well under a cent per question or answer).

To change the voice models later (for example, when OpenAI retires `gpt-4o-mini-tts` in January 2027), edit `AI.speech` in PART 3 of `index.html`.

### If something goes wrong

The app shows a plain-language message: a wrong class code, a device that hit its daily limit, an invalid key, an account out of credit, or the server or OpenAI being unreachable. Teachers can check everything in **Settings → AI** with **Test server** or **Test key**. If the school network blocks `workers.dev` or `api.openai.com`, ask IT to allow it.

---

## 4. Upload your changes to GitHub

Double-click **`sync-to-github.bat`**. It saves your changes and uploads them to <https://github.com/ally0900/Garden-App>. The first time, it asks for your name and email and opens a GitHub sign-in window.

You can add a note describing what changed by running it from Command Prompt: `sync-to-github.bat "Added okra to the crop guide"`

It never uploads photos, videos, or zip files. (Your API key is stored in the browser, not in the folder, so it can't be uploaded.) The sample photo inside `index.html` shows the project site, so a **private** repository is the safe default.

(`upload-to-github.sh` does the same job on a Mac.)

## 5. What's in each file

The whole app is **one file: `index.html`**. Open it in a text editor (Notepad works; VS Code is nicer) and press **Ctrl+F** to jump to a part:

| Part (search for this) | What it holds |
|---|---|
| `PART 1: STYLES` | All the looks: colors, fonts, cards, layout, and mobile/tablet sizes. Brand colors are at the top of this part. |
| `PART 2: SCREENS` | The HTML for every screen: All Projects, Home, Scan, Garden Chat, My Garden, Action Plan, Progress, Tips, Settings. Each screen is a `<section class="view">`. |
| `PART 3: LIVE AI` | The gardening rules the AI follows and the calls to OpenAI. |
| `PART 4: APP CODE` | Everything interactive: saving, photo upload, demo and live analysis, crop guide, action plan, chat, and progress tracking. |
| `PART 5: CLASSROOM` | Classes, projects, the project list, and the Settings page (AI key, PIN, kiosk auto-return, backup/restore). |
| `PART 6: SAMPLE PHOTO` | At the very bottom: one project-site photo stored as one very long line of text. Don't edit it. |

Other files in the folder: `school-ai-server/worker.js` (the school AI server for Live AI, see section 3), `README.md` (this guide), `sync-to-github.bat` (uploads to GitHub on Windows), `upload-to-github.sh` (the Mac version), and `.gitignore` (keeps photos, backups, and zip files out of GitHub).

### How the pieces talk to each other

```
Browser (index.html on GitHub Pages)
   │  photo + garden details + gardening safety rules (+ class code)
   ▼
School AI server (Cloudflare worker; holds the OpenAI key, checks the class code and limits)
   │
   ▼
OpenAI vision model  →  returns JSON  →  app displays it
```

With option B (a key on the device), the browser talks to OpenAI directly instead.

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
- **Daily limits are approximate.** The school AI server counts requests per device in memory, so the count can reset early when Cloudflare restarts the worker. Your OpenAI budget limit is the real cap.
- **Demo chat** answers only common questions. Open-ended questions need Live AI.
- AI can misidentify plants. Always confirm before removing anything.

### Ideas for the next version
Reminders for seasonal tasks · local frost dates from a ZIP code · exporting the plan as a PDF · a shared team task list.
