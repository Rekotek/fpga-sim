// The "Assistant" tab (decision 175): a question box, the conversation, "Stop" and "New conversation".
import { SendIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { serverClient } from "../app/actions";
import { EmptyState, Problem, Toolbar } from "../app/kit";
import { currentLanguage, t, tOr } from "../i18n";
import { ask, resetConversation, stop, useConversation, type Turn } from "./conversation";
import { liveSource } from "./live";
import { Markdown } from "./Markdown";

function send(question: string): void {
  const client = serverClient();
  void ask(question, {
    call: (messages, language) =>
      client ? client.assistant(messages, language) : Promise.reject(new Error(t("assistant.noServer"))),
    source: liveSource(),
    language: currentLanguage(),
  });
}

function TurnView({ turn }: { turn: Turn }) {
  return (
    <div className="space-y-1.5" data-testid="assistant-turn">
      <p className="font-medium whitespace-pre-wrap">{turn.question}</p>
      {turn.answer && (
        <div data-testid="assistant-answer">
          <Markdown text={turn.answer} />
        </div>
      )}
      {turn.error && (
        <Problem data-testid="assistant-error">
          {turn.error === "refused" ? t("assistant.refused") : turn.error}
        </Problem>
      )}
      {(turn.stopped || turn.capped) && (
        <p className="text-muted-foreground">{t(turn.stopped ? "assistant.stopped" : "assistant.capped")}</p>
      )}
      {turn.tokens > 0 && (
        <p className="text-xs text-muted-foreground tabular-nums">{t("assistant.tokens", { count: turn.tokens })}</p>
      )}
    </div>
  );
}

export function AssistantPanel() {
  const { turns, busy, step } = useConversation();
  const [question, setQuestion] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [turns.length, busy]);
  const submit = (): void => {
    const text = question.trim();
    if (!text || busy) return;
    setQuestion("");
    send(text);
  };
  return (
    <section className="flex min-h-0 flex-col" data-testid="assistant">
      <Toolbar className="shrink-0">
        <span className="text-xs text-muted-foreground" data-testid="assistant-notice">
          {t("assistant.notice")}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={resetConversation}
          disabled={turns.length === 0}
          data-testid="assistant-reset"
        >
          {t("assistant.reset")}
        </Button>
      </Toolbar>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-3 py-2">
        {turns.length === 0 && <EmptyState>{t("assistant.empty")}</EmptyState>}
        {turns.map((turn, i) => (
          <TurnView key={i} turn={turn} />
        ))}
        {busy && (
          <p className="text-muted-foreground" data-testid="assistant-step">
            {step ? tOr(`assistant.step.${step}`, "assistant.thinking") : t("assistant.thinking")}
          </p>
        )}
        <div ref={end} />
      </div>
      <div className="flex shrink-0 items-end gap-2 border-t p-2">
        <Textarea
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={t("assistant.placeholder")}
          rows={2}
          className="min-h-0 resize-none"
          data-testid="assistant-input"
        />
        {busy ? (
          <Button type="button" variant="outline" onClick={stop} data-testid="assistant-stop">
            <SquareIcon />
            {t("assistant.stop")}
          </Button>
        ) : (
          <Button type="button" onClick={submit} disabled={!question.trim()} data-testid="assistant-ask">
            <SendIcon />
            {t("assistant.ask")}
          </Button>
        )}
      </div>
    </section>
  );
}
