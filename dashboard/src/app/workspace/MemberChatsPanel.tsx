import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import { StaffChatThread, fromMemberMessage } from "../staff/StaffChatThread";
import { FayfortLoader } from "../brand/FayfortLogo";

/** Conversations → Member app: every chat from the FayFort member app, readable, and one click to take one over
 * (it opens in the Operations Center with the reply box). docs/OPERATIONS_FIXES_PLAN.md §2.12. */
type MemberChat = {
  id: string;
  title: string;
  member_name: string;
  last_activity_at: string | null;
  last_message: { sender_type: string; content: string; created_at: string };
  handled_by: "ai" | "waiting" | "staff";
  work_item_id: string | null;
  linked_request_id: string | null;
};
type Message = { id: string; sender_type: "member" | "assistant" | "worker"; content: string; created_at: string };

const HANDLED: Record<MemberChat["handled_by"], string> = { ai: "AI answering", waiting: "With the team", staff: "A person has it" };

export function MemberChatsPanel({ accessToken }: { accessToken: string }) {
  const [chats, setChats] = useState<MemberChat[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<MemberChat | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const q = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
      const data = await apiRequest<{ chats: MemberChat[] }>(`/operations/member-chats${q}`, accessToken);
      setChats(data.chats || []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Member chats could not be loaded.");
      setChats([]);
    }
  }, [accessToken, query]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), query ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [load, query]);

  async function open(chat: MemberChat) {
    setSelected(chat);
    setMessages(null);
    try {
      const data = await apiRequest<{ messages: Message[] }>(`/operations/member-chats/${chat.id}`, accessToken);
      setMessages(data.messages || []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The chat could not be opened.");
    }
  }

  async function takeOver(chat: MemberChat) {
    setBusy(true);
    setError("");
    try {
      const data = await apiRequest<{ work_item_id: string }>(`/operations/member-chats/${chat.id}/take-over`, accessToken, { method: "POST" });
      window.location.assign(`/operations?workItem=${data.work_item_id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The chat could not be taken over.");
      setBusy(false);
    }
  }

  return (
    <div className={`member-chats${selected ? " has-selection" : ""}`}>
      <div className="member-chats-list">
        <label className="member-chats-search">
          Search chats
          <input type="search" value={query} placeholder="Chat title" onChange={(event) => setQuery(event.target.value)} />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {chats === null ? (
          <FayfortLoader label="Loading member chats…" />
        ) : chats.length === 0 ? (
          <p className="empty-copy">No member chats{query ? " match" : " yet"}.</p>
        ) : (
          <ul aria-label="Member chats">
            {chats.map((chat) => (
              <li key={chat.id}>
                <button type="button" className={selected?.id === chat.id ? "is-selected" : ""} onClick={() => void open(chat)}>
                  <span className="member-chats-row-top">
                    <strong>{chat.member_name}</strong>
                    <em className={`member-chats-state is-${chat.handled_by}`}>{HANDLED[chat.handled_by]}</em>
                  </span>
                  <span className="member-chats-title">{chat.title}</span>
                  <small>
                    {chat.last_message.sender_type === "member" ? "" : chat.last_message.sender_type === "worker" ? "Staff: " : "AI: "}
                    {chat.last_message.content.slice(0, 120)}
                  </small>
                  <small>{new Date(chat.last_message.created_at).toLocaleString()}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {selected && (
        <section className="member-chats-thread" aria-label={`Chat with ${selected.member_name}`}>
          <header>
            <div>
              <strong>{selected.member_name}</strong>
              <small>{selected.title}</small>
            </div>
            <button type="button" className="text-button" onClick={() => setSelected(null)}>
              ← All member chats
            </button>
          </header>
          {selected.linked_request_id ? (
            <p className="operations-muted">This chat belongs to a sourcing request; work it from that request in the Operations Center.</p>
          ) : selected.handled_by === "staff" && selected.work_item_id ? (
            <p className="member-chats-cta">
              A person has this chat.{" "}
              <a className="secondary-button" href={`/operations?workItem=${selected.work_item_id}`}>
                Open in the Operations Center
              </a>
            </p>
          ) : (
            <p className="member-chats-cta">
              {selected.handled_by === "ai" ? "The AI is answering this member." : "This chat is waiting for the team."}{" "}
              <button type="button" className="primary-button" disabled={busy} onClick={() => void takeOver(selected)}>
                {busy ? "Taking over…" : "Take over and reply"}
              </button>
            </p>
          )}
          {messages === null ? (
            <FayfortLoader label="Loading the chat…" />
          ) : (
            <StaffChatThread label="Member chat messages" messages={messages.map(fromMemberMessage)} />
          )}
        </section>
      )}
    </div>
  );
}
