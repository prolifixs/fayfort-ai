import { FormEvent, useCallback, useEffect, useState } from "react";
import { ApiRequestError, apiRequest } from "../../lib/api";
import { FayfortLoader } from "../brand/FayfortLogo";

/** Control Center → Website → FayFort AI chat on www.fayfort.com: switch, limits and what visitors ask (read only). */

type ChatSettings = { enabled: boolean; visitor_daily_limit: number; network_daily_limit: number; daily_reply_cap: number };
type VisitorChat = {
  id: string;
  first_page: string | null;
  first_message: string;
  message_count: number;
  joined: boolean;
  created_at: string;
  last_activity_at: string;
};
type Overview = { settings: ChatSettings; today: { replies: number; conversations: number }; conversations: VisitorChat[] };
type ChatMessage = { id: string; sender_type: "visitor" | "assistant"; content: string; created_at: string };

const when = (value: string) =>
  new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function WebsiteChatSection({ accessToken }: { accessToken: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [form, setForm] = useState<ChatSettings | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [thread, setThread] = useState<ChatMessage[] | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await apiRequest<Overview>("/platform/site/chat", accessToken);
      if (!next?.settings) throw new Error("Website chats could not be loaded.");
      setData(next);
      setForm(next.settings);
      setError("");
    } catch (reason) {
      setError(
        reason instanceof ApiRequestError && reason.status === 404
          ? "The API server is still running the previous version, so the website chat isn't available yet."
          : reason instanceof Error
            ? reason.message
            : "Website chats could not be loaded.",
      );
    }
  }, [accessToken]);
  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await apiRequest("/platform/site/chat/settings", accessToken, { method: "PUT", body: JSON.stringify(form) });
      setNotice(form.enabled ? "Saved. FayFort AI is on for website visitors." : "Saved. The website chat is switched off.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setThread(null);
    try {
      setThread((await apiRequest<{ messages: ChatMessage[] }>(`/platform/site/chat/${id}`, accessToken)).messages);
    } catch {
      setThread([]);
    }
  }

  const number = (key: keyof Omit<ChatSettings, "enabled">) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => (current ? { ...current, [key]: Number(event.target.value) } : current));

  return (
    <section className="control-panel" aria-label="FayFort AI on the website">
      <div className="panel-heading">
        <h2>FayFort AI on the website</h2>
        <p>
          The chat button on every page of www.fayfort.com (not LANDED). It answers from Knowledge, points visitors to Join free for
          requests and the team, and the conversation moves into their member chat when they join.
        </p>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="email-delivery ok" role="status">
          {notice}
        </p>
      )}
      {!data || !form ? (
        !error && <FayfortLoader label="Loading website chats…" />
      ) : (
        <>
          <p className={form.enabled ? "email-delivery ok" : "email-delivery off"}>
            {data.settings.enabled ? "On" : "Off"} · today {data.today.conversations} new chats, {data.today.replies} replies
            {" "}(daily cap {data.settings.daily_reply_cap})
          </p>
          <form className="site-chat-settings" onSubmit={save} aria-label="Website chat settings">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
              />
              Show FayFort AI on the website
            </label>
            <label>
              Messages per visitor per day
              <input type="number" min={1} max={200} value={form.visitor_daily_limit} onChange={number("visitor_daily_limit")} />
            </label>
            <label>
              Messages per network per day
              <input type="number" min={1} max={1000} value={form.network_daily_limit} onChange={number("network_daily_limit")} />
            </label>
            <label>
              AI replies per day, whole site
              <input type="number" min={1} max={20000} value={form.daily_reply_cap} onChange={number("daily_reply_cap")} />
            </label>
            <button className="primary-button" disabled={saving}>
              {saving ? "Saving…" : "Save chat settings"}
            </button>
          </form>
          <h3 className="site-chat-heading">Recent visitor chats</h3>
          {!data.conversations.length ? (
            <p className="muted">No website chats yet.</p>
          ) : (
            <ul className="site-chat-list">
              {data.conversations.map((chat) => (
                <li key={chat.id}>
                  <button type="button" className="site-chat-row" aria-expanded={openId === chat.id} onClick={() => void toggle(chat.id)}>
                    <span>
                      <strong>{chat.first_message || "(no message)"}</strong>
                      <small>
                        {when(chat.last_activity_at)} · {chat.message_count} messages{chat.first_page ? ` · started on ${chat.first_page}` : ""}
                      </small>
                    </span>
                    {chat.joined && <span className="status-pill is-good">Joined</span>}
                  </button>
                  {openId === chat.id && (
                    <div className="site-chat-thread">
                      {!thread ? (
                        <FayfortLoader size="sm" label="Loading chat…" />
                      ) : (
                        thread.map((message) => (
                          <p key={message.id} className={message.sender_type === "visitor" ? "from-visitor" : "from-ai"}>
                            <b>{message.sender_type === "visitor" ? "Visitor" : "FayFort AI"}</b> {message.content}
                          </p>
                        ))
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
