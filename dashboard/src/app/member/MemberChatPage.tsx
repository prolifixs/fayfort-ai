import { playMemberSound } from "../memberSound";
import { WorkerRatingPrompts } from "./WorkerRatingPrompts";
import { setOpenChat } from "./activeChat";
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
import { ChatPicks, FindItBlock, HotRails, ProductTile } from "./ShopComponents";
import { BrowsePanel, CartButton, OrdersPanel, ProductPanel } from "./ShopPanels";
import { MemberAccountDialogs, type MemberAccountDialogKind } from "./MemberAccountDialogs";
import { MemberSettingsPanel } from "./MemberSettingsPanel";
import { RANK_NAMES, depositNote, useMemberPlan } from "./membershipApi";
import { DESKTOP, useDismiss, useMediaQuery } from "../ui/useDismiss";
import { MemberIdentityGate } from "./MemberIdentity";
import { MEMBER_TOUR, MemberTour, ProfileMeter, type ProfileCompletion, type TourStep } from "./accountExtras";
import { SavedPanel } from "./ShopPanels";
import { AdSlot, AdsProvider } from "./ads";
import { BrandMark, FayfortLoader } from "../brand/FayfortLogo";
import { claimPendingSiteChat } from "./siteChatCarryOver";
import { CHAT_TOOLS, chatToolLabelsVisible, type ChatToolKey } from "./chatTools";
import { ToolsPanel, toolFromUrl, type ToolKey } from "./ToolsPanel";
import { ProductAttachment, ProductChatSheet, ProductRefCard, useProductAskTip, type ProductRef } from "./productChat";

