import { playMemberSound } from "../memberSound";
import { MemberNotificationsBar } from "../MemberNotifications";
import { dashboardAuthConfigured, supabaseClient } from "../../lib/supabase";
import { ApiRequestError, apiRequest } from "../../lib/api";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type {
  MemberCatalog,
  MemberCatalogProduct,
  MemberChat,
  MemberChatMessage,
  MemberOwnedRequest,
} from "./memberShared";
import { SetupScreen } from "../SetupScreen";
import { requestProgressIndex, requestProgressStages, requestStageLabels } from "../requests/requestShared";
import type { ProductCategory } from "../workspace/types";
import { MemberRequestsPanel } from "./MemberRequestsPanel";
import { ProductMediaPreview } from "../workspace/DirectoryPages";
import type { Cart, FindItResult, Giveaway, ShopCard, ShopHome, TrendCard } from "./commerceApi";
import { shopSessionId, trackIntent } from "./commerceApi";
import { FindItBlock, HotRails, ProductTile } from "./ShopComponents";
import { BrowsePanel, CartButton, OrdersPanel, ProductPanel } from "./ShopPanels";

type MemberPanel = "chat" | "catalog" | "saved" | "requests" | "product";
const memberPanels: MemberPanel[] = ["catalog", "saved", "requests", "product"];
function panelFromUrl(): MemberPanel {
  const panel = new URLSearchParams(window.location.search).get("panel") as MemberPanel | null;
  return panel && memberPanels.includes(panel) ? panel : "chat";
}
/** Android "Share to FayFort" (web share target) and links into the chat prefill the composer. */
function sharedText(): string {
  if (window.location.pathname !== "/member/share") return "";
  const params = new URLSearchParams(window.location.search);
  return [params.get("text"), params.get("url")]
    .filter((value): value is string => !!value && !!value.trim())
    .filter((value, index, all) => all.indexOf(value) === index)
    .join(" ")
    .slice(0, 2000);
}

