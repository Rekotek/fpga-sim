// The assistant's conversation (decision 175): the tool loop, stop, the call cap and a reset mid-answer.
import { beforeEach, describe, expect, test } from "vitest";
import type { AssistantBlock, AssistantMessage, AssistantReply } from "../build/types";
import { ask, MAX_CALLS, resetConversation, stop, useConversation, type AskDeps } from "./conversation";
import type { ToolSource } from "./tools";

const usage = { input: 10, output: 5, cacheRead: 1, cacheWrite: 0 };
const toolUse = (id: string, name: string): AssistantBlock => ({ type: "tool_use", id, name, input: {} });
const reply = (content: AssistantBlock[], stop_reason = "tool_use"): AssistantReply => ({
  content,
  stop_reason,
  usage,
});

// Only the readers of list_files: any other tool throws, and the loop must report it to the model.
const source = {
  files: () => [{ path: "top.v", content: "module top; endmodule" }],
  topFile: () => "top.v",
  testbenches: () => [],
} as unknown as ToolSource;

// A scripted server: each call returns the next reply; the sent conversations are kept.
function server(replies: (AssistantReply | Error)[], onCall?: (n: number) => void) {
  const sent: AssistantMessage[][] = [];
  const call = (messages: AssistantMessage[]): Promise<AssistantReply> => {
    sent.push(structuredClone(messages));
    onCall?.(sent.length);
    const next = replies.shift() ?? reply([toolUse(`t${String(sent.length)}`, "list_files")]);
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  const deps: AskDeps = { call, source, language: "ru" };
  return { sent, deps };
}

// Every tool_use of the assistant turn has a tool_result in the next user turn.
function closed(history: AssistantMessage[]): boolean {
  return history.every((m, i) => {
    if (m.role !== "assistant" || typeof m.content === "string") return true;
    const ids = m.content.filter((b) => b.type === "tool_use").map((b) => b.id);
    const next = history[i + 1]?.content;
    const results = Array.isArray(next) ? next.filter((b) => b.type === "tool_result").map((b) => b.tool_use_id) : [];
    return ids.every((id) => results.includes(id));
  });
}

beforeEach(() => {
  resetConversation();
});

describe("разговор с помощником", () => {
  test("два шага: инструмент, затем ответ", async () => {
    const { sent, deps } = server([
      reply([{ type: "thinking", thinking: "", signature: "s" }, toolUse("a", "list_files")]),
      reply([{ type: "text", text: "Ответ." }], "end_turn"),
    ]);
    await ask("Почему?", deps);
    const [turn] = useConversation.getState().turns;
    expect(turn).toMatchObject({ question: "Почему?", answer: "Ответ.", tools: ["list_files"], error: null });
    expect(turn?.tokens).toBe(32);
    expect(sent[1]?.[1]?.content).toEqual([
      { type: "thinking", thinking: "", signature: "s" },
      toolUse("a", "list_files"),
    ]);
    const results = sent[1]?.[2]?.content as AssistantBlock[];
    expect(results[0]).toMatchObject({ type: "tool_result", tool_use_id: "a" });
    expect(String(results[0]?.content)).toContain("top.v");
    expect(useConversation.getState().busy).toBe(false);
    expect(closed(useConversation.getState().history)).toBe(true);
  });

  test("ошибка инструмента уходит модели как is_error", async () => {
    const { sent, deps } = server([
      reply([toolUse("a", "format_disk"), toolUse("b", "get_board")]),
      reply([{ type: "text", text: "Ок" }], "end_turn"),
    ]);
    await ask("?", deps);
    const results = sent[1]?.[2]?.content as AssistantBlock[];
    expect(results[0]).toMatchObject({ tool_use_id: "a", is_error: true });
    expect(results[1]).toMatchObject({ tool_use_id: "b", is_error: true });
    expect(String(results[1]?.content)).toContain("tool failed");
    expect(useConversation.getState().turns[0]?.answer).toBe("Ок");
  });

  test("стоп посреди цикла оставляет разговор целым", async () => {
    const { deps } = server([], (n) => {
      if (n === 2) stop();
    });
    await ask("?", deps);
    const state = useConversation.getState();
    expect(state.turns[0]?.stopped).toBe(true);
    expect(closed(state.history)).toBe(true);
    expect(state.history.at(-1)?.role).toBe("user");
  });

  test("предел вызовов", async () => {
    const { sent, deps } = server([]);
    await ask("?", deps);
    expect(sent).toHaveLength(MAX_CALLS);
    const state = useConversation.getState();
    expect(state.turns[0]?.capped).toBe(true);
    expect(closed(state.history)).toBe(true);
  });

  test("ответ после сброса разговора отбрасывается", async () => {
    const { deps } = server([reply([{ type: "text", text: "поздно" }], "end_turn")], () => {
      resetConversation();
    });
    await ask("?", deps);
    expect(useConversation.getState().turns).toEqual([]);
    expect(useConversation.getState().history).toEqual([]);
  });

  test("ошибка сервера показывается в ходе, следующий вопрос работает", async () => {
    const { deps } = server([new Error("Дневной лимит"), reply([{ type: "text", text: "Да" }], "end_turn")]);
    await ask("первый", deps);
    expect(useConversation.getState().turns[0]?.error).toBe("Дневной лимит");
    await ask("второй", deps);
    const state = useConversation.getState();
    expect(state.turns[1]?.answer).toBe("Да");
    expect(state.history.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  test("отказ модели", async () => {
    const { deps } = server([reply([], "refusal")]);
    await ask("?", deps);
    expect(useConversation.getState().turns[0]?.error).toBe("refused");
  });
});
