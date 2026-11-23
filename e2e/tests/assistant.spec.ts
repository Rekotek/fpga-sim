// The assistant (decision 175) on the local bench. The server runs the scripted test model (decision 177): it asks
// for list_files and get_board, then answers with a fixed text; "#сбой" in the question makes it fail.
import { expect, test, type Page } from "@playwright/test";
import { build, createFromExample, openWithKey, sim } from "./stand";

const ANSWER = "Тестовый ответ. Инструменты: list_files, get_board.";

async function askAssistant(page: Page, question: string): Promise<void> {
  await page.getByTestId("assistant-input").fill(question);
  await page.getByTestId("assistant-ask").click();
}

test("помощник отвечает по инструментам, показывает ошибку и забывает разговор с проектом", async ({ page }) => {
  await openWithKey(page);
  await createFromExample(page, "blink3");
  expect(await build(page)).toBe("ok");
  await page.getByTestId("tab-assistant").click();
  await expect(page.getByTestId("assistant-notice")).toBeVisible();

  await askAssistant(page, "Почему мигает?");
  // Each tool step stays on the screen before the tool runs (decision 178).
  await expect(page.getByTestId("assistant-step")).toHaveText("Смотрю плату и выводы…");
  await expect
    .poll(() => sim(page, (api) => api.assistant()))
    .toEqual([
      {
        question: "Почему мигает?",
        answer: ANSWER,
        tools: ["list_files", "get_board"],
        tokens: 240,
        error: null,
      },
    ]);
  await expect(page.getByTestId("assistant-answer")).toHaveText(ANSWER);
  await expect(page.getByTestId("assistant-tools")).toHaveText("Помощник посмотрел: список файлов, плату и выводы");
  await expect(page.getByTestId("assistant-turn")).toContainText("240");

  await askAssistant(page, "проверка #сбой");
  await expect.poll(() => sim(page, (api) => api.assistant().at(-1)?.error)).toBe("Помощник не ответил: тестовый сбой");
  await expect(page.getByTestId("assistant-error")).toHaveText("Помощник не ответил: тестовый сбой");

  // After a failed question the conversation goes on.
  await askAssistant(page, "И ещё?");
  await expect.poll(() => sim(page, (api) => api.assistant().at(-1)?.answer)).toBe(ANSWER);

  await page.getByTestId("assistant-reset").click();
  expect(await sim(page, (api) => api.assistant())).toEqual([]);

  await askAssistant(page, "Снова?");
  await expect.poll(() => sim(page, (api) => api.assistant().length)).toBe(1);
  await page.getByTestId("back").click();
  await page.getByTestId("project-row").filter({ hasText: "blink3" }).getByTestId("project-open").click();
  await expect(page.getByTestId("project-name")).toHaveText("blink3");
  expect(await sim(page, (api) => api.assistant())).toEqual([]);
});