export function MemberChatPage() {
  const [token, setToken] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [chats, setChats] = useState<MemberChat[]>([]);
  const [activeChat, setActiveChat] = useState<MemberChat | null>(null);
  const [messages, setMessages] = useState<MemberChatMessage[]>([]);
  const [products, setProducts] = useState<MemberCatalogProduct[]>([]);
  const [requests, setRequests] = useState<MemberOwnedRequest[]>([]);
  const [selectedRequest, setSelectedRequest] = useState("");
  const [draft, setDraft] = useState(() => sharedText());
  const [home, setHome] = useState<ShopHome | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [productId, setProductId] = useState(() => new URLSearchParams(window.location.search).get("product") || "");
  const [shopBusyId, setShopBusyId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deletingChatId, setDeletingChatId] = useState("");
  const [chatMenuId, setChatMenuId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [requestTitle, setRequestTitle] = useState("");
  const [requestDetails, setRequestDetails] = useState("");
  const [requestProduct, setRequestProduct] = useState<MemberCatalogProduct | null>(null);
  const [requestSourceType, setRequestSourceType] = useState<
    "description" | "saved_product" | "catalog_product" | "url" | "image"
  >("description");
  const [requestSourceUrl, setRequestSourceUrl] = useState("");
  const [requestSourceFile, setRequestSourceFile] = useState<File | null>(null);
  const [requestSourceChoices, setRequestSourceChoices] = useState<MemberCatalogProduct[]>([]);
  const [requestSavedChoices, setRequestSavedChoices] = useState<MemberCatalogProduct[]>([]);
  const [requestChoicesLoading, setRequestChoicesLoading] = useState(false);
  const [requestFormOpen, setRequestFormOpen] = useState(false);
  const [requestBusy, setRequestBusy] = useState(false);
  const [photoReviewOpen, setPhotoReviewOpen] = useState(false);
  const [linkRequestOpen, setLinkRequestOpen] = useState(false);
  const [requestProgressOpen, setRequestProgressOpen] = useState(false);
  const [requestProgressBusy, setRequestProgressBusy] = useState(false);
  const [progressRequest, setProgressRequest] = useState<MemberOwnedRequest | null>(null);
  const seenMessageIds = useRef<Set<string>>(new Set());
  const [activePanel, setActivePanel] = useState<MemberPanel>(() =>
    panelFromUrl() === "product" && !new URLSearchParams(window.location.search).get("product") ? "chat" : panelFromUrl(),
  );
  const [chatExpanded, setChatExpanded] = useState(() => panelFromUrl() === "product");
  function selectMemberPanel(panel: MemberPanel) {
    setActivePanel(panel);
    setChatExpanded(false);
    const url = panel === "chat" ? "/member/chat" : `/member/chat?panel=${panel}`;
    window.history.pushState({ memberPanel: panel }, "", url);
  }
  /** Product pages open beside the chat, so the member can keep asking about the item. */
  function openProduct(card: ShopCard | { id: string }) {
    setProductId(card.id);
    setActivePanel("product");
    setChatExpanded(true);
    window.history.pushState({ memberPanel: "product" }, "", `/member/chat?panel=product&product=${encodeURIComponent(card.id)}`);
  }
  useEffect(() => {
    if (window.location.pathname === "/member/share") window.history.replaceState({}, "", "/member/chat");
    const onPopState = () => {
      const panel = panelFromUrl();
      setProductId(new URLSearchParams(window.location.search).get("product") || "");
      setActivePanel(panel);
      setChatExpanded(panel === "product");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const loadShop = useCallback(async (accessToken: string) => {
    try {
      const [shop, currentCart] = await Promise.all([
        apiRequest<ShopHome>("/members/shop/home", accessToken),
        apiRequest<Cart>("/members/cart", accessToken),
      ]);
      setHome(shop && Array.isArray(shop.rails) ? shop : null);
      setCart(currentCart && Array.isArray(currentCart.lines) ? currentCart : null);
    } catch {
      /* The shop is optional around the chat; the chat keeps working without it. */
    }
  }, []);
  async function wantTrend(trend: TrendCard) {
    if (!token || shopBusyId) return;
    setShopBusyId(trend.id);
    setError("");
    try {
      const result = await apiRequest<{ request_id: string | null; want_count: number }>(
        `/members/find-it/${trend.id}/want`,
        token,
        { method: "POST", body: JSON.stringify({ session_id: shopSessionId() }) },
      );
      setMessages((current) =>
        current.map((message) =>
          message.find_it?.link?.id === trend.id
            ? {
                ...message,
                find_it: {
                  ...message.find_it,
                  link: { ...message.find_it.link, member_wants: true, want_count: result.want_count },
                },
              }
            : message,
        ),
      );
      setNotice("FayFort will source it for you. Follow it in Orders & requests.");
      await Promise.all([loadRequests(token), loadShop(token)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We couldn't start sourcing this item.");
    } finally {
      setShopBusyId("");
    }
  }
  async function enterGiveaway(giveaway: Giveaway) {
    if (!token || shopBusyId) return;
    setShopBusyId(giveaway.id);
    setError("");
    try {
      await apiRequest(`/members/giveaways/${giveaway.id}/enter`, token, { method: "POST" });
      setHome((current) =>
        current
          ? { ...current, giveaways: current.giveaways.map((item) => (item.id === giveaway.id ? { ...item, entered: true } : item)) }
          : current,
      );
      setNotice("You're entered. Good luck!");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your entry could not be saved.");
    } finally {
      setShopBusyId("");
    }
  }
  async function pasteLink() {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) setDraft((current) => (current.trim() ? `${current.trim()} ${text.trim()}` : text.trim()).slice(0, 4000));
    } catch {
      setNotice("Paste the link into the message box (long-press, then Paste).");
    }
  }
  const loadChats = useCallback(async (accessToken: string) => {
    const result = await apiRequest<{ conversations: MemberChat[] }>("/members/conversations", accessToken);
    setChats(result.conversations || []);
    return result.conversations || [];
  }, []);
  const loadRequests = useCallback(async (accessToken: string) => {
    const result = await apiRequest<{ requests: MemberOwnedRequest[] }>("/members/requests", accessToken);
    setRequests(result.requests || []);
  }, []);
  async function showRequestProgress() {
    if (!token || !activeChat?.retention_hold) return;
    setRequestProgressBusy(true);
    setError("");
    try {
      const result = await apiRequest<{ requests: MemberOwnedRequest[] }>("/members/requests", token);
      const rows = result.requests || [];
      setRequests(rows);
      const match = rows.find(
        (request) => request.id === activeChat.linked_request_id || request.conversation_id === activeChat.id,
      );
      if (!match) throw new Error("The linked request could not be found for this chat.");
      setProgressRequest(match);
      setRequestProgressOpen(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Request progress could not be loaded.");
    } finally {
      setRequestProgressBusy(false);
    }
  }
  async function requestStaffSupport() {
    if (!token || !activeChat || activeChat.retention_hold || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await apiRequest<{ work_item_id: string; status: string }>(
        `/members/conversations/${activeChat.id}/request-support`,
        token,
        { method: "POST" },
      );
      const updated = { ...activeChat, support_work_item_id: result.work_item_id, support_status: result.status };
      setActiveChat(updated);
      setChats((current) => current.map((chat) => (chat.id === updated.id ? updated : chat)));
      setNotice("Your chat is in the staff support queue.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Staff support could not be requested.");
    } finally {
      setBusy(false);
    }
  }
  const openChat = useCallback(async (accessToken: string, chat: MemberChat) => {
    setActiveChat(chat);
    setProducts([]);
    const result = await apiRequest<{ messages: MemberChatMessage[]; products: MemberCatalogProduct[] }>(
      `/members/conversations/${chat.id}/messages`,
      accessToken,
    );
    setMessages(result.messages || []);
    seenMessageIds.current = new Set((result.messages || []).map((message) => message.id));
    setProducts(result.products || []);
  }, []);
  const openRequestedChat = useCallback(
    async (accessToken: string, rows: MemberChat[]) => {
      const requestedId = new URLSearchParams(window.location.search).get("conversation");
      const selected = rows.find((chat) => chat.id === requestedId) || rows[0];
      if (selected) await openChat(accessToken, selected);
    },
    [openChat],
  );
  useEffect(() => {
    if (!token || !activeChat) return;
    let mounted = true;
    const refresh = async () => {
      try {
        const result = await apiRequest<{ messages: MemberChatMessage[]; products: MemberCatalogProduct[] }>(
          `/members/conversations/${activeChat.id}/messages`,
          token,
        );
        if (!mounted) return;
        const incoming = (result.messages || []).some(
          (message) => message.sender_type !== "member" && !seenMessageIds.current.has(message.id),
        );
        if (incoming) playMemberSound();
        seenMessageIds.current = new Set((result.messages || []).map((message) => message.id));
        setMessages(result.messages || []);
        setProducts(result.products || []);
      } catch {
        /* Keep the current chat visible; the next refresh can retry. */
      }
    };
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [token, activeChat?.id]);
  useEffect(() => {
    if (!retryAt) {
      setCooldownSeconds(0);
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      setCooldownSeconds(remaining);
      if (remaining === 0) setRetryAt(null);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);
  useEffect(() => {
    if (!supabaseClient) {
      setAuthLoading(false);
      return;
    }
    let mounted = true;
    supabaseClient.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      const accessToken = data.session?.access_token || null;
      setToken(accessToken);
      setAuthLoading(false);
      if (!accessToken) return;
      try {
        const me = await apiRequest<{ profile: Record<string, unknown> }>("/members/me", accessToken);
        if (!mounted) return;
        setProfile(me.profile);
        setVerified(true);
        const rows = await loadChats(accessToken);
        await loadRequests(accessToken);
        await openRequestedChat(accessToken, rows);
        void loadShop(accessToken);
      } catch (reason) {
        if (mounted) setError(reason instanceof Error ? reason.message : "Member chat could not be loaded.");
      }
    });
    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((event, session) => {
      if (!mounted || event === "INITIAL_SESSION") return;
      const accessToken = session?.access_token || null;
      setToken(accessToken);
      setVerified(false);
      setProfile(null);
      setChats([]);
      setActiveChat(null);
      setMessages([]);
      setProducts([]);
      setRequests([]);
      if (accessToken) {
        apiRequest<{ profile: Record<string, unknown> }>("/members/me", accessToken)
          .then(async (me) => {
            if (!mounted) return;
            setProfile(me.profile);
            setVerified(true);
            const rows = await loadChats(accessToken);
            await loadRequests(accessToken);
            await openRequestedChat(accessToken, rows);
            void loadShop(accessToken);
          })
          .catch((reason) => {
            if (mounted) setError(reason instanceof Error ? reason.message : "Verify your email to use member chat.");
          });
      }
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadChats, loadRequests, openRequestedChat, loadShop]);
  async function createChat() {
    if (!token || busy || loading) return;
    setActivePanel("chat");
    setChatExpanded(false);
    if (activeChat && messages.length === 0) return;
    if (!activeChat && chats.length) {
      await chooseChat(chats[0]);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<{ conversation: MemberChat }>("/members/conversations", token, {
        method: "POST",
      });
      setChats((current) => [result.conversation, ...current]);
      setActiveChat(result.conversation);
      setMessages([]);
      setProducts([]);
      setNotice("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "A new chat could not be started.");
    } finally {
      setBusy(false);
    }
  }
  async function chooseChat(chat: MemberChat) {
    if (!token) return;
    setActivePanel("chat");
    setChatExpanded(false);
    setChatMenuId("");
    setLoading(true);
    setError("");
    try {
      await openChat(token, chat);
      setNotice("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Chat could not be opened.");
    } finally {
      setLoading(false);
    }
  }
  async function deleteChat(chat: MemberChat) {
    if (!token || deletingChatId) return;
    if (chat.retention_hold || chat.linked_request_id) {
      setError("This chat is retained with its sourcing request and cannot be deleted here.");
      setChatMenuId("");
      return;
    }
    if (!window.confirm("Delete this chat and its messages? This cannot be undone.")) return;
    setDeletingChatId(chat.id);
    setError("");
    setChatMenuId("");
    try {
      await apiRequest("/members/conversations/" + chat.id, token, { method: "DELETE" });
      const remaining = chats.filter((item) => item.id !== chat.id);
      setChats(remaining);
      if (activeChat?.id === chat.id) {
        setActiveChat(null);
        setMessages([]);
        setProducts([]);
        if (remaining[0]) await openChat(token, remaining[0]);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This chat could not be deleted.");
    } finally {
      setDeletingChatId("");
    }
  }
  async function linkRequest() {
    if (!token || !activeChat || !selectedRequest) return;
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/members/conversations/${activeChat.id}/retention-hold`, token, {
        method: "POST",
        body: JSON.stringify({ request_id: selectedRequest }),
      });
      const updated = { ...activeChat, linked_request_id: selectedRequest, retention_hold: true };
      setActiveChat(updated);
      setChats((current) => current.map((chat) => (chat.id === updated.id ? updated : chat)));
      setNotice("This chat is retained with your sourcing request. It is now read-only.");
      setLinkRequestOpen(false);
      setSelectedRequest("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The chat could not be linked to this request.");
    } finally {
      setBusy(false);
    }
  }
  async function beginRequest(product: MemberCatalogProduct | null = null, title = "") {
    setRequestProduct(product);
    setRequestTitle(product?.name || title.slice(0, 160));
    setRequestDetails("");
    setRequestSourceType(product ? "catalog_product" : "description");
    setRequestSourceUrl("");
    setRequestSourceFile(null);
    setRequestFormOpen(true);
    setError("");
    if (token) {
      setRequestChoicesLoading(true);
      try {
        const [all, saved] = await Promise.all([
          apiRequest<MemberCatalog>("/members/products", token),
          apiRequest<MemberCatalog>("/members/products?saved_only=true", token),
        ]);
        setRequestSourceChoices(all.products || []);
        setRequestSavedChoices(saved.products || []);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Product choices could not be loaded.");
      } finally {
        setRequestChoicesLoading(false);
      }
    }
  }
  async function submitRequest(event: FormEvent) {
    event.preventDefault();
    if (!token || !activeChat || !requestTitle.trim() || requestBusy) return;
    setRequestBusy(true);
    setError("");
    setNotice("");
    try {
      let result: { request_id: string; stage: string };
      if (requestSourceType === "image") {
        if (!requestSourceFile) throw new Error("Choose a product screenshot first.");
        if (requestSourceFile.size > 10 * 1024 * 1024) throw new Error("Screenshots must be 10 MiB or smaller.");
        const params = new URLSearchParams({
          request_title: requestTitle.trim(),
          filename: requestSourceFile.name,
          conversation_id: activeChat.id,
        });
        if (requestDetails.trim()) params.set("request_description", requestDetails.trim());
        result = await apiRequest<{ request_id: string; stage: string }>(`/members/requests/image?${params}`, token, {
          method: "POST",
          body: requestSourceFile,
          headers: { "Content-Type": requestSourceFile.type },
        });
      } else {
        result = await apiRequest<{ request_id: string; stage: string }>("/members/requests", token, {
          method: "POST",
          body: JSON.stringify({
            request_title: requestTitle.trim(),
            request_description: requestDetails.trim() || null,
            source_type: requestSourceType,
            source_url: requestSourceType === "url" ? requestSourceUrl.trim() : null,
            product_id:
              requestSourceType === "saved_product" || requestSourceType === "catalog_product"
                ? requestProduct?.id || null
                : null,
            conversation_id: activeChat.id,
          }),
        });
      }
      const updated = { ...activeChat, linked_request_id: result.request_id, retention_hold: true };
      setActiveChat(updated);
      setChats((current) => [updated, ...current.filter((chat) => chat.id !== updated.id)]);
      await loadRequests(token);
      setRequestTitle("");
      setRequestDetails("");
      setRequestProduct(null);
      setRequestSourceFile(null);
      setRequestFormOpen(false);
      setNotice("Your sourcing request was submitted. Follow progress in Orders & requests.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your sourcing request could not be submitted.");
    } finally {
      setRequestBusy(false);
    }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!token || !activeChat || !draft.trim() || busy || cooldownSeconds > 0) return;
    const content = draft.trim();
    setBusy(true);
    setError("");
    setNotice("");
    setDraft("");
    try {
      const result = await apiRequest<{
        member_message: MemberChatMessage;
        assistant_message: MemberChatMessage;
        products: MemberCatalogProduct[];
        find_it?: FindItResult | null;
      }>(`/members/conversations/${activeChat.id}/messages`, token, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      seenMessageIds.current = new Set([
        ...seenMessageIds.current,
        result.member_message.id,
        result.assistant_message.id,
      ]);
      const assistant = result.find_it ? { ...result.assistant_message, find_it: result.find_it } : result.assistant_message;
      setMessages((current) => [...current, result.member_message, assistant]);
      if (result.find_it?.link) void loadShop(token);
      playMemberSound();
      setProducts(result.products || []);
      setRetryAt(null);
      const updated = {
        ...activeChat,
        title: activeChat.title === "New chat" ? content.slice(0, 120) : activeChat.title,
        last_activity_at: new Date().toISOString(),
      };
      setActiveChat(updated);
      setChats((current) => [updated, ...current.filter((chat) => chat.id !== updated.id)]);
    } catch (reason) {
      const saved =
        reason instanceof ApiRequestError &&
        reason.status === 503 &&
        reason.message.toLowerCase().includes("message was saved");
      if (saved) {
        void openChat(token, activeChat);
      } else setDraft(content);
      if (reason instanceof ApiRequestError && reason.retryAt) {
        const time = Date.parse(reason.retryAt);
        if (Number.isFinite(time)) setRetryAt(time);
      }
      setError(reason instanceof Error ? reason.message : "Message could not be sent.");
    } finally {
      setBusy(false);
    }
  }
  if (!dashboardAuthConfigured) return <SetupScreen />;
  return (
    <main className="auth-page member-chat-page">
      <section className="member-chat-shell">
        <header className="member-chat-header">
          <a className="brand-mark" href="/member/chat" aria-label="FayFort chat home">
            F
          </a>
          <div className="member-chat-heading">
            <small>FAYFORT MEMBER</small>
            <h1>Find what you need</h1>
          </div>
          {verified && token && (
            <div className="member-chat-header-actions">
              <MemberNotificationsBar accessToken={token} header />
              <CartButton accessToken={token} cart={cart} onCartChange={setCart} onOpen={openProduct} />
              <details className="member-account-menu">
                <summary className="member-account-icon" aria-label="Open member account menu" title="Member account">
                  {typeof profile?.profile_photo_url === "string" ? (
                    <img src={profile.profile_photo_url} alt="" />
                  ) : (
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                      <path
                        d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                  )}
                </summary>
                <div className="member-account-dropdown" role="menu">
                  <div className="member-account-dropdown-name">
                    <small>Member name</small>
                    <strong>
                      {typeof profile?.display_name === "string" && profile.display_name.trim()
                        ? profile.display_name.trim()
                        : "Member"}
                    </strong>
                  </div>
                  <a role="menuitem" href="/member/rewards?view=points">
                    <span>Virtual points</span>
                    <strong>{new Intl.NumberFormat().format(Number(profile?.points_balance ?? 0) || 0)}</strong>
                  </a>
                  <a role="menuitem" href="/member/rewards?view=tier">
                    <span>Member tier</span>
                    <strong>
                      Rank {Number(profile?.rank_level) || 1} · Subrank {Number(profile?.subrank) || 1}
                    </strong>
                  </a>
                  <a role="menuitem" href="/member/account">
                    Account details
                  </a>
                  <a role="menuitem" href="/member/settings">
                    Settings
                  </a>
                </div>
              </details>
            </div>
          )}
        </header>
        {authLoading ? (
          <p role="status">Checking your member sign-in…</p>
        ) : !token ? (
          <div className="member-chat-empty">
            <h2>Sign in to start a chat</h2>
            <p>Chat helps you explore active catalog products. You can browse the catalog without using AI chat.</p>
            <a className="primary-button" href="/member/account">
              Member sign in
            </a>
          </div>
        ) : !verified ? (
          <p role="status">{error || "Checking verified member access…"}</p>
        ) : (
          <div className="member-chat-layout">
            <aside className="member-chat-list" aria-label="Chats and member navigation">
              <section className="member-chat-history">
                <button className="primary-button" onClick={() => void createChat()} disabled={busy}>
                  New chat
                </button>
                {chats.length === 0 ? (
                  <p>Your chats will appear here.</p>
                ) : (
                  chats.map((chat) => (
                    <div
                      className={activeChat?.id === chat.id ? "member-chat-row active" : "member-chat-row"}
                      key={chat.id}
                    >
                      <button className="member-chat-list-item" onClick={() => void chooseChat(chat)}>
                        <strong>{chat.title}</strong>
                        <small>
                          {chat.retention_hold
                            ? "Request linked · retained"
                            : chat.support_status
                              ? `Staff support · ${chat.support_status.replaceAll("_", " ")}`
                              : "Member chat"}
                        </small>
                      </button>
                      <div className="member-chat-options">
                        <button
                          type="button"
                          className="member-chat-options-trigger"
                          aria-label={"Chat options for " + chat.title}
                          aria-haspopup="menu"
                          aria-expanded={chatMenuId === chat.id}
                          disabled={deletingChatId === chat.id}
                          onClick={() => setChatMenuId((current) => (current === chat.id ? "" : chat.id))}
                        >
                          ⋯
                        </button>
                        {chatMenuId === chat.id && (
                          <div className="member-chat-options-menu" role="menu">
                            <button
                              type="button"
                              role="menuitem"
                              disabled={!!chat.retention_hold || !!chat.linked_request_id || deletingChatId === chat.id}
                              title={
                                chat.retention_hold || chat.linked_request_id
                                  ? "Chats linked to a sourcing request are retained"
                                  : undefined
                              }
                              onClick={() => void deleteChat(chat)}
                            >
                              {deletingChatId === chat.id ? "Deleting…" : "Delete chat"}
                            </button>
                            {(chat.retention_hold || chat.linked_request_id) && (
                              <small>Retained with sourcing request</small>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </section>
              <nav className="member-chat-navigation" aria-label="Member navigation">
                <button
                  type="button"
                  className={activePanel === "catalog" ? "active" : ""}
                  aria-current={activePanel === "catalog" ? "page" : undefined}
                  onClick={() => selectMemberPanel("catalog")}
                >
                  Browse
                </button>
                <button
                  type="button"
                  className={activePanel === "saved" ? "active" : ""}
                  aria-current={activePanel === "saved" ? "page" : undefined}
                  onClick={() => selectMemberPanel("saved")}
                >
                  Saved products
                </button>
                <button
                  type="button"
                  className={activePanel === "requests" ? "active" : ""}
                  aria-current={activePanel === "requests" ? "page" : undefined}
                  onClick={() => selectMemberPanel("requests")}
                >
                  Orders & requests
                </button>
              </nav>
            </aside>
            <div
              className={
                activePanel !== "chat" && chatExpanded
                  ? "member-chat-workspace-content split"
                  : "member-chat-workspace-content"
              }
            >
              {activePanel === "catalog" && (
                <BrowsePanel
                  accessToken={token}
                  home={home}
                  onOpen={openProduct}
                  onWant={(trend) => void wantTrend(trend)}
                  onEnter={(giveaway) => void enterGiveaway(giveaway)}
                  busyId={shopBusyId}
                />
              )}
              {activePanel === "requests" && <OrdersPanel accessToken={token} />}
              {activePanel === "saved" && <MemberWorkspacePanel accessToken={token} mode="saved" />}
              {activePanel === "product" && productId && (
                <ProductPanel
                  accessToken={token}
                  productId={productId}
                  onOpen={openProduct}
                  onCartChange={setCart}
                  onClose={() => selectMemberPanel("chat")}
                />
              )}{" "}
              {(activePanel === "chat" || chatExpanded) && (
                <section className="member-chat-conversation" aria-label="Member product discovery chat">
                  <button
                    type="button"
                    className="member-chat-minimize"
                    aria-label="Minimize chat panel"
                    title="Minimize chat"
                    onClick={() => setChatExpanded(false)}
                  >
                    −
                  </button>
                  {activeChat?.retention_hold && (
                    <div className="member-chat-request-progress-trigger">
                      <button
                        type="button"
                        aria-label="View linked request progress"
                        title="View request progress"
                        disabled={requestProgressBusy}
                        onClick={() => void showRequestProgress()}
                      >
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                          <path d="M4 19V5m0 14h16M7 15l4-4 3 2 6-7" />
                          <circle cx="20" cy="6" r="1" />
                        </svg>
                        <span>{requestProgressBusy ? "Loading progress…" : "Request progress"}</span>
                      </button>
                    </div>
                  )}
                  {error && (
                    <p role="alert" className="form-error member-chat-error">
                      {error}
                    </p>
                  )}
                  {activeChat ? (
                    <>
                      <div className="member-chat-messages" aria-live="polite">
                        {messages.length === 0 && !loading && (
                          <div className="member-chat-welcome">
                            <h2>What are you looking for?</h2>
                            <p>
                              Describe a product, use, or category. I’ll help you explore active FayFort catalog
                              listings.
                            </p>
                            <a href="/member/chat?panel=catalog">Browse products directly</a>
                            {home && (
                              <HotRails
                                rails={home.rails.slice(0, 4)}
                                giveaways={home.giveaways}
                                onOpen={openProduct}
                                onWant={(trend) => void wantTrend(trend)}
                                onEnter={(giveaway) => void enterGiveaway(giveaway)}
                                busyId={shopBusyId}
                              />
                            )}
                          </div>
                        )}
                        {messages.map((message) => (
                          <article className={`member-chat-bubble ${message.sender_type}`} key={message.id}>
                            <small>
                              {message.sender_type === "member"
                                ? "You"
                                : message.sender_type === "worker"
                                  ? "FayFort human support"
                                  : "FayFort assistant"}
                            </small>
                            <p>{message.content}</p>
                            {message.find_it && (
                              <FindItBlock
                                result={message.find_it}
                                onOpen={openProduct}
                                onWant={(trend) => void wantTrend(trend)}
                                onRequest={(title) => void beginRequest(null, title)}
                                busy={!!shopBusyId}
                              />
                            )}
                          </article>
                        ))}
                        {busy && (
                          <p role="status" className="member-chat-loading">
                            Searching the catalog and preparing a reply…
                          </p>
                        )}
                        {products.length > 0 && (
                          <section className="member-chat-suggestions" aria-label="Catalog suggestions">
                            <h2>Suggestions</h2>
                            <div className="shop-rail-track">
                              {products.map((product) => (
                                <ProductTile
                                  key={product.id}
                                  card={product as unknown as ShopCard}
                                  compact
                                  onOpen={openProduct}
                                  onRequest={
                                    activeChat.retention_hold ? undefined : () => void beginRequest(product)
                                  }
                                />
                              ))}
                            </div>
                          </section>
                        )}
                      </div>
                      {!activeChat.retention_hold && requestFormOpen && (
                        <div className="member-chat-dialog-backdrop" onClick={() => setRequestFormOpen(false)}>
                          <section
                            className="member-chat-dialog"
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="member-request-dialog-title"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <header>
                              <div>
                                <p className="eyebrow">SOURCING</p>
                                <h2 id="member-request-dialog-title">Create a sourcing request</h2>
                              </div>
                              <button
                                type="button"
                                aria-label="Close sourcing request"
                                onClick={() => setRequestFormOpen(false)}
                              >
                                ×
                              </button>
                            </header>
                            <form className="member-chat-request-form" onSubmit={submitRequest}>
                              <fieldset className="member-request-source-options">
                                <legend>How would you like to share it?</legend>
                                {(
                                  [
                                    ["description", "Describe it"],
                                    ["saved_product", "Saved product"],
                                    ["catalog_product", "Site catalog"],
                                    ["image", "Screenshot"],
                                  ] as const
                                ).map(([value, label]) => (
                                  <label key={value}>
                                    <input
                                      type="radio"
                                      name="chat-request-source"
                                      checked={requestSourceType === value}
                                      onChange={() => {
                                        setRequestSourceType(value);
                                        setRequestProduct(null);
                                        setRequestSourceUrl("");
                                        setRequestSourceFile(null);
                                      }}
                                    />
                                    {label}
                                  </label>
                                ))}
                              </fieldset>
                              {(requestSourceType === "saved_product" || requestSourceType === "catalog_product") && (
                                <label>
                                  {requestSourceType === "saved_product"
                                    ? "Choose a saved product"
                                    : "Choose a catalog product"}
                                  <select
                                    required
                                    disabled={requestChoicesLoading}
                                    value={requestProduct?.id || ""}
                                    onChange={(event) =>
                                      setRequestProduct(
                                        (requestSourceType === "saved_product"
                                          ? requestSavedChoices
                                          : requestSourceChoices
                                        ).find((item) => item.id === event.target.value) || null,
                                      )
                                    }
                                  >
                                    <option value="">
                                      {requestChoicesLoading ? "Loading products…" : "Choose a product"}
                                    </option>
                                    {requestProduct &&
                                      !(
                                        requestSourceType === "saved_product"
                                          ? requestSavedChoices
                                          : requestSourceChoices
                                      ).some((item) => item.id === requestProduct.id) && (
                                        <option value={requestProduct.id}>{requestProduct.name}</option>
                                      )}
                                    {(requestSourceType === "saved_product"
                                      ? requestSavedChoices
                                      : requestSourceChoices
                                    ).map((item) => (
                                      <option key={item.id} value={item.id}>
                                        {item.name}
                                      </option>
                                    ))}
                                  </select>
                                  {requestSourceType === "saved_product" &&
                                    !requestSavedChoices.length &&
                                    !requestChoicesLoading && (
                                      <small>No saved products yet. Choose Site catalog instead.</small>
                                    )}
                                </label>
                              )}
                              {requestSourceType === "image" && (
                                <label>
                                  Product screenshot
                                  <input
                                    type="file"
                                    required
                                    accept="image/jpeg,image/png,image/webp"
                                    onChange={(event) => setRequestSourceFile(event.target.files?.[0] || null)}
                                  />
                                  <small>JPEG, PNG, or WebP · up to 10 MiB.</small>
                                </label>
                              )}
                              <label htmlFor="member-request-title">What should FayFort source?</label>
                              <input
                                id="member-request-title"
                                required
                                maxLength={160}
                                value={requestTitle}
                                onChange={(event) => setRequestTitle(event.target.value)}
                              />
                              <label htmlFor="member-request-details">Details for your request (optional)</label>
                              <textarea
                                id="member-request-details"
                                maxLength={2000}
                                rows={3}
                                value={requestDetails}
                                onChange={(event) => setRequestDetails(event.target.value)}
                              />
                              <div className="member-chat-request-actions">
                                <button
                                  type="button"
                                  className="secondary-button"
                                  disabled={requestBusy}
                                  onClick={() => {
                                    setRequestTitle("");
                                    setRequestProduct(null);
                                    setRequestDetails("");
                                    setRequestSourceType("description");
                                    setRequestSourceUrl("");
                                    setRequestSourceFile(null);
                                    setRequestFormOpen(false);
                                  }}
                                >
                                  Cancel
                                </button>
                                <button
                                  className="primary-button"
                                  disabled={
                                    requestBusy ||
                                    (requestChoicesLoading &&
                                      (requestSourceType === "saved_product" ||
                                        requestSourceType === "catalog_product") &&
                                      !requestProduct) ||
                                    !requestTitle.trim() ||
                                    ((requestSourceType === "saved_product" ||
                                      requestSourceType === "catalog_product") &&
                                      !requestProduct) ||
                                    (requestSourceType === "url" && !requestSourceUrl.trim()) ||
                                    (requestSourceType === "image" && !requestSourceFile)
                                  }
                                >
                                  {requestBusy ? "Submitting…" : "Submit request"}
                                </button>
                              </div>
                            </form>
                          </section>
                        </div>
                      )}
                      {!activeChat.retention_hold && photoReviewOpen && (
                        <div className="member-chat-dialog-backdrop" onClick={() => setPhotoReviewOpen(false)}>
                          <section
                            className="member-chat-dialog"
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="member-photo-dialog-title"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <header>
                              <div>
                                <p className="eyebrow">PHOTO REVIEW</p>
                                <h2 id="member-photo-dialog-title">Ask a person to review a photo</h2>
                              </div>
                              <button
                                type="button"
                                aria-label="Close photo review"
                                onClick={() => setPhotoReviewOpen(false)}
                              >
                                ×
                              </button>
                            </header>
                            <MemberChatPhotoSubmission accessToken={token} conversationId={activeChat.id} />
                          </section>
                        </div>
                      )}
                      {!activeChat.retention_hold && linkRequestOpen && requests.length > 0 && (
                        <div className="member-chat-dialog-backdrop" onClick={() => setLinkRequestOpen(false)}>
                          <section
                            className="member-chat-dialog"
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="member-link-request-title"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <header>
                              <div>
                                <p className="eyebrow">EXISTING REQUEST</p>
                                <h2 id="member-link-request-title">Link a sourcing request</h2>
                              </div>
                              <button
                                type="button"
                                aria-label="Close link request"
                                onClick={() => setLinkRequestOpen(false)}
                              >
                                ×
                              </button>
                            </header>
                            <p className="member-chat-dialog-copy">
                              Linking retains this chat with the selected request and makes it read-only.
                            </p>
                            <div className="member-chat-link-request">
                              <label htmlFor="member-chat-request">Choose one of your sourcing requests</label>
                              <select
                                id="member-chat-request"
                                value={selectedRequest}
                                onChange={(event) => setSelectedRequest(event.target.value)}
                              >
                                <option value="">Choose your request</option>
                                {requests.map((request) => (
                                  <option key={request.id} value={request.id}>
                                    {request.request_title}
                                  </option>
                                ))}
                              </select>
                              <div className="member-chat-request-actions">
                                <button
                                  className="primary-button"
                                  type="button"
                                  disabled={busy || !selectedRequest}
                                  onClick={() => void linkRequest()}
                                >
                                  {busy ? "Linking…" : "Link request"}
                                </button>
                              </div>
                            </div>
                          </section>
                        </div>
                      )}
                      {requestProgressOpen &&
                        progressRequest &&
                        (() => {
                          const latest = progressRequest.events.at(-1);
                          const stage = latest?.stage || "submitted";
                          const stageIndex = requestProgressIndex(stage);
                          return (
                            <div className="member-chat-dialog-backdrop" onClick={() => setRequestProgressOpen(false)}>
                              <section
                                className="member-chat-dialog member-chat-progress-dialog"
                                role="dialog"
                                aria-modal="true"
                                aria-labelledby="member-chat-progress-title"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <header>
                                  <div>
                                    <p className="eyebrow">LINKED REQUEST</p>
                                    <h2 id="member-chat-progress-title">Request progress</h2>
                                  </div>
                                  <button
                                    type="button"
                                    aria-label="Close request progress"
                                    onClick={() => setRequestProgressOpen(false)}
                                  >
                                    ×
                                  </button>
                                </header>
                                <h3>{progressRequest.request_title}</h3>
                                {progressRequest.product_name_snapshot && (
                                  <p className="member-chat-progress-product">
                                    Catalog item: {progressRequest.product_name_snapshot}
                                  </p>
                                )}
                                <div className="member-chat-progress-current">
                                  <small>Current status</small>
                                  <strong>{requestStageLabels[stage] || stage.replaceAll("_", " ")}</strong>
                                  <time>
                                    {latest?.created_at
                                      ? new Date(latest.created_at).toLocaleString()
                                      : progressRequest.created_at
                                        ? new Date(progressRequest.created_at).toLocaleString()
                                        : ""}
                                  </time>
                                </div>
                                {stage !== "cancelled" && (
                                  <ol className="member-chat-progress-steps" aria-label="Request fulfillment progress">
                                    {requestProgressStages.map((step, index) => (
                                      <li
                                        key={step}
                                        className={
                                          index < stageIndex
                                            ? "complete"
                                            : index === stageIndex
                                              ? "current"
                                              : "upcoming"
                                        }
                                        aria-current={index === stageIndex ? "step" : undefined}
                                      >
                                        <span>{index < stageIndex ? "✓" : index + 1}</span>
                                        <small>{requestStageLabels[step] || step}</small>
                                      </li>
                                    ))}
                                  </ol>
                                )}
                                <ol className="member-chat-progress-history" aria-label="Request update history">
                                  {progressRequest.events.map((item, index) => (
                                    <li key={item.id || item.sequence_no || index}>
                                      <strong>
                                        {requestStageLabels[item.stage] || item.stage.replaceAll("_", " ")}
                                      </strong>
                                      {item.member_note && <p>{item.member_note}</p>}
                                      {item.stage === "shipped" && item.details?.tracking_number && (
                                        <p>
                                          Tracking: {item.details.tracking_number}
                                          {item.details.carrier_name ? ` · ${item.details.carrier_name}` : ""}
                                          {item.details.tracking_url && (
                                            <>
                                              {" "}
                                              ·{" "}
                                              <a href={item.details.tracking_url} target="_blank" rel="noreferrer">
                                                Track shipment
                                              </a>
                                            </>
                                          )}
                                        </p>
                                      )}
                                      {item.created_at && <time>{new Date(item.created_at).toLocaleString()}</time>}
                                    </li>
                                  ))}
                                </ol>
                              </section>
                            </div>
                          );
                        })()}
                      {notice && <p role="status">{notice}</p>}
                      <form className="member-chat-composer" onSubmit={send}>
                        <label className="sr-only" htmlFor="member-chat-message">
                          Message FayFort
                        </label>
                        <textarea
                          id="member-chat-message"
                          value={draft}
                          onChange={(event) => setDraft(event.target.value)}
                          maxLength={4000}
                          rows={1}
                          placeholder="Describe it or paste a TikTok, Instagram or shop link…"
                          disabled={busy || activeChat.retention_hold}
                        />
                        <div className="member-chat-composer-footer">
                          {!activeChat.retention_hold && (
                            <div className="member-chat-tools" aria-label="Chat actions">
                              <button
                                type="button"
                                className="member-chat-tool-button"
                                title="Paste a link"
                                aria-label="Paste a link"
                                onClick={() => void pasteLink()}
                              >
                                <svg aria-hidden="true" viewBox="0 0 24 24">
                                  <path d="M9 4h6v3H9z" />
                                  <path d="M8 5.5H6.5A1.5 1.5 0 0 0 5 7v12.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V7a1.5 1.5 0 0 0-1.5-1.5H16" />
                                  <path d="M10.5 15.5 13.5 12.5M9.5 13l-.8.8a2 2 0 0 0 2.8 2.8l.8-.8m2.2-2.6.8-.8a2 2 0 0 0-2.8-2.8l-.8.8" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                className="member-chat-tool-button"
                                title="Ask a person to review a photo"
                                aria-label="Ask a person to review a photo"
                                onClick={() => setPhotoReviewOpen(true)}
                              >
                                <svg aria-hidden="true" viewBox="0 0 24 24">
                                  <rect x="3" y="4" width="18" height="16" rx="3" />
                                  <circle cx="8.5" cy="9" r="1.5" />
                                  <path d="m4 17 5-5 3 3 3-4 5 6" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                className="member-chat-tool-button"
                                title="Create a sourcing request"
                                aria-label="Create a sourcing request"
                                onClick={() => beginRequest()}
                              >
                                <svg aria-hidden="true" viewBox="0 0 24 24">
                                  <path d="M5 7.5h14l1 13H4l1-13Z" />
                                  <path d="M9 8V6a3 3 0 0 1 6 0v2M12 12v4m-2-2h4" />
                                </svg>
                              </button>
                              {requests.length > 0 && (
                                <button
                                  type="button"
                                  className="member-chat-tool-button"
                                  title="Link an existing request"
                                  aria-label="Link an existing request"
                                  onClick={() => setLinkRequestOpen(true)}
                                >
                                  <svg aria-hidden="true" viewBox="0 0 24 24">
                                    <path d="M10 13.5 14 9.5" />
                                    <path d="M8 16H6a4 4 0 0 1 0-8h4m4 0h4a4 4 0 0 1 0 8h-4" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          )}
                          <button
                            className="member-chat-send-button"
                            aria-label={busy ? "Sending message" : "Send message"}
                            title={
                              cooldownSeconds > 0
                                ? "Wait " +
                                  Math.floor(cooldownSeconds / 60) +
                                  ":" +
                                  String(cooldownSeconds % 60).padStart(2, "0")
                                : "Send message"
                            }
                            disabled={busy || activeChat.retention_hold || !draft.trim() || cooldownSeconds > 0}
                          >
                            {busy ? (
                              <span className="member-chat-send-busy">…</span>
                            ) : (
                              <svg aria-hidden="true" viewBox="0 0 24 24">
                                <path d="M12 19V5m-6 6 6-6 6 6" />
                              </svg>
                            )}
                          </button>
                        </div>
                        <details className="member-chat-info" open>
                          <summary>
                            <span className="member-chat-info-icon" aria-hidden="true">
                              i
                            </span>
                            <span>
                              <strong>Chat information</strong>
                              <small>
                                {activeChat.retention_hold
                                  ? "This chat is retained with your linked request."
                                  : "About privacy, chat limits, and catalog browsing"}
                              </small>
                            </span>
                            <span className="member-chat-info-chevron" aria-hidden="true">
                              ⌄
                            </span>
                          </summary>
                          <div className="member-chat-info-body">
                            {activeChat.retention_hold && (
                              <p>
                                <strong>Request-linked chat:</strong> This conversation is retained with your sourcing
                                request and is read-only. Follow updates in Requests.
                              </p>
                            )}
                            <p>
                              <strong>Chat limits:</strong> AI chat has monthly and hourly usage limits. If you reach a
                              limit, you can return when it resets.
                            </p>
                            <p>
                              <strong>Browse anytime:</strong> Catalog browsing and saved products remain available even
                              when chat is limited.
                            </p>
                            <p>
                              <strong>Need a person?</strong> Ask FayFort staff to take a look at this conversation.
                            </p>
                            {!activeChat.retention_hold && (
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() => void requestStaffSupport()}
                                disabled={
                                  busy ||
                                  (!!activeChat.support_status &&
                                    ["open", "claimed", "blocked"].includes(activeChat.support_status))
                                }
                              >
                                {busy
                                  ? "Requesting support…"
                                  : activeChat.support_status &&
                                      ["open", "claimed", "blocked"].includes(activeChat.support_status)
                                    ? "Staff support requested"
                                    : "Ask staff for help"}
                              </button>
                            )}
                          </div>
                        </details>
                        {cooldownSeconds > 0 && (
                          <small className="member-chat-cooldown-note">
                            Next chat turn in {Math.floor(cooldownSeconds / 60)}:
                            {String(cooldownSeconds % 60).padStart(2, "0")}.
                          </small>
                        )}
                      </form>
                    </>
                  ) : (
                    <div className="member-chat-empty">
                      <h2>Start a conversation</h2>
                      <p>Ask about products and find relevant catalog listings.</p>
                      <button className="primary-button" onClick={() => void createChat()} disabled={busy}>
                        Start chat
                      </button>
                    </div>
                  )}
                </section>
              )}
              {activePanel !== "chat" && !chatExpanded && (
                <button
                  type="button"
                  className="member-chat-restore"
                  aria-label="Open chat beside this panel"
                  title="Open chat"
                  onClick={() => setChatExpanded(true)}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.7 8.7 0 0 1-3.4-.7L4 20l1.4-3.5A7.2 7.2 0 0 1 4 12c0-4.1 3.6-7.5 8-7.5s8 3.1 8 7Z" />
                  </svg>
                  <span>Chat</span>
                </button>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

export function MemberChatPhotoSubmission({
  accessToken,
  conversationId,
}: {
  accessToken: string;
  conversationId: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || !consent) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const query = new URLSearchParams({ consent: "true", filename: file.name });
      await apiRequest(`/members/conversations/${conversationId}/review-media?${query}`, accessToken, {
        method: "POST",
        body: file,
        headers: { "Content-Type": file.type },
      });
      setFile(null);
      setConsent(false);
      setNotice("Photo sent for FayFort human review. A reviewer will be assigned from the separate review queue.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Photo could not be sent for review.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="member-chat-photo-form" onSubmit={submit} aria-label="Send a product photo for human review">
      <h3>Ask a person to review a photo</h3>
      <p>
        One JPEG, PNG, or WebP image up to 10 MiB. Your photo goes to a private queue; it is not analyzed by AI.
        Unreviewed photos expire after 30 days.
      </p>
      <label>
        Choose a photo
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => {
            setFile(event.target.files?.[0] || null);
            setConsent(false);
            setNotice("");
          }}
        />
      </label>
      {file && (
        <>
          <small>
            {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MiB
          </small>
          <label>
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> I agree
            to send this photo to FayFort for human review.
          </label>
        </>
      )}
      <button className="secondary-button" disabled={busy || !file || !consent}>
        {busy ? "Sending…" : "Send for human review"}
      </button>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </form>
  );
}

export function MemberWorkspacePanel({
  accessToken,
  mode,
}: {
  accessToken: string;
  mode: "catalog" | "saved" | "requests";
}) {
  const [products, setProducts] = useState<MemberCatalogProduct[]>([]);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [search, setSearch] = useState("");
  const [categoryRef, setCategoryRef] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(
    async (term: string, category: string, onlySaved: boolean) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (term.trim()) params.set("q", term.trim());
        if (category) params.set("category_ref", category);
        if (onlySaved) params.set("saved_only", "true");
        const result = await apiRequest<MemberCatalog>(
          `/members/products${params.size ? `?${params.toString()}` : ""}`,
          accessToken,
        );
        setProducts(result.products || []);
        setSavedIds(result.saved_product_ids || []);
        setCategories(result.categories || []);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Products could not be loaded.");
      } finally {
        setLoading(false);
      }
    },
    [accessToken],
  );
  useEffect(() => {
    void load("", "", mode === "saved");
  }, [mode, load]);
  async function searchProducts(event: FormEvent) {
    event.preventDefault();
    await load(search, categoryRef, mode === "saved");
  }
  async function toggleSaved(product: MemberCatalogProduct) {
    setBusyId(product.id);
    setError("");
    try {
      await apiRequest(`/members/products/${product.id}/saved`, accessToken, {
        method: savedIds.includes(product.id) ? "DELETE" : "POST",
      });
      if (!savedIds.includes(product.id)) trackIntent(accessToken, [{ event_type: "save", product_id: product.id }]);
      await load(search, categoryRef, mode === "saved");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Saved products could not be updated.");
    } finally {
      setBusyId("");
    }
  }
  if (mode === "requests")
    return (
      <section className="member-workspace-panel member-workspace-requests">
        <header>
          <small>YOUR ACCOUNT</small>
          <h2>Requests</h2>
          <p>Track sourcing, warehouse receipt, shipping, and delivery progress.</p>
        </header>
        <MemberRequestsPanel accessToken={accessToken} />
      </section>
    );
  return (
    <section className="member-workspace-panel">
      <header>
        <small>YOUR ACCOUNT</small>
        <h2>{mode === "saved" ? "Saved products" : "Browse catalog"}</h2>
        <p>
          {mode === "saved"
            ? "Products you saved to revisit."
            : "Browse active FayFort products and save items for later."}
        </p>
      </header>
      <form className="member-product-filters member-workspace-filters" onSubmit={searchProducts}>
        <label>
          Search products
          <input
            aria-label="Search products"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Product name"
            maxLength={100}
          />
        </label>
        <label>
          Category
          <select aria-label="Category" value={categoryRef} onChange={(event) => setCategoryRef(event.target.value)}>
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.source_ref} value={category.source_ref}>
                {category.category} · {category.product_type}
              </option>
            ))}
          </select>
        </label>
        <button className="primary-button" disabled={loading}>
          Search
        </button>
      </form>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Loading products…</p>
      ) : products.length === 0 ? (
        <p className="empty-copy">
          {mode === "saved" ? "You have no saved products yet." : "No active products match your search."}
        </p>
      ) : (
        <section
          className="member-product-grid member-workspace-product-grid"
          aria-label={mode === "saved" ? "Saved products" : "Available products"}
        >
          {products.map((product) => (
            <article className="member-product-card" key={product.id}>
              <ProductMediaPreview product={{ ...product, active: true, updated_at: "" }} />
              <div className="member-product-copy">
                <small>
                  {categories.find((item) => item.source_ref === product.category_ref)?.category || "Product"} ·{" "}
                  {product.availability_status.replaceAll("_", " ")}
                </small>
                <h3>{product.name}</h3>
                {product.description && <p>{product.description}</p>}
                <button
                  type="button"
                  className={savedIds.includes(product.id) ? "secondary-button" : "primary-button"}
                  disabled={busyId === product.id}
                  onClick={() => void toggleSaved(product)}
                >
                  {busyId === product.id
                    ? "Saving…"
                    : savedIds.includes(product.id)
                      ? "Remove saved product"
                      : "Save product"}
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
    </section>
  );
}
