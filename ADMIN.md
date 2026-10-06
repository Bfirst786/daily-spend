# Daily Spend: administrator guide

This guide is for the person who owns this repository. The guide for people using the
app is [README.md](README.md).

## How it works

- Daily Spend is a static web app: plain HTML, CSS and JavaScript, with no server,
  database or build step.
- **GitHub Pages** hosts it for free at **<https://bfirst786.github.io/daily-spend/>**.
- Every push to `main` runs the tests. If they pass, the workflow publishes the site,
  `.github/workflows/pages.yml`.
- Two files make it installable:
  - `manifest.webmanifest`: the app's name, icons and full-screen mode.
  - `sw.js`: keeps a copy of the app on the phone so it works offline.
- Each person's data is saved in their own browser's storage on their device. You can't
  see anyone's data, and there's nothing to back up on your side.

## One-time setup

1. **Create the repository** on GitHub: <https://github.com/new>
   - Owner: `Bfirst786`. Name: `daily-spend`.
   - Visibility: **Public**. GitHub Pages is free only for public repositories.
     The code contains no secrets or personal data.
   - Leave "Add a README" unchecked. The code supplies one.
2. **Give Claude access** (only if Claude is pushing the code for you): at
   <https://github.com/settings/installations>, open the **Claude** app, choose
   **Configure**, and under *Repository access* add `daily-spend` (or allow all repositories).
3. **Turn on Pages:** in the repository, go to **Settings → Pages → Build and
   deployment → Source** and choose **GitHub Actions**. That's the only setting needed.
4. **Run the first deploy:** go to the **Actions** tab, open
   **Test and deploy to GitHub Pages**, and click **Run workflow** (or push any commit to
   `main`). Wait for both jobs, `test` and `deploy`, to show a green check. That takes
   about a minute.
5. **Check the link:** open <https://bfirst786.github.io/daily-spend/>. The first
   deploy can take a few minutes to appear.

## Check that everything works

After the first deploy, on your own phone:

- [ ] The link opens and shows **Daily Spend**.
- [ ] **iPhone:** in Safari, Share → *Add to Home Screen* shows the green receipt icon
      and the name "Daily Spend".
- [ ] **Android:** Chrome offers **Install**, or ⋮ → *Install app*. If it only offers
      "Add to Home screen" as a shortcut, wait a minute and reload: the offline file has
      to finish loading once.
- [ ] Open the installed app. It opens full screen with no browser address bar.
- [ ] Add a purchase, close the app completely, and reopen it. The purchase is still there.
- [ ] Turn on airplane mode and reopen the app. It still opens and works.
- [ ] Under Backup, **Save backup** produces a file and **Restore backup** reads it back.

For a technical check, on a computer open the link in Chrome, then DevTools →
**Application**. **Manifest** should list no errors, and **Service workers** should show
`sw.js` as *activated and running*.

## Sharing it

Send people the link: **<https://bfirst786.github.io/daily-spend/>**. The README has
the install steps you can send with it, at
<https://github.com/Bfirst786/daily-spend#readme>.

Nobody needs a GitHub or Claude account to use it. Each person's data stays on their
own phone.

## Making changes

1. Edit the files and run the tests with `npm test`. It needs Node.js 20 or newer and
   has no packages to install.
2. Try it locally with `npm start`, then open <http://localhost:8080>. The offline file
   only runs on the real https site, so local testing always gets fresh files.
3. Push to `main`. The workflow tests and redeploys automatically.

Users get the update the next time they open the app with a connection. The service
worker always asks the network first and falls back to the saved copy when offline.

**If you add, rename or remove a file the app loads,** update the `SHELL` list in
`sw.js` and change `VERSION` (for example `"v1"` to `"v2"`). Otherwise that file may
be missing when someone is offline.

**Never rename the storage key** `daily-spend:v1` in `js/app.js`. Everyone's saved
purchases are stored under it.

## Files

| File | What it does |
|---|---|
| `index.html` | The page layout |
| `styles.css` | Colors, light and dark themes, layout |
| `js/app.js` | The app: screens, buttons, saving, backup, install prompt |
| `js/core.js` | Calculations with no screen code (totals, keypad, phrase reading, backups), so they can be tested |
| `tests/core.test.js` | Tests, run by `npm test` and by the workflow |
| `sw.js` | Offline support |
| `manifest.webmanifest` | Install details: name, icons, colors, Quick log shortcut |
| `icons/` | App icons (`apple-touch-icon.png` is the iPhone one) |
| `.github/workflows/pages.yml` | Tests and publishes to GitHub Pages |
| `.nojekyll` | Tells GitHub Pages to serve the files as they are |

## Troubleshooting

- **The link shows 404:**
  - Check Settings → Pages: the source must be **GitHub Actions**.
  - Check the latest run in the Actions tab is green.
  - The repository must be public, unless you have a paid GitHub plan.
- **The `deploy` job fails with "Pages not enabled" or "Get Pages site failed":** do
  step 3 of the setup, then re-run the workflow.
- **The `test` job fails:** run `npm test` locally. The output names the failing test.
  Nothing is published until the tests pass, so the live app is unaffected.
- **A phone shows an old version:** close the app fully and reopen it while online.
- **Someone lost their data:** it can only come back from a backup file they saved.
  Their data isn't stored anywhere you can reach.
- **The app shows under the wrong name or icon:** the phone saves these when the app is
  installed. Remove the app from the home screen and install it again.
- **Custom domain (optional):** Settings → Pages → *Custom domain*, then follow GitHub's
  DNS instructions. Installed copies keep working only at the address they were
  installed from, so pick the address before sharing it widely.
