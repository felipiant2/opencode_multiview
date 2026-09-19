import type { Message, Part, Session } from "@opencode-ai/sdk/v2/client"
import { For, Show, createEffect, createMemo, createSignal, on } from "solid-js"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createSessionSubagents, sessionModelLabel } from "@/pages/session/subagents"

function localeText(locale: string, br: string, en: string) {
  return locale === "br" ? br : en
}

function usd(locale: string, value: number) {
  return new Intl.NumberFormat(locale === "br" ? "pt-BR" : "en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
    maximumFractionDigits: value > 0 && value < 0.01 ? 6 : 2,
  }).format(value)
}

function compactNumber(locale: string, value: number) {
  return new Intl.NumberFormat(locale === "br" ? "pt-BR" : "en-US", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value)
}

function statusLabel(locale: string, status: "idle" | "busy" | "retry") {
  if (locale === "br") {
    if (status === "busy") return "executando"
    if (status === "retry") return "tentando novamente"
    return "finalizado"
  }
  if (status === "busy") return "running"
  if (status === "retry") return "retrying"
  return "finished"
}

function ToolPartView(props: { part: Extract<Part, { type: "tool" }> }) {
  const state = () => props.part.state
  const detail = createMemo(() => {
    const current = state()
    if (current.status === "completed") return current.output
    if (current.status === "error") return current.error
    if (current.status === "running") return current.title
    return undefined
  })

  return (
    <div class="rounded-md border border-border-base bg-surface-base px-3 py-2 flex flex-col gap-1.5">
      <div class="flex items-center gap-2 text-12-medium text-text-strong">
        <span>{props.part.tool}</span>
        <span class="ml-auto text-11-regular text-text-weak">{state().status}</span>
      </div>
      <Show when={detail()}>
        {(value) => <pre class="max-h-48 overflow-auto whitespace-pre-wrap text-11-regular text-text-weak">{value()}</pre>}
      </Show>
    </div>
  )
}

function MessageView(props: { message: Message; parts: Part[] }) {
  return (
    <div class="flex flex-col gap-2 border-b border-border-weaker-base pb-4">
      <div class="flex items-center gap-2 text-11-regular text-text-weak">
        <span class="uppercase">{props.message.role}</span>
        <span>•</span>
        <span>{new Date(props.message.time.created).toLocaleTimeString()}</span>
      </div>
      <For each={props.parts}>
        {(part) => (
          <Show
            when={part.type === "text" || part.type === "tool" || part.type === "subtask"}
          >
            <Show when={part.type === "text"}>
              <Markdown text={(part as Extract<Part, { type: "text" }>).text} class="text-12-regular" />
            </Show>
            <Show when={part.type === "tool"}>
              <ToolPartView part={part as Extract<Part, { type: "tool" }>} />
            </Show>
            <Show when={part.type === "subtask"}>
              <div class="rounded-md border border-border-base px-3 py-2 text-12-regular">
                <div class="text-text-strong">
                  {(part as Extract<Part, { type: "subtask" }>).agent}
                </div>
                <div class="text-text-weak">
                  {(part as Extract<Part, { type: "subtask" }>).description}
                </div>
              </div>
            </Show>
          </Show>
        )}
      </For>
    </div>
  )
}

