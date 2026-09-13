import type { Assignment, FieldSpec } from "../../shared/applications.js";
import type { ResumeTransfer } from "../../shared/applications.js";

export interface FormInspection { url: string; title: string; location: string; fields: FieldSpec[]; errors: string[]; signature: string; confirmation: string }
export interface PageCommand { action: "inspect" | "fill" | "validate" | "submit"; expectedUrl: string; expectedTitle: string; expectedLocation?: string; signature?: string; assignments?: Assignment[]; resume?: ResumeTransfer }
/** Self-contained so Chrome can inject it without closures or page-provided code. */
export async function ashbyPage(command: PageCommand): Promise<FormInspection> {
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const currentUrl = new URL(location.href); currentUrl.search = ""; currentUrl.hash = "";
  const errors: string[] = [];
  const sameJob = currentUrl.href.replace(/\/$/, "") === command.expectedUrl.replace(/\/$/, "");
  const title = document.querySelector("h1")?.textContent?.trim() ?? "";
  const liveLocation = [...document.querySelectorAll("h2")].find(e => e.textContent?.trim() === "Location")?.parentElement?.querySelector("p")?.textContent?.trim() ?? "";
  if (!sameJob) errors.push("The application URL changed.");
  if (norm(title) !== norm(command.expectedTitle)) errors.push("The job title on this page does not match the queued job.");
  if (command.expectedLocation !== undefined && norm(liveLocation) !== norm(command.expectedLocation)) errors.push("The work location changed after inspection.");
  // Visible challenges need the applicant. Invisible anti-bot integration is left to the website.
  if ([...document.querySelectorAll<HTMLIFrameElement>('iframe[src*="bframe"], iframe[title*="challenge" i]')].some(e => e.getBoundingClientRect().height > 100)) errors.push("Complete the visible verification challenge in the application tab.");
  const containers = [...document.querySelectorAll<HTMLElement>(".ashby-application-form-field-entry[data-field-path]")];
  const specs: FieldSpec[] = [], byId = new Map<string, HTMLElement>();
  for (const container of containers) {
    const id = container.dataset.fieldPath!;
    if (byId.has(id)) { errors.push("Duplicate field identity in application form."); continue; }
    byId.set(id, container);
    const labelNode = container.querySelector<HTMLLabelElement>(".ashby-application-form-question-title, label");
    const label = labelNode?.textContent?.trim().replace(/\s+/g, " ") ?? "";
    const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input:not([type=hidden]),textarea,select");
    const yesNo = container.querySelector(".ashby-application-form-input-yesno");
    const required = Boolean(input?.required || input?.getAttribute("aria-required") === "true" || labelNode?.className.includes("_required") || labelNode?.dataset.required === "true");
    let type = yesNo ? "yesno" : input?.tagName === "SELECT" ? "select" : input?.tagName === "TEXTAREA" ? "textarea" : input?.type ?? "unsupported";
    if (container.querySelector('[role="combobox"]') && input?.tagName !== "SELECT") type = "unsupported";
    const options = yesNo ? ["Yes", "No"] : input?.tagName === "SELECT" ? [...(input as HTMLSelectElement).options].filter(o => o.value && !o.disabled).map(o => o.text.trim()) : type === "checkbox" ? ["Yes", "No"] : type === "radio" ? [...container.querySelectorAll<HTMLInputElement>('input[type=radio]')].map(e => e.labels?.[0]?.textContent?.trim() ?? e.value) : [];
    specs.push({ id, label, type, required, options });
  }
  const signature = JSON.stringify(specs);
  for (const required of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input[required],textarea[required],select[required]")) {
    if (!required.closest(".ashby-application-form-field-entry[data-field-path]") && !required.disabled) errors.push("A required field is outside the supported form structure.");
  }
  if (command.signature && command.signature !== signature) errors.push("The form changed after inspection. Inspect it again.");
  const submitButtons = [...document.querySelectorAll<HTMLButtonElement>("button")].filter(b => /^submit application$/i.test(b.textContent?.trim() ?? ""));
  const activeForm = Boolean(specs.length && submitButtons.length === 1);
  const confirmationNode = [...document.querySelectorAll<HTMLElement>(".ashby-application-form-success, .ashby-application-form-success-container, h1, h2, h3")].find(e => /^(application submitted|your application has been submitted[.!]?|thank you for applying[.!]?)$/i.test(e.textContent?.trim() ?? "") && e.getBoundingClientRect().height > 0);
  const confirmation = !activeForm && sameJob && confirmationNode ? confirmationNode.textContent!.trim() : "";
  if (command.action !== "inspect" && !activeForm) errors.push("The supported application form is not available.");
  if (!specs.length && !confirmation) errors.push("No supported Ashby form fields were found.");
  const assignments = command.assignments ?? [];
  if (command.action === "fill" && !errors.length) {
    for (const a of assignments) {
      const container = byId.get(a.field.id)!;
      const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input:not([type=hidden]),textarea,select");
      if (!input || input.disabled) { errors.push("Field cannot be filled: " + a.field.label); continue; }
      if (a.field.type === "yesno") {
        const button = [...container.querySelectorAll<HTMLButtonElement>("button[data-option]")].find(b => norm(b.textContent ?? "") === norm(a.value));
        if (!button) { errors.push("Choice unavailable: " + a.field.label); continue; }
        button.click();
      } else if (a.field.type === "file") {
        const r = command.resume;
        if (!r || r.asset.id !== a.value) { errors.push("Selected résumé is unavailable."); continue; }
        const binary = atob(r.data), bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        const transfer = new DataTransfer(); transfer.items.add(new File([bytes], r.asset.name, { type: r.asset.mime }));
        (input as HTMLInputElement).files = transfer.files; input.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (a.field.type === "checkbox") {
        const checkbox = input as HTMLInputElement;
        const checked = norm(a.value) === "yes"; if (checkbox.checked !== checked) checkbox.click();
      } else if (a.field.type === "radio") {
        const option = [...container.querySelectorAll<HTMLInputElement>('input[type=radio]')].find(e => norm(e.labels?.[0]?.textContent ?? e.value) === norm(a.value));
        if (option) option.click(); else errors.push("Choice unavailable: " + a.field.label);
      } else {
        let value = a.value;
        if (a.field.type === "select") {
          const option = [...(input as HTMLSelectElement).options].find(o => norm(o.text) === norm(a.value));
          if (!option) { errors.push("Choice unavailable: " + a.field.label); continue; } value = option.value;
        }
        const proto = input.tagName === "SELECT" ? HTMLSelectElement.prototype : input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); input.dispatchEvent(new Event("blur", { bubbles: true }));
      }
      await sleep(30);
    }
    // Let controlled inputs and file-upload UI settle. Upload progress still blocks submit below.
    await sleep(700);
  }
  if (["validate", "submit"].includes(command.action) && !errors.length) {
    for (const a of assignments) {
      const container = byId.get(a.field.id)!;
      const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input:not([type=hidden]),textarea,select");
      let actual = input?.value ?? "";
      if (input && a.field.type !== "file" && !input.checkValidity()) errors.push("The value fails the field's validation rules: " + a.field.label);
      if (a.field.type === "yesno") actual = container.querySelector('[data-option][aria-pressed="true"]')?.textContent ?? "";
      if (a.field.type === "checkbox") actual = (input as HTMLInputElement)?.checked ? "Yes" : "No";
      if (a.field.type === "radio") { const selected = container.querySelector<HTMLInputElement>('input[type=radio]:checked'); actual = selected?.labels?.[0]?.textContent ?? selected?.value ?? ""; }
      if (a.field.type === "select") actual = (input as HTMLSelectElement)?.selectedOptions[0]?.text ?? "";
      if (a.field.type === "file") {
        const name = command.resume?.asset.name ?? "";
        if (!name || (!Array.from((input as HTMLInputElement)?.files ?? []).some(f => f.name === name) && !container.textContent?.includes(name))) errors.push("Résumé upload could not be verified.");
      } else if (actual.replace(/\r\n/g, "\n").trim() !== a.value.replace(/\r\n/g, "\n").trim()) errors.push("Value changed or was not accepted: " + a.field.label);
    }
    for (const f of specs.filter(f => f.required)) if (!assignments.some(a => a.field.id === f.id)) errors.push("Required answer missing: " + f.label);
    const visibleErrors = [...document.querySelectorAll<HTMLElement>('[aria-invalid="true"], .ashby-application-form-error, [role=alert]')].filter(e => e.getBoundingClientRect().height > 0 && (e.getAttribute("aria-invalid") === "true" || Boolean(e.textContent?.trim())));
    if (visibleErrors.length) errors.push("The application form reports a validation error.");
    if (document.querySelector('[data-state="uploading"], [aria-busy="true"]')) errors.push("A file upload or form update is still in progress.");
    if (submitButtons[0]?.disabled) errors.push("The submit button is disabled.");
  }
  if (command.action === "submit" && !errors.length) submitButtons[0]!.click();
  return { url: location.href, title, location: liveLocation, fields: specs, errors, signature, confirmation };
}
