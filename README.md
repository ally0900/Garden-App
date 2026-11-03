# 🌱 GardenGrow AI: Scan. Learn. Grow.

An AI-powered gardening assistant MVP for beginner and community gardeners, built to run on **one shared classroom computer (kiosk)** used by many classes. Each class has its own projects. Upload a photo of a garden and get:

- an assessment (what's visible, possible concerns, what still needs checking)
- a list of plants to keep, remove, or identify first
- a soil amendment plan
- a prioritized action plan
- a chat assistant that discusses the photo
- a progress tracker with before-and-after photos

Built with plain **HTML, CSS, and JavaScript** (no frameworks). There's an optional tiny **Node.js server** for real AI.

---

## 1. Run the app (demo mode): no setup needed

1. Open the `GardenGrow AI App` folder.
2. Double-click **`index.html`**. It opens in your web browser.
3. The first screen is **Choose your class & project**. Click **Create the first class** (for example, "Environmental Science, Period 2").
4. In the class, click **New project**. Enter a team name, members (optional), and what they want to grow (optional; it can be decided later).
5. The project opens. Click **Scan My Garden**, upload a photo (or try the sample photo), and click **Analyze My Garden**.

## 2. Using it in the classroom

- **Students:** go to **All Projects**, find your class, and tap your team's project card. Everything (photos, action plan, chat, progress) belongs to that project only. Use the search box to find a class, project, or team member.
- **Switching:** the chip at the top of the sidebar shows which project is open. Click **Switch** to go back to the list.
- **Any crop:** each project lists what it wants to grow under *My Garden → Intended plants or crops* (for example, "tomatoes, basil"). Built-in guides cover pumpkins and winter squash, zucchini, cucumbers and melons, tomatoes, peppers, beans and peas, leafy greens, root crops, potatoes, corn, herbs, and sunflowers. The guides adjust sunlight needs, pH range, timing, spacing, watering, and pests. Anything else gets general vegetable advice.
- **Teacher tools** (button on the project list, or at the bottom of the sidebar):
  - **Teacher PIN (optional).** Once set, it's required to create, edit, or delete classes, delete projects, download backups, and open teacher tools. Students can still create and work on projects. It's a light lock to prevent accidents, not strong security.
  - **Kiosk auto-return.** After 5–30 minutes with no activity, the app goes back to the project list so the next class starts fresh. It never interrupts an analysis or an open dialog.
  - **Backup & restore.** Download a `.json` backup of all classes, or of one class with the ⬇ button on that class. Restore merges it back in and keeps the newer copy of each project. Use this at the end of a term, before clearing a computer, or to move projects to another computer.
  - **Erase everything.** This can't be undone, so download a backup first.

**Where data lives:** everything is saved in this computer's browser, in its built-in database (IndexedDB). That's enough room for many classes' worth of photos. It's not shared with other computers. Important for kiosks:
- Always open the app the **same way** in the **same browser**. The double-clicked file and `http://localhost:3000` count as two separate places with separate saved projects. If you'll use Live AI, always use `http://localhost:3000`.
- Don't use a private or incognito window. It erases everything when closed.
- Clearing the browser's "site data" or "cookies" deletes the projects. Keep backups.

Projects saved by the first (single-project) version of the app are moved automatically into a class called "My Class".

In **demo mode**, the results are clearly labeled **samples**. They were written from the real project-site photos and are adjusted using what you enter in *My Garden*. No AI looks at the photo in demo mode. The only thing measured from your actual photo is the **color check**, which is a simple pixel count and not AI.

Your work saves automatically in your browser (localStorage). Close the tab, come back later, and your plan, checkmarks and photos are still there. It's saved per browser and per computer only.

---

## 3. Turn on real AI (live mode)

Live mode sends the photo and garden details to a vision-capable AI model (Claude). It returns a real assessment, plant list, soil plan, action plan, and chat replies.

**Why a server?** An AI API key is like a password connected to billing. If you put it in `script.js`, anyone who opens the page could copy it. So the key lives in `server.js` on your computer, and the browser only talks to your server.

### Steps

1. **Install Node.js** (version 18 or newer) from <https://nodejs.org>. Choose the "LTS" version.
2. **Get an API key** from the Claude Console at <https://console.anthropic.com>. API use is billed per request, so check current pricing there. One photo analysis usually costs a few cents.
3. In the app folder, **make a copy of `.env.example` and name it `.env`**. Open it and paste your key:
   ```
   ANTHROPIC_API_KEY=sk-ant-...your key...
   ```
   (On a Mac, files starting with a dot are hidden in Finder. Press `Cmd + Shift + .` to show them.)
4. **Start the server.** Open Terminal (Mac) or Command Prompt (Windows), go to the folder, and run:
   ```
   cd "path/to/GardenGrow AI App"
   node server.js
   ```
   Tip: type `cd ` and then drag the folder into the Terminal window to fill in the path.
5. Open **<http://localhost:3000>** in your browser. Don't use the double-clicked file for this.
6. In the sidebar under **Analysis mode**, click **Live AI**. On a phone-sized screen, tap the "Demo mode" pill at the top.

To stop the server, press `Ctrl + C` in the Terminal.

**Optional settings in `.env`:** `AI_MODEL=` picks a different Claude model, and `PORT=` changes the port number.

---

## 4. Upload the project to GitHub

`upload-to-github.sh` puts this folder on GitHub, and running it again uploads your latest changes.

1. Open **Terminal**. Type `cd ` (with a space), drag this folder into the window, and press Enter.
2. Run: `bash upload-to-github.sh`
3. The first time, it walks you through these steps:
   - Your name and email, which appear on each saved version.
   - Connecting to GitHub. If the GitHub CLI (`gh`) is installed and signed in, the script creates the repository for you. Otherwise it asks you to make an **empty** repository at <https://github.com/new> and paste its link.
   - Signing in. Your username is your GitHub username, and the "password" is a **personal access token** from <https://github.com/settings/tokens> (tick "repo"), not your regular password.
4. Next time, just run it again. You can add a note describing what changed: `bash upload-to-github.sh "Added okra to the crop guide"`

The script never uploads your `.env` API key file, and it stops if one is about to be uploaded. It also skips classroom backup files (they hold student work), zip files, and extra copies of the app folder. `sample-photo.js` contains a photo of the project site, so a **private** repository is the safe default.

## 5. What's in each file

| File | What it does |
|---|---|
| `index.html` | The structure of every screen: Home, Scan, Garden Chat, My Garden, Action Plan, Progress, Tips. Each screen is a `<section class="view">`. |
| `style.css` | All the looks: colors, fonts, cards, layout, and mobile/tablet sizes. Brand colors are at the very top. |
| `script.js` | Everything interactive: saving, photo upload, demo and live analysis, crop guide, action plan, chat, and progress tracking. |
| `projects.js` | Classroom features: classes, projects, the project list, teacher PIN, kiosk auto-return, and backup/restore. |
| `sample-photo.js` | One project-site photo stored as text, for the "Try the sample photo" button. |
| `server.js` | Optional. Serves the app, keeps the API key secret, and forwards requests to the AI. |
| `.env.example` | Template for your API key file. |
| `upload-to-github.sh` | Uploads the project to GitHub (see section 4). |
| `.gitignore` | Keeps `.env`, backups, and zip files out of GitHub. |

### How the pieces talk to each other

```
Browser (index.html + script.js)
   │  photo + garden details
   ▼
server.js  (on your computer; holds the API key)
   │  photo + garden details + gardening safety rules
   ▼
Claude vision model  →  returns JSON  →  server.js  →  app displays it
```

In demo mode the browser never contacts a server. `script.js` builds the sample results itself.

---

## 6. How to make common changes

All of these are safe edits. Save the file and refresh the browser to see the result.

- **Change colors:** at the top of `style.css`, edit values like `--forest: #2E5D3A;`.
- **Change fonts:** edit the Google Fonts `<link>` in `index.html` and the `--font-head`, `--font-body`, and `--font-script` lines in `style.css`.
- **Add or edit a garden tip:** in `script.js`, find `const TIPS = [`. Copy one `{ ... }` block and change the text. Available icons: `soil`, `sun`, `drop`, `pumpkin`, `sprout`, `bug`, `calendar`, `bulb`.
- **Add a crop to the crop guide:** in `script.js`, find `const CROP_GUIDE = [`. Copy one entry, change `match` (the words that identify the crop, like `/okra/i`), and edit the facts: sun hours, pH range, days to harvest, planting time, spacing, water, and pests.
- **Change class colors:** in `projects.js`, edit `CLASS_COLORS`.
- **Add or edit an action-plan task:** in `script.js`, find `const TASK_LIBRARY = [`. Each task is a small function that receives the garden details (`g`), so it can change priority based on answers. For example, `g.sunlight === "full" ? "medium" : "high"`.
- **Change the demo results:** in `script.js`, edit `analyzeDemo()` (observations and concerns), `DEMO_PLANTS` (keep/remove list), and `buildSoilPlan()` (soil plan).
- **Change the demo chat answers:** in `script.js`, edit `demoReply()`.
- **Change what the real AI is told:** in `server.js`, edit `GARDEN_RULES` (the safety and accuracy rules) and `ANALYSIS_FORMAT` (the JSON it must return).
- **Start fresh:** go to **Teacher tools → Erase all data**.

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

- **Storage:** data lives in one browser on one computer, which is perfect for a kiosk. Photos are shrunk to save space, and each project keeps its 8 most recent progress photos. If students later need to use their own devices, the projects would need to move to a shared database. The app's storage code is in one place (section 2 of `script.js`), so that's the part to swap.
- **iPhone HEIC photos** may not open in Chrome or Firefox. Safari handles them, or you can change the iPhone camera setting to "Most Compatible" (JPG).
- **Live mode runs only on your computer.** To put it online for others, you'd host `server.js` on a service like Render, Railway, or Fly.io and set `ANTHROPIC_API_KEY` in its settings. Never put the key in the code.
- **Demo chat** answers only common questions. Open-ended questions need Live AI.
- AI can misidentify plants. Always confirm before removing anything.

### Ideas for the next version
Reminders for seasonal tasks · local frost dates from a ZIP code · exporting the plan as a PDF · a shared team task list.
