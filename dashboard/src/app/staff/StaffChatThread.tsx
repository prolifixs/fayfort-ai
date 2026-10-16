import { useEffect, useRef, type FormEvent, type ReactNode } from "react";

/** One message in a staff chat thread. "them" is the customer or member; "us" is FayFort (AI or staff). */
export type ThreadMessage = {
  id: string;
  side: "them" | "us" | "system";
  author: string;
  kind: "customer" | "member" | "ai" | "staff" | "system";
  content: string;
  created_at: string;
  meta?: ReactNode;
  action?: ReactNode;
};

/** Business channel messages use customer / ai / agent / system. */
export function fromBusinessMessage<T extends { id: string; sender_type: string; content: string; created_at: string }>(
  message: T,
  extra: Partial<ThreadMessage> = {},
): ThreadMessage {
  const type = message.sender_type;
  const base = { id: message.id, content: message.content, created_at: message.created_at };
  if (type === "ai" || type === "assistant") return { ...base, side: "us", author: "AI assistant", kind: "ai", ...extra };
  if (type === "agent" || type === "human_agent" || type === "worker")
    return { ...base, side: "us", author: "FayFort staff", kind: "staff", ...extra };
  if (type === "system") return { ...base, side: "system", author: "System", kind: "system", ...extra };
  return { ...base, side: "them", author: "Customer", kind: "customer", ...extra };
}

/** Member chat messages use member / assistant / worker. */
export function fromMemberMessage<T extends { id: string; sender_type: string; content: string; created_at: string }>(
  message: T,
): ThreadMessage {
  const base = { id: message.id, content: message.content, created_at: message.created_at };
  if (message.sender_type === "assistant") return { ...base, side: "us", author: "AI assistant", kind: "ai" };
  if (message.sender_type === "worker") return { ...base, side: "us", author: "FayFort staff", kind: "staff" };
  return { ...base, side: "them", author: "Member", kind: "member" };
}

export type ThreadComposer = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  busy?: boolean;
  placeholder?: string;
  note?: ReactNode;
  sendLabel?: string;
  id?: string;
};

function dayLabel(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
function timeLabel(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * The one chat view used by Conversations, Human Agents and the Operations Center: customer or member on the
 * left, FayFort (AI and staff) on the right, newest message in view, reply box docked at the bottom.
 */
export function StaffChatThread({
  messages,
  label,
  emptyText = "No messages in this conversation yet.",
  composer,
  footer,
  className = "",
}: {
  messages: ThreadMessage[];
  label: string;
  emptyText?: string;
  composer?: ThreadComposer | null;
  footer?: ReactNode;
  className?: string;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length]);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 180)}px`;
  }, [composer?.value]);
  let lastDay = "";
  return (
    <section className={`staff-thread ${className}`.trim()} aria-label={label}>
      {messages.length === 0 ? (
        <p className="staff-thread-empty">{emptyText}</p>
      ) : (
        <ol className="staff-thread-messages" ref={listRef}>
          {messages.map((message) => {
            const day = dayLabel(message.created_at);
            const separator = day && day !== lastDay;
            lastDay = day || lastDay;
            return (
              <li key={message.id} className={`staff-thread-row is-${message.side} kind-${message.kind}`}>
                {separator && <span className="staff-thread-day">{day}</span>}
                {message.side === "system" ? (
                  <p className="staff-thread-system">{message.content}</p>
                ) : (
                  <div className="staff-thread-bubble">
                    <strong>{message.author}</strong>
                    <p>{message.content}</p>
                  </div>
                )}
                <small className="staff-thread-meta">
                  <time dateTime={message.created_at}>{timeLabel(message.created_at)}</time>
                  {message.meta}
                </small>
                {message.action}
              </li>
            );
          })}
        </ol>
      )}
      {composer && (
        <form className="staff-thread-composer" onSubmit={composer.onSubmit}>
          <label className="sr-only" htmlFor={composer.id || "staff-thread-reply"}>
            {composer.label}
          </label>
          <textarea
            id={composer.id || "staff-thread-reply"}
            ref={boxRef}
            rows={1}
            maxLength={4000}
            value={composer.value}
            placeholder={composer.placeholder || "Write a reply…"}
            onChange={(event) => composer.onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (composer.value.trim() && !composer.busy) event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button
            className="staff-thread-send"
            aria-label={composer.sendLabel || "Send reply"}
            title={composer.sendLabel || "Send reply"}
            disabled={composer.busy || !composer.value.trim()}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M12 19V5m-6 6 6-6 6 6" />
            </svg>
          </button>
          {composer.note && <small className="staff-thread-note">{composer.note}</small>}
        </form>
      )}
      {footer}
    </section>
  );
}