type MemberPanel = "chat" | "catalog" | "saved" | "requests" | "product" | "tools";
const memberPanels: MemberPanel[] = ["catalog", "saved", "requests", "product", "tools"];
function panelFromUrl(): MemberPanel {
  const panel = new URLSearchParams(window.location.search).get("panel");
  // The supplier directory moved into Tools (2026-10-20); old links still land on it.
  if (panel === "directory") return "tools";
  return panel && memberPanels.includes(panel as MemberPanel) ? (panel as MemberPanel) : "chat";
}
function initialTool(): ToolKey | null {
  return new URLSearchParams(window.location.search).get("panel") === "directory" ? "directory" : toolFromUrl();
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

type MemberMe = {
  profile: Record<string, unknown>;
  completion?: ProfileCompletion;
  onboarding_completed?: boolean;
};

export function MemberChatPage() {
  const [token, setToken] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [completion, setCompletion] = useState<ProfileCompletion | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourAfterIdentity, setTourAfterIdentity] = useState(false);
  // Tool names under the icons for a member's first few visits.
  const [toolLabels] = useState(() => chatToolLabelsVisible());
  const [accountDialog, setAccountDialog] = useState<MemberAccountDialogKind | null>(null);
  const [requestBudget, setRequestBudget] = useState("");
  const { plan: memberPlan, reload: reloadPlan } = useMemberPlan(verified ? token : null);
  const requestBudgetValue = Number(requestBudget);
  const requestExpectedTotal =
    requestBudget.trim() && Number.isFinite(requestBudgetValue) && requestBudgetValue > 0 ? requestBudgetValue : null;
  const isDesktop = useMediaQuery(DESKTOP);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const infoRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const chatMenuRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  useDismiss(accountOpen, () => setAccountOpen(false), [accountRef]);
  useDismiss(infoOpen, () => setInfoOpen(false), [infoRef]);
  useDismiss(sidebarOpen && !isDesktop, () => setSidebarOpen(false), [sidebarRef]);
  const [chats, setChats] = useState<MemberChat[]>([]);
  // Archive: finished chats kept as the record, out of the main list.
  const [archivedCount, setArchivedCount] = useState(0);
  /** Chats started here that nobody has written in yet: not listed, and deleted when the member moves on
   * (owner rule, 2026-10-19). The server also clears any left behind. */
  const [unwrittenIds, setUnwrittenIds] = useState<string[]>([]);
  const activeChatId = useRef<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archivedChats, setArchivedChats] = useState<MemberChat[] | null>(null);
  const [archiveSeen, setArchiveSeen] = useState(() => {
    try {
      return Number(window.localStorage.getItem("ff_archive_seen_count") || 0);
    } catch {
      return 0;
    }
  });
  const [activeChat, setActiveChat] = useState<MemberChat | null>(null);
  const [messages, setMessages] = useState<MemberChatMessage[]>([]);
  const [products, setProducts] = useState<MemberCatalogProduct[]>([]);
  const [requests, setRequests] = useState<MemberOwnedRequest[]>([]);
  const [selectedRequest, setSelectedRequest] = useState("");
  const [draft, setDraft] = useState(() => sharedText());
  // The composer grows with its text (up to about eight lines), like a messaging app.
  useEffect(() => {
    const box = composerRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = Math.min(box.scrollHeight, 200) + "px";
  }, [draft]);
  const [home, setHome] = useState<ShopHome | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [productId, setProductId] = useState(() => new URLSearchParams(window.location.search).get("product") || "");
  // "Ask about this product": the product open on screen, the one attached to the message box, and the phone sheet.
  const [viewingProduct, setViewingProduct] = useState<ProductRef | null>(null);
  const [productRef, setProductRef] = useState<ProductRef | null>(null);
  const [productSheetOpen, setProductSheetOpen] = useState(false);
  const [refProducts, setRefProducts] = useState<Record<string, ProductRef>>({});
  const [shopBusyId, setShopBusyId] = useState("");
  const [busy, setBusy] = useState(false);
  // Keep the newest message in view, like a messaging app.
  useEffect(() => {
    const list = messagesRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length, busy]);
  const [loading, setLoading] = useState(false);
  const [deletingChatId, setDeletingChatId] = useState("");
  const [chatMenuId, setChatMenuId] = useState("");
  useDismiss(!!chatMenuId, () => setChatMenuId(""), [chatMenuRef]);
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
    setSidebarOpen(false);
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
    // The chat open on screen is never cleared away while the member is about to type in it.
    const keep = activeChatId.current || new URLSearchParams(window.location.search).get("conversation");
    const result = await apiRequest<{ conversations: MemberChat[]; archived_count?: number | null }>(
      keep && /^[0-9a-f-]{36}$/i.test(keep) ? `/members/conversations?keep=${keep}` : "/members/conversations",
      accessToken,
    );
    setChats(result.conversations || []);
    setArchivedCount(Number(result.archived_count) || 0);
    return result.conversations || [];
  }, []);
  const loadArchive = useCallback(async (accessToken: string) => {
    const result = await apiRequest<{ conversations: MemberChat[] }>("/members/conversations?archived=true", accessToken);
    setArchivedChats(result.conversations || []);
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
  function rememberRefProducts(items: MemberCatalogProduct[]) {
    if (!items.length) return;
    setRefProducts((current) => {
      const next = { ...current };
      for (const item of items) {
        const card = item as MemberCatalogProduct & { price?: number | null; sale_price?: number | null; currency?: string | null };
        next[item.id] = {
          id: item.id,
          name: item.name,
          price: card.sale_price ?? card.price ?? null,
          currency: card.currency ?? "USD",
          image: item.media_type === "image" ? item.media_url || null : null,
        };
      }
      return next;
    });
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
    rememberRefProducts(result.products || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const openRequestedChat = useCallback(
    async (accessToken: string, rows: MemberChat[], carriedId: string | null = null) => {
      const requestedId = carriedId || new URLSearchParams(window.location.search).get("conversation");
      let selected = rows.find((chat) => chat.id === requestedId);
      if (!selected && requestedId) {
        // "View chat" on a finished request: its chat may be in the Archive.
        try {
          selected = (await loadArchive(accessToken)).find((chat) => chat.id === requestedId);
        } catch {
          /* fall back to the newest chat */
        }
      }
      selected = selected || rows[0];
      if (selected) await openChat(accessToken, selected);
    },
    [openChat, loadArchive],
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
        const me = await apiRequest<MemberMe>("/members/me", accessToken);
        if (!mounted) return;
        setProfile(me.profile);
        applyMe(me);
        setVerified(true);
        const carriedId = await claimPendingSiteChat(accessToken, data.session);
        const rows = await loadChats(accessToken);
        await loadRequests(accessToken);
        await openRequestedChat(accessToken, rows, carriedId);
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
        apiRequest<MemberMe>("/members/me", accessToken)
          .then(async (me) => {
            if (!mounted) return;
            setProfile(me.profile);
            applyMe(me);
            setVerified(true);
            const carriedId = await claimPendingSiteChat(accessToken, session);
            const rows = await loadChats(accessToken);
            await loadRequests(accessToken);
            await openRequestedChat(accessToken, rows, carriedId);
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
    setSidebarOpen(false);
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
      setUnwrittenIds((current) => [...current, result.conversation.id]);
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
  /** Leaving a chat nobody wrote in deletes it. */
  function dropIfUnwritten(next: MemberChat | null) {
    const leaving = activeChat;
    if (!token || !leaving || leaving.id === next?.id || !unwrittenIds.includes(leaving.id) || messages.length > 0) return;
    if (leaving.retention_hold || leaving.linked_request_id) return;
    setChats((current) => current.filter((item) => item.id !== leaving.id));
    setUnwrittenIds((current) => current.filter((id) => id !== leaving.id));
    void apiRequest("/members/conversations/" + leaving.id, token, { method: "DELETE" }).catch(() => undefined);
  }
  async function chooseChat(chat: MemberChat) {
    if (!token) return;
    dropIfUnwritten(chat);
    setSidebarOpen(false);
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
  const askTip = useProductAskTip(activePanel === "product" && !!productId);
  /** A product page opened: on desktop the product is attached to the message box beside it. */
  function productLoaded(product: ProductRef) {
    setViewingProduct(product);
    if (isDesktop) setProductRef(product);
  }
  /** "Ask in chat" / the round Ask button. */
  function askAboutProduct() {
    const product = viewingProduct;
    if (!product) return;
    askTip.dismiss();
    if (isDesktop) {
      setProductRef(product);
      setChatExpanded(true);
      // A read-only chat (kept with a request) can't take a new question: start a fresh one.
      if (!activeChat || activeChat.retention_hold || activeChat.archived_at) void startFreshChat();
      window.setTimeout(() => composerRef.current?.focus(), 80);
    } else setProductSheetOpen(true);
  }
  /** Picking where to ask: an existing chat, or a new one. The product stays attached. */
  async function sendProductTo(chat: MemberChat | "new") {
    const product = viewingProduct || productRef;
    setProductSheetOpen(false);
    if (product) setProductRef(product);
    if (!isDesktop) selectMemberPanel("chat");
    else setChatExpanded(true);
    if (chat === "new") await startFreshChat();
    else await chooseChat(chat);
    window.setTimeout(() => composerRef.current?.focus(), 80);
  }
  /** Always a fresh chat (reuses the current one only when it has no messages yet). */
  async function startFreshChat() {
    if (!token) return;
    if (activeChat && messages.length === 0 && !activeChat.retention_hold && !activeChat.archived_at) return;
    try {
      const result = await apiRequest<{ conversation: MemberChat }>("/members/conversations", token, { method: "POST" });
      setChats((current) => [result.conversation, ...current]);
      setUnwrittenIds((current) => [...current, result.conversation.id]);
      setActiveChat(result.conversation);
      setMessages([]);
      setProducts([]);
      setNotice("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "A new chat could not be started.");
    }
  }
  /** "View chat" on a request: open its chat, from the Archive if it's there. */
  async function viewChat(conversationId: string) {
    if (!token) return;
    let chat = chats.find((item) => item.id === conversationId);
    if (!chat) {
      try {
        chat = (await loadArchive(token)).find((item) => item.id === conversationId);
      } catch {
        chat = undefined;
      }
    }
    if (!chat) {
      setError("That chat could not be found.");
      return;
    }
    if (chat.archived_at) setArchiveOpen(true);
    await chooseChat(chat);
  }
  function openArchive(open: boolean) {
    setArchiveOpen(open);
    setChatMenuId("");
    if (open) {
      if (token) void loadArchive(token).catch(() => setError("Your archive could not be loaded."));
      setArchiveSeen(archivedCount);
      try {
        window.localStorage.setItem("ff_archive_seen_count", String(archivedCount));
      } catch {
        /* the notice simply shows again */
      }
    }
  }
  async function setChatArchived(chat: MemberChat, archive: boolean) {
    if (!token) return;
    setChatMenuId("");
    setError("");
    try {
      const result = await apiRequest<{ archived_at: string | null }>(
        `/members/conversations/${chat.id}/${archive ? "archive" : "unarchive"}`,
        token,
        { method: "POST" },
      );
      const updated = { ...chat, archived_at: result.archived_at, archived_by: archive ? ("member" as const) : null };
      if (activeChat?.id === chat.id) setActiveChat(updated);
      await loadChats(token);
      if (archiveOpen || !archive) await loadArchive(token);
      setNotice(archive ? "Chat moved to Archive. It's kept as your record." : "Chat moved back to your chats.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That didn't work. Try again.");
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
        if (requestExpectedTotal) params.set("expected_total", String(requestExpectedTotal));
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
            expected_total: requestExpectedTotal,
          }),
        });
      }
      setRequestBudget("");
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
        assistant_message: MemberChatMessage | null;
        products: MemberCatalogProduct[];
        human_active?: boolean;
        find_it?: FindItResult | null;
        referenced_product?: (MemberCatalogProduct & { price?: number | null; currency?: string | null }) | null;
      }>(`/members/conversations/${activeChat.id}/messages`, token, {
        method: "POST",
        body: JSON.stringify(productRef ? { content, product_id: productRef.id } : { content }),
      });
      if (productRef) setRefProducts((current) => ({ ...current, [productRef.id]: productRef }));
      if (result.referenced_product) rememberRefProducts([result.referenced_product]);
      const reply = result.assistant_message;
      seenMessageIds.current = new Set([...seenMessageIds.current, result.member_message.id, ...(reply ? [reply.id] : [])]);
      const assistant = reply && result.find_it ? { ...reply, find_it: result.find_it } : reply;
      // While a FayFort person is chatting, the AI stays quiet; their reply arrives on the next refresh.
      setMessages((current) => [...current, result.member_message, ...(assistant ? [assistant] : [])]);
      if (result.human_active && !assistant) setNotice("A FayFort team member is in this chat and will reply here.");
      if (result.find_it?.link) void loadShop(token);
      if (assistant) playMemberSound();
      if (!result.human_active) setProducts(result.products || []);
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
  useEffect(() => {
    activeChatId.current = activeChat?.id || null;
  }, [activeChat]);
  useEffect(() => {
    if (activeChat && messages.length > 0 && unwrittenIds.includes(activeChat.id))
      setUnwrittenIds((current) => current.filter((id) => id !== activeChat.id));
  }, [activeChat, messages.length, unwrittenIds]);
  /** Profile completion and the first-visit tour come with the member profile. */
  function applyMe(me: MemberMe) {
    if (me.completion) setCompletion(me.completion);
    // The tour waits until the member has filled in their name (the required card comes first).
    if (me.onboarding_completed === false) {
      if (me.profile?.identity_complete === false) setTourAfterIdentity(true);
      else setTourOpen(true);
    }
  }
  function refreshCompletion() {
    if (!token) return;
    apiRequest<MemberMe>("/members/me", token)
      .then((me) => me.completion && setCompletion(me.completion))
      .catch(() => undefined);
  }
  function finishTour() {
    setTourOpen(false);
    if (!isDesktop) setSidebarOpen(false);
    if (token) void apiRequest("/members/me/onboarding", token, { method: "POST" }).catch(() => undefined);
  }
  /** On phones the menu is a drawer: open it for menu steps, close it for the top bar. */
  function prepareTourStep(step: TourStep) {
    const inChat = step.target.startsWith("tool-") || step.target === "chat-tools" || step.target === "product-ask";
    // The chat tools live under the message box: show the chat for those steps.
    if (inChat && activePanel !== "chat" && !isDesktop) selectMemberPanel("chat");
    if (isDesktop) return;
    setSidebarOpen(!inChat && !["notifications", "cart"].includes(step.target));
  }
  function openAccountDialog(kind: MemberAccountDialogKind) {
    setAccountOpen(false);
    setSidebarOpen(false);
    setSettingsFocus(undefined);
    setAccountDialog(kind);
  }
  const closeAccountDialog = useCallback(() => setAccountDialog(null), []);
  // Plans, billing and plan perks live in Settings → Plan.
  const [settingsFocus, setSettingsFocus] = useState<"plan" | undefined>(undefined);
  const openPlans = useCallback(() => {
    setAccountOpen(false);
    setSidebarOpen(false);
    setSettingsFocus("plan");
    setAccountDialog("settings");
  }, []);
  // Back from Stripe Checkout: thank the member and show their plan once the webhook has updated it.
  useEffect(() => {
    if (!verified || !token) return;
    const params = new URLSearchParams(window.location.search);
    const billing = params.get("billing");
    if (!billing) return;
    params.delete("billing");
    window.history.replaceState({}, "", window.location.pathname + (params.toString() ? `?${params}` : ""));
    if (billing !== "success") return;
    setNotice("Thanks! Your payment went through. Your plan updates in a few seconds.");
    const timer = window.setTimeout(() => {
      apiRequest<MemberMe>("/members/me", token)
        .then((me) => {
          setProfile(me.profile);
          applyMe(me);
        })
        .catch(() => undefined);
      reloadPlan();
      openPlans();
    }, 4000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verified, token]);
  // Products already shown in a Find It result aren't repeated under "Suggestions".
  const findItIds = new Set(
    messages.flatMap((message) =>
      message.find_it ? [message.find_it.exact, ...message.find_it.alternatives].filter(Boolean).map((card) => card!.id) : [],
    ),
  );
  const suggestedProducts = products.filter((product) => !findItIds.has(product.id));
  const memberName =
    typeof profile?.display_name === "string" && profile.display_name.trim() ? profile.display_name.trim() : "Member";
  const panelTitles: Record<MemberPanel, string> = {
    chat: activeChat?.title || "New chat",
    catalog: "Browse",
    saved: "Saved products",
    requests: "Orders & requests",
    product: "Product",
    tools: "Tools",
  };
  const split = activePanel !== "chat" && chatExpanded && isDesktop;
  const showChat = activePanel === "chat" || split;
  // A worker reply in the chat already on screen doesn't need a pop-up (MemberNotificationsBar checks this).
  const visibleChatId = showChat ? activeChat?.id || null : null;
  useEffect(() => {
    setOpenChat(visibleChatId);
    return () => setOpenChat(null);
  }, [visibleChatId]);
  const navItems: { panel: MemberPanel; label: string; icon: string }[] = [
    { panel: "catalog", label: "Browse", icon: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" },
    { panel: "saved", label: "Saved products", icon: "M6 4h12v16l-6-4-6 4z" },
    { panel: "requests", label: "Orders & requests", icon: "M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8" },
    { panel: "tools", label: "Tools", icon: "M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" },
  ];
  if (!dashboardAuthConfigured) return <SetupScreen />;
  if (authLoading || !token || !verified) {
    return (
      <main className="mapp-gate">
        <a className="mapp-brand" href="/member/chat" aria-label="FayFort chat home">
          <BrandMark />
          <span>FayFort</span>
        </a>
        {authLoading ? (
          <FayfortLoader label="Checking your member sign-in…" />
        ) : !token ? (
          <div className="member-chat-empty">
            <h1>Sign in to start a chat</h1>
            <p>Chat helps you explore active catalog products. You can browse the catalog without using AI chat.</p>
            <a className="primary-button" href="/member/account">
              Member sign in
            </a>
          </div>
        ) : (
          <p role="status">{error || "Checking verified member access…"}</p>
        )}
      </main>
    );
  }
  const listedChats = chats.filter((chat) => !unwrittenIds.includes(chat.id));
  return (
    <AdsProvider accessToken={verified ? token : null} planKey={memberPlan?.tier} onUpgrade={openPlans}>
    <div className={sidebarOpen && !isDesktop ? "mapp sidebar-open" : "mapp"}>
      <aside
        id="member-sidebar"
        className="mapp-sidebar"
        aria-label="Chats and navigation"
        ref={sidebarRef}
        aria-hidden={!isDesktop && !sidebarOpen ? true : undefined}
      >
        <div className="mapp-sidebar-head">
          <a className="mapp-brand" href="/member/chat" aria-label="FayFort chat home">
            <BrandMark />
            <span>FayFort</span>
          </a>
          {!isDesktop && (
            <button type="button" className="icon-button" aria-label="Close menu" onClick={() => setSidebarOpen(false)}>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          )}
        </div>
        <button type="button" className="mapp-new-chat" data-tour="new-chat" onClick={() => void createChat()} disabled={busy}>
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
          <span>New chat</span>
        </button>
        <nav className="mapp-nav" aria-label="Member navigation">
          {navItems.map((item) => (
            <button
              key={item.panel}
              type="button"
              className={activePanel === item.panel ? "active" : ""}
              data-tour={item.panel === "catalog" ? "browse" : item.panel}
              aria-current={activePanel === item.panel ? "page" : undefined}
              onClick={() => selectMemberPanel(item.panel)}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d={item.icon} />
              </svg>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <section className="mapp-history" aria-label={archiveOpen ? "Archived chats" : "Your chats"} data-tour="chats">
          {archiveOpen ? (
            <div className="mapp-history-head">
              <button type="button" className="link-button" onClick={() => openArchive(false)}>
                ← Chats
              </button>
              <h2>Archive</h2>
            </div>
          ) : (
            <h2>Chats</h2>
          )}
          {archiveOpen && (
            <p className="mapp-history-note">Finished chats are kept here as your record. Nothing is deleted.</p>
          )}
          {(archiveOpen ? archivedChats || [] : listedChats).length === 0 ? (
            <p className="mapp-history-empty">
              {archiveOpen ? (archivedChats ? "Nothing archived yet." : "Loading…") : "Your chats will appear here."}
            </p>
          ) : (
            (archiveOpen ? archivedChats || [] : listedChats).map((chat) => {
              const kept = !!(chat.retention_hold || chat.linked_request_id);
              return (
                <div
                  className={activeChat?.id === chat.id && activePanel === "chat" ? "member-chat-row active" : "member-chat-row"}
                  key={chat.id}
                >
                  <button className="member-chat-list-item" onClick={() => void chooseChat(chat)}>
                    <strong>{chat.title}</strong>
                    <small>
                      {chat.archived_at
                        ? `Archived ${new Date(chat.archived_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                        : kept
                          ? "Kept with a request"
                          : chat.support_status
                            ? `Staff support · ${chat.support_status.replaceAll("_", " ")}`
                            : "Member chat"}
                    </small>
                  </button>
                  <div className="member-chat-options" ref={chatMenuId === chat.id ? chatMenuRef : undefined}>
                    <button
                      type="button"
                      className="member-chat-options-trigger"
                      aria-label={"Chat options for " + chat.title}
                      aria-haspopup="menu"
                      aria-expanded={chatMenuId === chat.id}
                      disabled={deletingChatId === chat.id}
                      onClick={() => setChatMenuId((current) => (current === chat.id ? "" : chat.id))}
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24">
                        <path d="M6 12h.01M12 12h.01M18 12h.01" />
                      </svg>
                    </button>
                    {chatMenuId === chat.id && (
                      <div className="member-chat-options-menu" role="menu">
                        {chat.archived_at ? (
                          <button type="button" role="menuitem" onClick={() => void setChatArchived(chat, false)}>
                            Move back to chats
                          </button>
                        ) : kept ? (
                          <>
                            <button type="button" role="menuitem" onClick={() => void setChatArchived(chat, true)}>
                              Archive chat
                            </button>
                            <small>Kept as the record for its request, so it can be archived but not deleted.</small>
                          </>
                        ) : (
                          <button
                            type="button"
                            role="menuitem"
                            disabled={deletingChatId === chat.id}
                            onClick={() => void deleteChat(chat)}
                          >
                            {deletingChatId === chat.id ? "Deleting…" : "Delete chat"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
          {!archiveOpen && archivedCount > archiveSeen && (
            <p className="mapp-archive-notice" role="status">
              {archivedCount - archiveSeen === 1
                ? "1 finished chat moved to Archive."
                : `${archivedCount - archiveSeen} finished chats moved to Archive.`}
            </p>
          )}
          {!archiveOpen && archivedCount > 0 && (
            <button type="button" className="mapp-archive-link" data-tour="archive" onClick={() => openArchive(true)}>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M4 7h16v3H4zM5.5 10v8.5h13V10M10 14h4" />
              </svg>
              Archive <span>{archivedCount}</span>
            </button>
          )}
        </section>
        {isDesktop && <AdSlot placement="sidebar" />}
        <div className="mapp-account" ref={accountRef} data-tour="account">
          {accountOpen && (
            <div className="member-account-dropdown" role="menu" aria-label="Account">
              <div className="member-account-dropdown-name">
                <small>Member name</small>
                <strong>{memberName}</strong>
              </div>
              <button type="button" role="menuitem" onClick={() => openAccountDialog("points")}>
                <span>Virtual points</span>
                <strong>{new Intl.NumberFormat().format(Number(profile?.points_balance ?? 0) || 0)}</strong>
              </button>
              <button type="button" role="menuitem" onClick={() => openAccountDialog("tier")}>
                <span>Member tier</span>
                <strong>
                  {RANK_NAMES[Math.min(5, Math.max(1, Number(profile?.rank_level) || 1))]} · {Number(profile?.subrank) || 1}
                </strong>
              </button>
              {completion && completion.percent < 100 && (
                <button type="button" role="menuitem" className="member-account-completion" onClick={() => openAccountDialog("settings")}>
                  <span>
                    Profile {completion.percent}% complete
                    {!completion.address_ready && <small>Add a shipping address</small>}
                  </span>
                  <ProfileMeter percent={completion.percent} />
                </button>
              )}
              <button type="button" role="menuitem" onClick={() => openAccountDialog("account")}>
                Account details
              </button>
              <button type="button" role="menuitem" onClick={() => openAccountDialog("settings")}>
                Settings
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAccountOpen(false);
                  setTourOpen(true);
                }}
              >
                Show me around
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAccountOpen(false);
                  setTourOpen(true);
                }}
              >
                Take the tour
              </button>
            </div>
          )}
          <button
            type="button"
            className="mapp-account-button"
            aria-label="Open member account menu"
            aria-haspopup="menu"
            aria-expanded={accountOpen}
            onClick={() => setAccountOpen((value) => !value)}
          >
            <span className="member-account-icon" aria-hidden="true">
              {typeof profile?.profile_photo_url === "string" ? (
                <img src={profile.profile_photo_url} alt="" />
              ) : (
                <svg viewBox="0 0 24 24">
                  <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0" />
                </svg>
              )}
            </span>
            <span className="mapp-account-text">
              <strong>{memberName}</strong>
              <small>
                {RANK_NAMES[Math.min(5, Math.max(1, Number(profile?.rank_level) || 1))]} · {Number(profile?.subrank) || 1}
              </small>
              {completion && completion.percent < 100 && (
                <span className="mapp-account-meter">
                  <ProfileMeter percent={completion.percent} />
                  <small>Profile {completion.percent}%</small>
                </span>
              )}
            </span>
          </button>
        </div>
      </aside>
      {!isDesktop && sidebarOpen && <div className="mapp-scrim" aria-hidden="true" />}
      {productSheetOpen && (viewingProduct || productRef) && (
        <ProductChatSheet
          product={(viewingProduct || productRef)!}
          chats={chats}
          onPick={(chat) => void sendProductTo(chat)}
          onNew={() => void sendProductTo("new")}
          onClose={() => setProductSheetOpen(false)}
        />
      )}
      {token && profile?.identity_complete === false && (
        <MemberIdentityGate
          accessToken={token}
          onSignOut={() => {
            void supabaseClient?.auth.signOut().then(() => window.location.assign("/member/account"));
          }}
          onDone={(identity) => {
            setProfile((current) => ({ ...(current || {}), ...identity, identity_complete: true }));
            refreshCompletion();
            if (tourAfterIdentity) {
              setTourAfterIdentity(false);
              setTourOpen(true);
            }
          }}
        />
      )}
      {tourOpen && <MemberTour steps={MEMBER_TOUR} onFinish={finishTour} beforeStep={prepareTourStep} />}
      <div className="mapp-main">
        <header className="mapp-topbar">
          {!isDesktop && (
            <button
              type="button"
              className="icon-button"
              aria-label="Open menu"
              aria-controls="member-sidebar"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(true)}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M4 7h16M4 12h16M4 17h10" />
              </svg>
            </button>
          )}
          <h1 className="mapp-title">{panelTitles[activePanel]}</h1>
          <div className="mapp-topbar-actions">
            {activeChat && showChat && (
              <div className="mapp-info" ref={infoRef}>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Chat information"
                  aria-haspopup="dialog"
                  aria-expanded={infoOpen}
                  onClick={() => setInfoOpen((value) => !value)}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 11v5M12 8h.01" />
                  </svg>
                </button>
                {infoOpen && (
                  <section className="mapp-popover member-chat-info-body" role="dialog" aria-label="Chat information">
                    <h2>Chat information</h2>
                    {activeChat.retention_hold && (
                      <p>
                        <strong>Request-linked chat:</strong> This conversation is retained with your sourcing request
                        and is read-only. Follow updates in Orders & requests.
                      </p>
                    )}
                    <p>
                      <strong>Chat limits:</strong> AI chat has monthly and hourly usage limits. If you reach a limit,
                      you can return when it resets.
                    </p>
                    <p>
                      <strong>Browse anytime:</strong> Catalog browsing and saved products remain available even when
                      chat is limited.
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
                          : activeChat.support_status && ["open", "claimed", "blocked"].includes(activeChat.support_status)
                            ? "Staff support requested"
                            : "Ask staff for help"}
                      </button>
                    )}
                  </section>
                )}
              </div>
            )}
            <span data-tour="notifications" className="mapp-tour-anchor">
              <MemberNotificationsBar accessToken={token} header />
            </span>
            <span data-tour="cart" className="mapp-tour-anchor">
              <CartButton accessToken={token} cart={cart} onCartChange={setCart} onOpen={openProduct} />
            </span>
          </div>
        </header>
        <MemberAccountDialogs
          kind={accountDialog}
          profile={profile}
          onClose={closeAccountDialog}
          onOpen={setAccountDialog}
          accessToken={verified ? token : null}
          plan={memberPlan}
          onPlanChange={reloadPlan}
          onOpenPlan={openPlans}
          settings={
            <MemberSettingsPanel
              onProfileChange={(next) => setProfile((current) => ({ ...(current || {}), ...next }))}
              onCompletionChange={setCompletion}
              onPlanChange={reloadPlan}
              focus={settingsFocus}
            />
          }
        />
        <div className={split ? "mapp-content split" : "mapp-content"}>
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
              {activePanel === "requests" && (
                <OrdersPanel accessToken={token} onAddressChange={refreshCompletion} onViewChat={(id) => void viewChat(id)} />
              )}
              {activePanel === "tools" && <ToolsPanel accessToken={token} initial={initialTool()} />}
              {activePanel === "saved" && <SavedPanel accessToken={token} onOpen={openProduct} onBrowse={() => selectMemberPanel("catalog")} />}
              {activePanel === "product" && productId && (
                <ProductPanel
                  accessToken={token}
                  productId={productId}
                  onOpen={openProduct}
                  onCartChange={setCart}
                  onClose={() => selectMemberPanel("chat")}
                  onLoaded={productLoaded}
                  onAsk={askAboutProduct}
                  askTip={askTip.show}
                  onDismissTip={askTip.dismiss}
                />
              )}
              {showChat && (
                <section className="member-chat-conversation" aria-label="Member product discovery chat">
                  {split && (
                    <button
                      type="button"
                      className="member-chat-minimize icon-button"
                      aria-label="Minimize chat panel"
                      title="Minimize chat"
                      onClick={() => setChatExpanded(false)}
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24">
                        <path d="M6 12h12" />
                      </svg>
                    </button>
                  )}
                  {activeChat?.archived_at && (
                    <div className="member-chat-archived-banner" role="note">
                      <span>
                        Archived{" "}
                        {new Date(activeChat.archived_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                        {" · "}kept as your record
                      </span>
                      <button type="button" className="link-button" onClick={() => void setChatArchived(activeChat, false)}>
                        Move back to chats
                      </button>
                    </div>
                  )}
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
                      <div className="member-chat-messages" aria-live="polite" ref={messagesRef}>
                        {messages.length === 0 && !loading && (
                          <div className="member-chat-welcome">
                            <h2>What are you looking for?</h2>
                            <p>
                              Describe a product, use, or category. I’ll help you explore active FayFort catalog
                              listings.
                            </p>
                            {home ? (
                              <ChatPicks
                                rails={home.rails}
                                tiles={home.category_tiles || []}
                                onOpen={openProduct}
                                browseHref="/member/chat?panel=catalog"
                              />
                            ) : (
                              <a href="/member/chat?panel=catalog">Browse products directly</a>
                            )}
                            {home && home.giveaways.length > 0 && (
                              <HotRails
                                rails={[]}
                                giveaways={home.giveaways}
                                onOpen={openProduct}
                                onWant={(trend) => void wantTrend(trend)}
                                onEnter={(giveaway) => void enterGiveaway(giveaway)}
                                busyId={shopBusyId}
                              />
                            )}
                            <AdSlot placement="chat_welcome" />
                          </div>
                        )}
                        {messages.map((message) => (
                          <article className={`member-chat-bubble ${message.sender_type}`} key={message.id}>
                            <small className={message.staff ? "member-chat-staff" : undefined}>
                              {message.staff && (
                                <span className="member-chat-staff-face" aria-hidden="true">
                                  {message.staff.photo_url ? <img src={message.staff.photo_url} alt="" /> : message.staff.first_name.slice(0, 1)}
                                </span>
                              )}
                              {message.sender_type === "member"
                                ? "You"
                                : message.sender_type === "worker"
                                  ? message.staff
                                    ? `${message.staff.first_name} · FayFort team`
                                    : "FayFort human support"
                                  : "FayFort assistant"}
                            </small>
                            {message.product_ref && refProducts[message.product_ref] && (
                              <ProductRefCard
                                product={refProducts[message.product_ref]}
                                onOpen={() => openProduct({ id: message.product_ref! })}
                              />
                            )}
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
                        {token && activeChat?.id && <WorkerRatingPrompts accessToken={token} conversationId={activeChat.id} kind="chat" />}
                        {busy && (
                          <p role="status" className="member-chat-loading">
                            Searching the catalog and preparing a reply…
                          </p>
                        )}
                        {suggestedProducts.length > 0 && (
                          <section className="member-chat-suggestions" aria-label="Catalog suggestions">
                            <h2>Suggestions</h2>
                            <div className="shop-rail-track">
                              {suggestedProducts.map((product) => (
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
                              <label htmlFor="member-request-budget">Expected budget in USD (optional)</label>
                              <input
                                id="member-request-budget"
                                inputMode="decimal"
                                value={requestBudget}
                                placeholder="e.g. 300"
                                onChange={(event) => setRequestBudget(event.target.value.replace(/[^0-9.]/g, ""))}
                              />
                              <small className="member-deposit-note">{depositNote(memberPlan, requestExpectedTotal)}</small>
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
                      {productRef && (
                        <ProductAttachment
                          product={productRef}
                          activeChat={activeChat}
                          chats={chats}
                          showSendTo={isDesktop}
                          onPickChat={(chat) => void sendProductTo(chat)}
                          onNewChat={() => void sendProductTo("new")}
                          onRemove={() => setProductRef(null)}
                        />
                      )}
                      <form className="member-chat-composer" onSubmit={send}>
                        <label className="sr-only" htmlFor="member-chat-message">
                          Message FayFort
                        </label>
                        <textarea
                          id="member-chat-message"
                          ref={composerRef}
                          value={draft}
                          onChange={(event) => setDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey && isDesktop && !event.nativeEvent.isComposing) {
                              event.preventDefault();
                              event.currentTarget.form?.requestSubmit();
                            }
                          }}
                          maxLength={4000}
                          rows={1}
                          placeholder="Describe it or paste a TikTok, Instagram or shop link…"
                          disabled={busy || activeChat.retention_hold}
                        />
                        <div className="member-chat-composer-footer">
                          {!activeChat.retention_hold && (
                            <div
                              className={toolLabels ? "member-chat-tools with-labels" : "member-chat-tools"}
                              aria-label="Chat actions"
                              data-tour="chat-tools"
                            >
                              <ChatToolButton tool="link" onClick={() => void pasteLink()} labels={toolLabels} />
                              <ChatToolButton tool="photo" onClick={() => setPhotoReviewOpen(true)} labels={toolLabels} />
                              <ChatToolButton tool="request" onClick={() => beginRequest()} labels={toolLabels} />
                              {requests.length > 0 && (
                                <ChatToolButton tool="attach" onClick={() => setLinkRequestOpen(true)} labels={toolLabels} />
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
                        <p className="member-chat-fineprint">
                          FayFort AI can make mistakes.<span> Staff can join any chat when you ask for help.</span>
                        </p>
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
              {activePanel !== "chat" && !split && (
                <button
                  type="button"
                  className="member-chat-restore"
                  aria-label={isDesktop ? "Open chat beside this panel" : "Back to chat"}
                  title="Open chat"
                  onClick={() => (isDesktop ? setChatExpanded(true) : selectMemberPanel("chat"))}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.7 8.7 0 0 1-3.4-.7L4 20l1.4-3.5A7.2 7.2 0 0 1 4 12c0-4.1 3.6-7.5 8-7.5s8 3.1 8 7Z" />
                  </svg>
                  <span>Chat</span>
                </button>
              )}
        </div>
      </div>
    </div>
    </AdsProvider>
  );
}

/** One chat tool: hover (desktop) or a long press (phone) shows its name; names show underneath on the first visits. */
function ChatToolButton({ tool, onClick, labels }: { tool: ChatToolKey; onClick: () => void; labels: boolean }) {
  const meta = CHAT_TOOLS[tool];
  const [peek, setPeek] = useState(false);
  const holdTimer = useRef<number | undefined>(undefined);
  const held = useRef(false);
  useEffect(() => () => window.clearTimeout(holdTimer.current), []);
  return (
    <button
      type="button"
      className={peek ? "member-chat-tool-button is-peeking" : "member-chat-tool-button"}
      title={meta.label}
      aria-label={meta.label}
      data-tour={`tool-${tool}`}
      data-label={meta.label}
      onTouchStart={() => {
        held.current = false;
        holdTimer.current = window.setTimeout(() => {
          held.current = true;
          setPeek(true);
          window.setTimeout(() => setPeek(false), 1800);
        }, 450);
      }}
      onTouchEnd={() => window.clearTimeout(holdTimer.current)}
      onTouchMove={() => window.clearTimeout(holdTimer.current)}
      onContextMenu={(event) => event.preventDefault()}
      onClick={() => {
        // A long press only shows the name; it doesn't also open the tool.
        if (held.current) {
          held.current = false;
          return;
        }
        onClick();
      }}
    >
      {meta.icon}
      {labels && <span className="member-chat-tool-label">{meta.short}</span>}
    </button>
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
        <FayfortLoader label="Loading products…" />
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
