# JobRadar Assist 0.3

The first application runner supports selected **Ashby** jobs in the USA and India. It reads the employer form, maps saved candidate facts, uploads the selected résumé, checks the resulting values, and submits when the applicant has authorized that run. It uses deterministic code and makes no LLM calls.

This is a local development build. An installed extension passes controlled browser fixtures; a small authorized live pilot is still required before release. No real applications were submitted during development. This version replaces the earlier generic fill-only extension. The old `fill.js` is retained as historical source and is not loaded.

## Install

From this directory:

```sh
npm ci
npm run build
```

1. Open `chrome://extensions` or `edge://extensions` and enable Developer mode.
2. Choose **Load unpacked** and select **`extension/dist`**, which contains the built `background.js` and `manifest.json`. Do not select the source `extension` directory.
3. If using the packaged ZIP, extract it and select the extracted folder containing `manifest.json`.
4. Start the JobRadar app with `npm run dev` in `app/`. Open `http://localhost:5174` in the same browser as the extension. Reload the page after installing or updating the extension.
5. In **Queue**, click **Connect JobRadar Assist**.

The bridge accepts only the configured JobRadar GitHub Pages path and local port 5174. The hosted app has not been updated with these changes; use the local preview for this build. Keep the browser open while running applications. Closing the browser or stopping its worker interrupts the run; it does not continue in the cloud.

## Use

1. In **My jobs**, choose your roles and USA, India, or both.
2. In **Profile**, save your contact information, upload a PDF or DOCX (up to 2 MB; three versions), and select the résumé to use. Give USA and India their own work-authorization, sponsorship, notice and compensation answers. Salary currency, period and base pay/total/CTC remain distinct.
3. Add matching Ashby jobs with **Add to queue**. Other sites remain available through **View & apply**.
4. Choose individual queued jobs, or **Next queued jobs automatically**, with a limit of 1–10 per run. Each included job is marked **In this run**. Company exclusions match normalized company names exactly. A job eligible for both markets requires an explicit application market.
5. Choose **Inspect forms without sending answers** to see mapped answers and missing questions. This copies the chosen profile and document into the local extension but does not fill employer fields, upload a file to the employer, or submit.
6. Save any missing exact answers in **Profile**, scoped to the job market and role, then inspect again. Unsupported controls can still require manual completion.
7. Review the included jobs and profile, check the authorization box, then choose **Apply**. Complete supported forms can be submitted without another final click. The authorization resets when the profile, selection, search, or rules change.
8. **Stop remaining applications** stops work before the next submit click. A request already sent cannot be undone. The extension popup also has a stop control.

Only an observed, supported employer confirmation moves the item to **confirmed** and adds it to the app's tracker. **submission uncertain** means a submit click occurred or could have occurred without verified confirmation; check the employer tab and receipt. The runner blocks retries for confirmed and uncertain entries. Do not remove records merely to bypass that protection.

## Supported forms and pauses

Supported: Ashby's standard field containers, text/email/phone/number fields, textareas, native selects, yes/no buttons, radio buttons, checkboxes with saved answers, and the selected résumé upload. Field identity, options and requiredness are checked again before submission. Both the job URL/title and live work location must agree with the queued job's scope.

Required unknown questions, conflicting answers, unfamiliar controls, visible verification challenges, changed field values, upload errors, redirects, or changes to the job/form cause a pause. Required custom comboboxes and additional document types such as cover letters are currently unsupported. Complex, negated or differently scoped eligibility questions need an exact answer. No answers are invented, and visiting an employer page alone never starts the runner.

Confirmation recognition is limited to supported success states. An unfamiliar success page may produce **submission uncertain** even if the employer received the application. Fixtures establish the implemented behavior, not coverage of every Ashby customization.

## Local data

The app stores candidate facts and its queue in browser local storage; résumé blobs use IndexedDB. The extension stores immutable run profile copies, deduplicated résumé copies and durable progress in `chrome.storage.local`. Data is not encrypted by this application. No portal passwords or cloud account are required. An authorized apply run sends its saved facts and selected document to the queued employer form.

**Export data** backs up the app's profile, queue, tracker and document references as JSON; it does not include résumé bytes or all immutable extension snapshots. Download résumé versions separately. Imported references require the matching files on the new device.

To remove app résumé files, use **Profile → Remove**. To erase the extension's copies and history, stop the runner and use **Queue → Delete private runner data**. That action resets extension duplicate protection; the app's queue remains. Clearing the app's site data removes its local storage and IndexedDB. Uninstalling this development extension removes its own stored data.

## Validation

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

The browser suite installs the built extension into an isolated Chromium profile and intercepts all network requests. Synthetic applications stay on fixtures. It covers inspection, upload and submission, confirmation, unknown answers, controlled-input changes, missing confirmation, stop, document integrity, simultaneous starts, changed required fields, unsupported structure, changed live country, restart recovery and deletion. CI runs this suite alongside app and collector checks.

Discovery uses the [Ashby public job posting API](https://developers.ashbyhq.com/docs/public-job-posting-api). Submission uses the supported employer page; a public listing endpoint is not a submission credential. Browser testing follows [Playwright's extension testing setup](https://playwright.dev/docs/chrome-extensions).