export function SessionSubagentsTab() {
  const language = useLanguage()
  const serverSync = useServerSync()
  const { params } = useSessionLayout()
  const subagents = createSessionSubagents(() => params.id)
  const [selectedID, setSelectedID] = createSignal<string>()

  const locale = () => language.locale()
  const selected = createMemo<Session | undefined>(() => {
    const id = selectedID()
    if (!id) return
    return serverSync().session.get(id)
  })
  const selectedMessages = createMemo(() => {
    const id = selectedID()
    return id ? (serverSync().session.data.message[id] ?? []) : []
  })

  createEffect(
    on(selectedID, (id) => {
      if (!id) return
      void serverSync().session.sync(id, { messageLimit: 50 }).catch(() => undefined)
    }),
  )

  createEffect(() => {
    const id = selectedID()
    if (!id) return
    if (!subagents.items().some((item) => item.session.id === id)) setSelectedID(undefined)
  })

  const parts = (messageID: string) => (serverSync().session.data.part[messageID] ?? []) as Part[]

  return (
    <Show
      when={selected()}
      fallback={
        <ScrollView class="h-full">
          <div class="px-4 py-4 flex flex-col gap-3">
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="text-14-medium text-text-strong">
                  {localeText(locale(), "Subagentes", "Subagents")}
                </div>
                <div class="text-11-regular text-text-weak">
                  {subagents.items().length} · {usd(locale(), subagents.totalCost())} · {compactNumber(locale(), subagents.totalTokens())} tokens
                </div>
              </div>
              <button
                type="button"
                class="text-11-regular text-text-weak hover:text-text-base"
                onClick={() => void subagents.refresh()}
              >
                {localeText(locale(), "Atualizar", "Refresh")}
              </button>
            </div>

            <Show when={subagents.loading() && subagents.items().length === 0}>
              <div class="py-10 text-center text-12-regular text-text-weak">
                {localeText(locale(), "Carregando sessões…", "Loading sessions…")}
              </div>
            </Show>

            <Show when={!subagents.loading() && subagents.items().length === 0}>
              <div class="py-10 text-center text-12-regular text-text-weak">
                {localeText(locale(), "Nenhum subagente nesta sessão.", "No subagents in this session.")}
              </div>
            </Show>

            <For each={subagents.items()}>
              {(item) => (
                <button
                  type="button"
                  class="w-full rounded-md border border-border-base bg-surface-base px-3 py-2.5 text-left hover:bg-surface-raised-base"
                  style={{ "margin-left": `${Math.min(item.depth, 4) * 14}px`, width: `calc(100% - ${Math.min(item.depth, 4) * 14}px)` }}
                  onClick={() => setSelectedID(item.session.id)}
                >
                  <div class="flex items-center gap-2">
                    <span class="text-12-medium text-text-strong truncate">
                      {item.session.agent ?? item.session.title}
                    </span>
                    <span class="ml-auto shrink-0 text-11-regular text-text-weak">
                      {statusLabel(locale(), item.status)}
                    </span>
                  </div>
                  <div class="mt-1 flex items-center gap-2 text-11-regular text-text-weak">
                    <span class="truncate">{sessionModelLabel(item.session)}</span>
                    <span>•</span>
                    <span>{compactNumber(locale(), item.tokens)} tok</span>
                    <span>•</span>
                    <span>{usd(locale(), item.session.cost ?? 0)}</span>
                  </div>
                </button>
              )}
            </For>
          </div>
        </ScrollView>
      }
    >
      {(session) => (
        <div class="h-full min-h-0 flex flex-col">
          <div class="shrink-0 border-b border-border-weaker-base px-4 py-3">
            <button
              type="button"
              class="mb-2 flex items-center gap-1 text-11-regular text-text-weak hover:text-text-base"
              onClick={() => setSelectedID(undefined)}
            >
              <span aria-hidden>‹</span>
              {localeText(locale(), "Todos os subagentes", "All subagents")}
            </button>
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="truncate text-14-medium text-text-strong">
                  {session().agent ?? session().title}
                </div>
                <div class="truncate text-11-regular text-text-weak">
                  {sessionModelLabel(session())}
                </div>
              </div>
              <div class="shrink-0 text-right text-11-regular text-text-weak">
                <div>{usd(locale(), session().cost ?? 0)}</div>
                <div>{compactNumber(locale(), session().tokens ? session().tokens!.input + session().tokens!.output + session().tokens!.reasoning + session().tokens!.cache.read + session().tokens!.cache.write : 0)} tok</div>
              </div>
            </div>
          </div>
          <ScrollView class="flex-1 min-h-0">
            <div class="px-4 py-4 flex flex-col gap-4">
              <Show when={selectedMessages().length > 0} fallback={
                <div class="py-10 text-center text-12-regular text-text-weak">
                  {localeText(locale(), "Carregando atividade…", "Loading activity…")}
                </div>
              }>
                <For each={selectedMessages()}>
                  {(message) => <MessageView message={message} parts={parts(message.id)} />}
                </For>
              </Show>
            </div>
          </ScrollView>
        </div>
      )}
    </Show>
  )
}
