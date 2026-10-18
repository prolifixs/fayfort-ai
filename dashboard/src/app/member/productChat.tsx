// "Ask about this product" (docs/MEMBER_DASHBOARD_UX_PLAN.md §4).
// Phone: a Pinterest-style sheet to pick a new chat or a recent one. Desktop: a card above the message box with a
// "Send to" menu. Messages sent while a product is attached carry it, so FayFort AI knows which product is meant.
import { useEffect, useRef, useState } from "react";
import type { MemberChat } from "./memberShared";
import { useDismiss } from "../ui/useDismiss";

export type ProductRef = { id: string; name: string; price?: number | null; currency?: string | null; image?: string | null };

export function productPrice(product: Pick<ProductRef, "price" | "currency">) {
  if (product.price === null || product.price === undefined) return "";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: product.currency || "USD" }).format(product.price);
  } catch {
    return `${product.price} ${product.currency || ""}`.trim();
  }
}

/** Chats a product can be sent to: open ones only (kept or archived chats are read-only), newest first. */
export function chatsForProduct(chats: MemberChat[], limit = 5) {
  return chats.filter((chat) => !chat.retention_hold && !chat.linked_request_id && !chat.archived_at).slice(0, limit);
}

function Thumb({ product }: { product: ProductRef }) {
  return product.image ? <img src={product.image} alt="" /> : <span aria-hidden="true">F</span>;
}

/** The small product card shown on a member's message that asked about it. */
export function ProductRefCard({ product, onOpen }: { product: ProductRef; onOpen?: () => void }) {
  return (
    <button type="button" className="product-ref-card" onClick={onOpen} aria-label={`Open ${product.name}`}>
      <span className="product-ref-thumb">
        <Thumb product={product} />
      </span>
      <span>
        <small>Asked about</small>
        <strong>{product.name}</strong>
        {productPrice(product) && <em>{productPrice(product)}</em>}
      </span>
    </button>
  );
}

/** Desktop and phone: the attached product above the message box, with "Send to" (desktop) and remove. */
export function ProductAttachment({
  product,
  activeChat,
  chats,
  showSendTo,
  onPickChat,
  onNewChat,
  onRemove,
}: {
  product: ProductRef;
  activeChat: MemberChat | null;
  chats: MemberChat[];
  showSendTo: boolean;
  onPickChat: (chat: MemberChat) => void;
  onNewChat: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), [menuRef]);
  const choices = chatsForProduct(chats);
  return (
    <div className="product-attachment" data-tour="product-ask" aria-label={`Asking about ${product.name}`}>
      <span className="product-ref-thumb">
        <Thumb product={product} />
      </span>
      <span className="product-attachment-text">
        <small>Asking about</small>
        <strong>{product.name}</strong>
        {productPrice(product) && <em>{productPrice(product)}</em>}
      </span>
      {showSendTo && (
        <div className="product-sendto" ref={menuRef}>
          <button type="button" className="product-sendto-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
            Send to: <b>{activeChat ? activeChat.title || "This chat" : "New chat"}</b> ▾
          </button>
          {open && (
            <div className="product-sendto-menu" role="menu" aria-label="Send this product to">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onNewChat();
                }}
              >
                + New chat
              </button>
              {choices.map((chat) => (
                <button
                  type="button"
                  role="menuitem"
                  key={chat.id}
                  aria-current={chat.id === activeChat?.id ? "true" : undefined}
                  onClick={() => {
                    setOpen(false);
                    onPickChat(chat);
                  }}
                >
                  {chat.title || "Chat"}
                  {chat.id === activeChat?.id && <small>This chat</small>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <button type="button" className="product-attachment-remove" aria-label="Stop asking about this product" onClick={onRemove}>
        ×
      </button>
    </div>
  );
}

/** Phone: Pinterest-style bottom sheet — New chat first, then the most recent chats. */
export function ProductChatSheet({
  product,
  chats,
  onPick,
  onNew,
  onClose,
}: {
  product: ProductRef;
  chats: MemberChat[];
  onPick: (chat: MemberChat) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    sheetRef.current?.querySelector<HTMLButtonElement>("button.product-sheet-new")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const choices = chatsForProduct(chats);
  return (
    <div className="product-sheet-scrim" onClick={onClose}>
      <div
        className="product-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Ask about this product in"
        ref={sheetRef}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="product-sheet-grip" aria-hidden="true" />
        <header>
          <span className="product-ref-thumb">
            <Thumb product={product} />
          </span>
          <div>
            <small>Ask about</small>
            <strong>{product.name}</strong>
          </div>
          <button type="button" className="shop-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <h3>Choose a chat</h3>
        <button type="button" className="product-sheet-new" onClick={onNew}>
          <span aria-hidden="true">+</span>
          <span>
            <strong>New chat</strong>
            <small>Start fresh about this product</small>
          </span>
        </button>
        {choices.length > 0 && (
          <ul className="product-sheet-list" aria-label="Recent chats">
            {choices.map((chat) => (
              <li key={chat.id}>
                <button type="button" onClick={() => onPick(chat)}>
                  <span aria-hidden="true" className="product-sheet-avatar">
                    {(chat.title || "C").trim().charAt(0).toUpperCase()}
                  </span>
                  <span>
                    <strong>{chat.title || "Chat"}</strong>
                    <small>
                      Last active{" "}
                      {new Date(chat.last_activity_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const TIP_KEY = "ff_product_ask_tip_seen";
/** First product a member opens: a one-time tip about asking in chat. */
export function useProductAskTip(active: boolean) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!active) return;
    try {
      if (!window.localStorage.getItem(TIP_KEY)) setShow(true);
    } catch {
      /* no tip without storage */
    }
  }, [active]);
  return {
    show,
    dismiss: () => {
      setShow(false);
      try {
        window.localStorage.setItem(TIP_KEY, "1");
      } catch {
        /* fine */
      }
    },
  };
}
