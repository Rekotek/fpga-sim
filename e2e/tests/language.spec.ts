// English interface (decision 168): choice by address and by browser, the switch, saving an edit
// before a reload, translation of build messages and of the board device label.
import { expect, test, type Page } from "@playwright/test";
import { ADMIN, build, createFromExample, openAs, openWithKey, replaceEditorText, sim, KEY } from "./stand";

const CYRILLIC = /[А-Яа-яЁё]/;

// Page text without the editor and the file list: the example code stays Russian.
async function visibleText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const body = document.body.cloneNode(true) as HTMLElement;
    for (const skip of body.querySelectorAll('.cm-editor, [data-testid="file-path"], [data-testid="file"]'))
      skip.remove();
    return body.innerText;
  });
}

async function switchLanguage(page: Page, lang: "ru" | "en"): Promise<void> {
  await page.getByTestId("language-toggle").click();
  await page.getByTestId(`language-${lang}`).click();
  await expect.poll(() => sim(page, (api) => api.language())).toBe(lang);
}

test("?lang=en: экран входа по-английски, выбор сохраняется", async ({ page }) => {
  await page.goto("/?debug=1&lang=en");
  await expect(page.getByTestId("login-form")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(await sim(page, (api) => api.language())).toBe("en");
  await expect(page.getByTestId("login-submit")).toHaveText("Sign in");
  expect(await visibleText(page)).not.toMatch(CYRILLIC);
  // Without the parameter the language comes from the saved choice.
  await page.goto("/?debug=1");
  expect(await sim(page, (api) => api.language())).toBe("en");
});

test.describe("браузер на английском", () => {
  test.use({ locale: "en-US" });

  test("сборка: сообщения и подпись устройства по-английски", async ({ page }) => {
    await openWithKey(page);
    expect(await sim(page, (api) => api.language())).toBe("en");
    expect(await visibleText(page)).not.toMatch(CYRILLIC);
    await createFromExample(page, "blink3");
    await page.locator('[data-testid="file"]', { hasText: "top.cst" }).click();
    // led[1] on the TF card pin: the device model will appear in version 3, the server gives a note.
    const cst = (await sim(page, (api) => api.file("top.cst"))) ?? "";
    await replaceEditorText(page, cst.replace('IO_LOC "led[1]" 16;', 'IO_LOC "led[1]" 83;'));
    await build(page);
    const messages = await sim(page, (api) => api.messages());
    const device = messages.find((m) => m.code === "DEVICE_NOT_MODELED");
    expect(device?.text).toContain("TF card");
    for (const m of messages) expect(`${m.text} ${m.explain ?? ""}`).not.toMatch(CYRILLIC);
    expect(await visibleText(page)).not.toMatch(CYRILLIC);
  });

  test("замечание ядра на вкладке сообщений по-английски (решение 183)", async ({ page }) => {
    await openWithKey(page);
    // Without PULL_MODE a released button leaves the input floating: the core sends INPUT_FLOATING in Russian.
    await createFromExample(page, "buttons_nopull");
    expect(await build(page)).toBe("ok");
    const notice = page.getByTestId("notice").filter({ hasText: "INPUT_FLOATING" }).first();
    await expect(notice).toContainText("the FPGA input is not connected and not pulled");
    expect(await notice.innerText()).not.toMatch(CYRILLIC);
  });

  test("отказ сервера по-английски: логин уже занят (решение 183)", async ({ page }) => {
    test.skip(!ADMIN.password, "стенд не завёл учётные записи (e2e/run.sh)");
    await openAs(page, ADMIN);
    await page.getByTestId("account-menu").click();
    await page.getByTestId("account-users").click();
    await expect(page.getByTestId("users-page")).toBeVisible();
    await page.getByTestId("user-add").click();
    await page.getByTestId("user-add-login").fill(ADMIN.login);
    await page.getByTestId("user-add-name").fill("Copy");
    await page.getByTestId("user-add-submit").click();
    // The server sends the Russian text and args {reason: "loginTaken", login}: the interface shows its own string.
    await expect(page.getByTestId("user-problem")).toHaveText(`Login ${ADMIN.login} is already taken`);
  });
});

test("переключатель: правка не теряется, язык сменяется после перезагрузки", async ({ page }) => {
  test.skip(!KEY, "нужен ключ сервера сборки");
  await openWithKey(page);
  expect(await sim(page, (api) => api.language())).toBe("ru");
  await createFromExample(page, "blink3");
  // A new project opens on the file with the top module (top.v).
  await expect(page.locator('[data-testid="file"][aria-current="true"]')).toContainText("top.v");
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("\n// language switch\n");
  // Right away, without waiting for the draft write after 300 ms: the switch menu takes longer to open.
  await Promise.all([page.waitForEvent("load"), sim(page, (api) => void api.setLanguage("en"))]);
  await expect.poll(() => sim(page, (api) => api.language())).toBe("en");
  await expect(page.getByTestId("language-toggle")).toBeVisible();
  expect(page.url()).not.toContain("lang=");
  await expect.poll(() => sim(page, (api) => api.editor().dirty)).toContain("top.v");
  expect(await page.locator(".cm-content").innerText()).toContain("// language switch");
  await switchLanguage(page, "ru");
});
