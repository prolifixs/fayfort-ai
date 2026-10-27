import { useEffect, useMemo, useRef, useState } from "react";
import { OperationsNotifications } from "./OperationsNotifications";
import { ShiftControl } from "./ShiftControl";
import { ChatAvailability } from "./ChatAvailability";
import { departmentLabel, statusLabel } from "./operations/types";
import { ShortId, readable } from "./staff/StaffChrome";
import { useOperationsCenter } from "./operations/useOperationsCenter";
import {
  WorkforcePanel,
  ReportsPanel,
  AutomationActivity,
  QueueFilters,
  SourcingBatchForm,
  WorkList,
} from "./operations/OverviewPanels";
import {
  RequestContextPanel,
  DisputeCreateForm,
  DisputeCasePanel,
  FulfillmentPanel,
  SourcingCandidatesPanel,
  ShareOptionsForm,
  BatchPanel,
} from "./operations/RequestPanels";
import { MemberConversationPanel, HandoffPanel, BusinessConversationPanel } from "./operations/ConversationPanels";
import { WorkActionForm, TransferForm, WorkHistory, ChecklistPanel, NotesPanel } from "./operations/WorkPanels";
import {
  ArchiveControls,
  DeadlinePanel,
  FlowPanel,
  GuideTab,
  HelpSheet,
  OpsSection,
  PaymentsPanel,
  PlaybookPanel,
  ReopenForm,
  RequestStagePanel,
  useFirstWeek,
} from "./operations/FlowPanels";
import { GUIDES, TOOL_GUIDES, guideKeyFor, playbookSteps } from "./operations/playbooks";
import { PageHelp, toPageGuide } from "./staff/PageHelp";
import { ShiftGate } from "./ShiftGate";
import { StaffThemeToggle, useStaffTheme } from "./staff/staffTheme";
import { FayfortLoader } from "./brand/FayfortLogo";
import { ProductsWorkspace } from "./operations/StoreTeam";
import { BookingsPanel } from "./operations/BookingsPanel";
import { SchedulePanel } from "./operations/SchedulePanel";
import { CustomerPane, AnswersSearch, isChatItem } from "./operations/CustomerPane";
import { MemberChatsPanel } from "./workspace/MemberChatsPanel";
import { BookingsTodayCard, CaseFile, GiveawaysCard, InvoicesCard, isDisputeItem, useSupportOverview } from "./operations/SupportTools";
import { ComingUpCard, ListingsCard, NextDropCard, useStoreOverview } from "./operations/StoreTools";
import { CatalogCard, DepositsCard, OrdersCard, TrendsCard, useSourcingOverview } from "./operations/SourcingTools";
import { DESK_LABEL, DESK_ORDER, DeskHeader, MyWorkHome, OpsRail, ToolCard, useDesks, type RailEntry } from "./operations/Desks";
import type { Department } from "./operations/types";

type View = "queue" | "products" | "bookings" | "schedule" | "archive" | "guide" | "team" | "reports";
const VIEWS: View[] = ["queue", "products", "bookings", "schedule", "archive", "guide", "team", "reports"];

const SOURCE_LABEL: Record<string, string> = {
  shopify_order: "From a shop order",
  trend_pool: "From a group buy",
  giveaway: "From a giveaway",
  giveaway_winner: "From a giveaway win",
  photo_review: "From a member's photo",
  subscription_past_due: "From a failed subscription payment",
  invoice: "From an invoice that didn't send",
  invoice_void: "From a cancelled request's invoice",
  paid_after_cancel: "From a payment after a cancellation",
  store_listing: "From the Store team's Products workspace",
  chat_handoff: "Sent from a chat on the Conversations desk",
  unmapped_product: "From a Shopify product with no category",
  retire_product: "From a listing nobody has wanted lately",
  merch_section: "From a store section on Browse",
  campaign_giveaway: "From a scheduled giveaway",
  campaign_sale: "From a scheduled flash sale",
};

export function OperationsCenterPage() {
  const ops = useOperationsCenter();
  const [staffTheme, setStaffTheme] = useStaffTheme();
  const [view, setView] = useState<View>(() => {
    const asked = new URLSearchParams(window.location.search).get("view");
    // Tour bookings moved into Bookings; My work and the desks are the queue (R2).
    const wanted = (asked === "tours" ? "bookings" : asked === "mywork" || asked === "desk" ? "queue" : asked) as View | null;
    return wanted && VIEWS.includes(wanted) ? wanted : "queue";
  });
  const [help, setHelp] = useState<string | null>(null);
  const [showMemberChats, setShowMemberChats] = useState(false);
  const detailRef = useRef<HTMLElement>(null);
  const [firstWeek, setFirstWeek] = useFirstWeek(ops.canManage);
  const selectedId = ops.selected?.id;
  // On phones and tablets the detail sits under the queue, so bring it into view when an item opens.
  useEffect(() => {
    if (!selectedId || window.innerWidth >= 1024) return;
    detailRef.current?.scrollIntoView?.({ block: "start" });
  }, [selectedId]);
  const {
    token,
    authLoading,
    departmentsForUser,
    canManage,
    userId,
    items,
    selected,
    requestContext,
    disputeCase,
    memberConversationContext,
    businessConversationContext,
    handoffContext,
    flowContext,
    payments,
    sourcingCandidates,
    busy,
    error,
    notice,
    setNotice,
    processingDueSchedules,
    refresh,
    processDueSchedules,
  } = ops;
  const steps = useMemo(
    () =>
      selected
        ? playbookSteps({
            item: selected,
            userId,
            canManage,
            request: requestContext,
            candidates: sourcingCandidates.length,
            payments,
            flow: flowContext,
            memberConversation: memberConversationContext,
            businessConversation: businessConversationContext,
            handoff: handoffContext,
            dispute: disputeCase,
          })
        : [],
    [
      selected,
      userId,
      canManage,
      requestContext,
      sourcingCandidates.length,
      payments,
      flowContext,
      memberConversationContext,
      businessConversationContext,
      handoffContext,
      disputeCase,
    ],
  );
  function openView(next: View) {
    setView(next);
    if (next === "archive" || next === "queue") {
      const listView = next === "archive" ? "archive" : "active";
      if (ops.listView !== listView) {
        ops.setSelected(null);
        ops.setListView(listView);
      }
      // The archive looks across every desk this person can see.
      if (next === "archive" && (ops.scope === "desk" || ops.filterDepartment)) {
        ops.setScope(canManage ? "all" : "available");
        ops.setFilterDepartment("");
        ops.setFilterStage("");
      }
    }
  }
  const storeTeam = canManage || departmentsForUser.includes("store_team");
  const tourTeam = canManage || departmentsForUser.includes("member_support");
  // The rail (R2): My work, one desk per department this person works on, then the shared pages.
  const desks = useDesks(token, items);
  const onDesk = view === "queue" && (ops.scope === "desk" || ops.scope === "available") && Boolean(ops.filterDepartment);
  const deskDepartment = onDesk ? (ops.filterDepartment as Department) : null;
  const activeRail = view !== "queue" ? view : deskDepartment ? `desk:${deskDepartment}` : "mywork";
  const myDesks = DESK_ORDER.filter((department) => canManage || departmentsForUser.includes(department));
  const deskSummary = (department: Department) => desks?.desks.find((desk) => desk.department === department);
  const railEntries: RailEntry[] = [
    { id: "mywork", label: "My work", group: "home", badge: desks?.mine, urgent: Boolean(desks?.mine_overdue) },
    ...myDesks.flatMap((department): RailEntry[] => {
      const summary = deskSummary(department);
      const entry: RailEntry = { id: `desk:${department}`, label: DESK_LABEL[department], group: "desks", badge: summary?.available, urgent: Boolean(summary?.overdue) };
      if (department === "store_team" && storeTeam) return [entry, { id: "products", label: "Products", group: "desks", sub: true }];
      if (department === "member_support" && tourTeam) return [entry, { id: "bookings", label: "Bookings and tours", group: "desks", sub: true }];
      return [entry];
    }),
    ...(tourTeam ? [] : [{ id: "bookings", label: "Bookings", group: "shared" } as RailEntry]),
    { id: "schedule", label: "Schedule", group: "shared" },
    { id: "archive", label: "Archive", group: "shared" },
    { id: "guide", label: "Guide", group: "shared" },
    ...(canManage
      ? ([
          { id: "team", label: "Team", group: "admin" },
          { id: "reports", label: "Reports", group: "admin" },
        ] as RailEntry[])
      : []),
  ];
  function openRail(id: string) {
    if (id === "mywork" || id.startsWith("desk:")) {
      const department = id.startsWith("desk:") ? id.slice(5) : "";
      setView("queue");
      if (ops.listView !== "active") ops.setListView("active");
      if (activeRail !== id) ops.setSelected(null);
      ops.setScope(department ? "desk" : "mine");
      ops.setFilterDepartment(department);
      ops.setFilterStage("");
      ops.setFilterStatus("");
      return;
    }
    openView(id as View);
  }
  // Keep the address in step with the rail so a desk can be bookmarked or shared.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", view === "queue" ? (deskDepartment ? "desk" : "mywork") : view);
    if (deskDepartment) url.searchParams.set("desk", deskDepartment);
    else url.searchParams.delete("desk");
    if (url.toString() !== window.location.href) window.history.replaceState(null, "", url.toString());
  }, [view, deskDepartment]);
  const sourcingOverview = useSourcingOverview(token, deskDepartment === "sourcing", items);
  const supportOverview = useSupportOverview(token, deskDepartment === "member_support", items);
  const storeOverview = useStoreOverview(token, deskDepartment === "store_team", items);
  function deskTools(department: Department) {
    const summary = deskSummary(department);
    const stageCount = (key: string) => summary?.stages.find((stage) => stage.key === key)?.count ?? 0;
    if (department === "conversation_intake")
      return (
        <>
          <ToolCard
            title="Member app chats"
            line="Every chat in the FayFort app, also the ones the AI is handling. Take one over when a member needs a person."
            count={stageCount("member_app")}
            countLabel="waiting for a person"
            onOpen={() => setShowMemberChats((value) => !value)}
            openLabel={showMemberChats ? "Hide the chats" : "Browse all chats"}
            fullHref={canManage ? "/?page=conversations" : undefined}
          />
          <ToolCard title="Customer chats" line="Instagram, Messenger and website customers the AI handed to a person." count={stageCount("customer")} countLabel="waiting" onOpen={() => ops.setFilterStage("customer")} openLabel="Show them" />
          {/* With a chat open, Answers sits beside it in the customer card instead. */}
          {!(selected && isChatItem(selected)) && <AnswersSearch ops={ops} />}
        </>
      );
    if (department === "store_team")
      return (
        <>
          <NextDropCard data={storeOverview} onOpen={() => openOperationsHref("/operations?view=products&tab=finds")} />
          <ListingsCard data={storeOverview} onOpen={() => openOperationsHref("/operations?view=products&tab=listings")} />
          <ComingUpCard data={storeOverview} onOpen={() => openRail("schedule")} />
          {storeTeam && <ToolCard title="Products" line="The store, sourcing items, listings in progress, Finds and sections." onOpen={() => openRail("products")} openLabel="Open Products" />}
        </>
      );
    if (department === "member_support")
      return token ? (
        <>
          <BookingsTodayCard token={token} enabled={deskDepartment === "member_support"} reloadKey={items} onOpen={() => openRail("bookings")} />
          <InvoicesCard data={supportOverview} onOpen={openWorkItem} />
          <GiveawaysCard data={supportOverview} onOpen={openWorkItem} />
        </>
      ) : null;
    if (department === "sourcing")
      return (
        <>
          {token && <TrendsCard token={token} trends={sourcingOverview.data?.trends || []} onChanged={sourcingOverview.reload} />}
          <DepositsCard deposits={sourcingOverview.data?.deposits_due || []} onOpen={openWorkItem} />
          <ToolCard title="Sourcing batches" line="Requests for the same item, researched once." count={ops.sourcingBatches.length} countLabel="open">
            {ops.sourcingBatches.length > 0 && (
              <ul>
                {ops.sourcingBatches.slice(0, 3).map((batch) => (
                  <li key={batch.id}>
                    {batch.title} · {batch.items.length} requests
                  </li>
                ))}
              </ul>
            )}
          </ToolCard>
          {token && <CatalogCard token={token} />}
        </>
      );
    if (department === "fulfillment")
      return token ? (
        <>
          <OrdersCard token={token} enabled={deskDepartment === "fulfillment"} reloadKey={items} canManage={canManage} onOpen={openWorkItem} />
          <ToolCard title="Sourced requests" line="Paid member requests: buy, receive at the warehouse, ship." count={stageCount("confirmed") + stageCount("warehouse")} countLabel="to move" onOpen={() => ops.setFilterStage("confirmed")} openLabel="Show confirmed" />
        </>
      ) : null;
    return null;
  }
  function openWorkItem(id: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("workItem", id);
    url.searchParams.delete("view");
    window.history.replaceState(null, "", url.toString());
    openView("queue");
    const found = ops.items.find((item) => item.id === id);
    if (found) ops.setSelected(found);
    else if (token) void refresh(token);
  }
  function openOperationsHref(href: string) {
    const url = new URL(href, window.location.origin);
    window.history.replaceState(null, "", url.pathname + url.search);
    const next = url.searchParams.get("view") as View | null;
    if (next && VIEWS.includes(next)) openView(next);
  }
  const params = new URLSearchParams(window.location.search);
  const finished = selected ? ["completed", "cancelled"].includes(selected.status) : false;
  // Doing the work needs it claimed by you, administrators included; they can still change status and route work.
  const owner = Boolean(selected && selected.assigned_worker_id === userId && ["claimed", "waiting"].includes(selected.status));
  const source = selected?.metadata?.source_kind as string | undefined;
  const guideKey = selected ? guideKeyFor(selected) : "";
  const openHelp = () => setHelp(guideKey || "glossary");
  return (
    <ShiftGate accessToken={token || ""} required={Boolean(token) && ops.identityLoaded && !canManage} pending={Boolean(token) && !ops.identityLoaded && !error}>
    <main className="operations-center-page">
      <header className="ops-head">
        <div className="ops-head-top">
          <div className="ops-head-title">
            {canManage ? (
              <a className="ops-crumb" href="/">
                ← Control Center
              </a>
            ) : (
              <a className="ops-crumb" href="/?page=account">
                My account
              </a>
            )}
            <h1>Operations Center</h1>
            <p>Every piece of staff work in one place, step by step.</p>
          </div>
          {token && (
            <div className="ops-head-actions">
              <ShiftControl accessToken={token} />
              {!canManage && <ChatAvailability accessToken={token} />}
              <OperationsNotifications accessToken={token} />
              <StaffThemeToggle theme={staffTheme} onChange={setStaffTheme} className="ops-head-button staff-theme-toggle" />
              <button
                type="button"
                className="ops-head-button"
                onClick={() => {
                  setNotice("");
                  void refresh(token);
                }}
                disabled={busy}
                title="Load the latest work"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" />
                </svg>
                <span>Refresh</span>
              </button>
            </div>
          )}
        </div>
      </header>
      {authLoading ? (
        <FayfortLoader label="Checking your FayFort staff sign-in…" />
      ) : !token ? (
        <section className="operations-empty">
          <h2>Staff sign-in required</h2>
          <p>Sign in with an active FayFort worker or platform administrator account.</p>
          <a href="/">Open Control Center sign-in</a>
        </section>
      ) : error && items.length === 0 && view === "queue" && !ops.identityLoaded ? (
        <section className="operations-empty">
          <h2>Operations Center unavailable</h2>
          <p role="alert">{error}</p>
          <a href="/">Return to Control Center</a>
        </section>
      ) : (
        <div className="ops-shell">
          <OpsRail entries={railEntries} active={activeRail} onOpen={openRail} />
          <div className="ops-shell-main">
          {canManage && view === "team" && <WorkforcePanel ops={ops} />}
          {canManage && view === "reports" && <ReportsPanel ops={ops} />}
          {canManage && view === "reports" && <AutomationActivity ops={ops} />}
          {canManage && view === "reports" && (
            <section className="ops-maintenance" aria-label="Maintenance">
              <div>
                <strong>Recurring orders</strong>
                <p>Due recurring requests are created automatically. Use this only to catch up after an outage.</p>
              </div>
              <button type="button" className="secondary-button" onClick={() => void processDueSchedules()} disabled={processingDueSchedules}>
                {processingDueSchedules ? "Processing due requests…" : "Run due recurring requests now"}
              </button>
            </section>
          )}
          {view === "guide" && <GuideTab firstWeek={firstWeek} setFirstWeek={setFirstWeek} />}
          {view === "products" && storeTeam && <PageHelp id="ops/products" guide={toPageGuide(TOOL_GUIDES.products_workspace)} />}
          {view === "schedule" && <PageHelp id="ops/schedule" guide={toPageGuide(TOOL_GUIDES.schedule)} />}
          {view === "products" && storeTeam && (
            <ProductsWorkspace
              key={params.get("listing") || params.get("tab") || "products"}
              token={token}
              canManage={canManage}
              initialTab={(["store", "sourcing", "listings", "sections", "finds"].includes(params.get("tab") || "") ? params.get("tab") : params.get("listing") ? "listings" : "store") as "store"}
              initialListing={params.get("listing")}
              onOpenWorkItem={openWorkItem}
            />
          )}
          {view === "bookings" && token && (
            <BookingsPanel
              token={token}
              tourTeam={tourTeam}
              initialTab={params.get("view") === "tours" || params.get("tab") === "tours" ? "tours" : undefined}
              initialBooking={params.get("booking")}
              onOpenWorkItem={openWorkItem}
            />
          )}
          {view === "schedule" && (
            <SchedulePanel
              token={token}
              canManage={canManage}
              myDepartments={departmentsForUser}
              onOpenWorkItem={openWorkItem}
              onOpenProducts={openOperationsHref}
            />
          )}
          {(view === "queue" || view === "archive") && (
            <>
              {view === "queue" && deskDepartment && (
                <DeskHeader
                  key={deskDepartment}
                  department={deskDepartment}
                  summary={deskSummary(deskDepartment)}
                  stage={ops.filterStage}
                  onStage={ops.setFilterStage}
                  tools={deskTools(deskDepartment)}
                />
              )}
              {view === "queue" && deskDepartment === "conversation_intake" && showMemberChats && token && (
                <section className="ops-desk-head ops-member-chats" aria-label="All member app chats">
                  <MemberChatsPanel accessToken={token} />
                </section>
              )}
              {view === "queue" && !deskDepartment && <MyWorkHome desks={desks} onOpenDesk={(department) => openRail(`desk:${department}`)} />}
              {view === "queue" ? <QueueFilters ops={ops} /> : <ArchiveControls ops={ops} />}
              {(error || notice) && (
                <div className={`ops-flash ${error ? "is-error" : "is-ok"}`} role={error ? "alert" : "status"}>
                  <span>{error || notice}</span>
                  {!error && (
                    <button type="button" aria-label="Dismiss message" onClick={() => setNotice("")}>
                      ×
                    </button>
                  )}
                </div>
              )}
              {view === "queue" && ops.batchWorkIds.length > 0 && <SourcingBatchForm ops={ops} />}
              <div className={`operations-center-grid${selected && isChatItem(selected) ? " has-customer" : ""}`}>
                <WorkList ops={ops} />
                <section className="operations-work-detail" aria-label="Selected work details" ref={detailRef}>
                  {!selected ? (
                    <div className="operations-empty">
                      <h2>{view === "archive" ? "Pick finished work to look back at" : deskDepartment ? `Pick work from ${DESK_LABEL[deskDepartment]}` : "Pick a work item"}</h2>
                      <p>
                        {view === "archive"
                          ? "Finished work keeps its full history here. It can't be changed; an administrator can reopen it."
                          : "Open an item from the queue. The steps bar shows where it is and what to do now."}
                      </p>
                      {view === "queue" && (
                        <ol className="ops-pick-order" aria-label="Which work to pick first">
                          <li><strong>Overdue first.</strong> Red cards marked Overdue have passed their deadline.</li>
                          <li><strong>Then anything waiting for a person:</strong> chats and handoffs, because a customer is sitting there.</li>
                          <li><strong>Then the oldest open item</strong> in your departments. Claim it so nobody doubles up.</li>
                          <li><strong>Waiting cards can wait.</strong> The next move is someone else's; they come back by themselves.</li>
                        </ol>
                      )}
                      <button type="button" className="secondary-button" onClick={() => setView("guide")}>
                        New here? Read the guide
                      </button>
                    </div>
                  ) : (
                    <>
                      <button type="button" className="operations-back-to-queue" onClick={() => ops.setSelected(null)}>
                        ← Back to the {view === "archive" ? "archive" : "queue"}
                      </button>
                      <div className="operations-section-title">
                        <div>
                          <small>
                            {departmentLabel[selected.department]} · {GUIDES[guideKey]?.title || readable(selected.work_type)}
                          </small>
                          <h2>{selected.summary}</h2>
                        </div>
                        <span className={`operations-status status-${selected.status}`}>{statusLabel(selected.status)}</span>
                        <button type="button" className="ops-help-button" aria-label="How this work is done" title="How this work is done" onClick={openHelp}>
                          ?
                        </button>
                      </div>
                      <p className="operations-source">
                        {selected.member_request_id ? (
                          <>
                            From a member request <ShortId id={selected.member_request_id} label="Request" />
                          </>
                        ) : selected.work_type === "dispute_case" ? (
                          "Dispute case linked to a member request"
                        ) : selected.member_conversation_id ? (
                          <>
                            From a member chat <ShortId id={selected.member_conversation_id} label="Chat" />
                          </>
                        ) : selected.handoff_id ? (
                          <>
                            From a customer handoff <ShortId id={selected.handoff_id} label="Handoff" />
                          </>
                        ) : selected.business_conversation_id ? (
                          <>
                            From a customer chat <ShortId id={selected.business_conversation_id} label="Chat" />
                          </>
                        ) : source ? (
                          SOURCE_LABEL[source] || "From the shop"
                        ) : (
                          "Created by staff"
                        )}
                        {selected.completed_at && finished && <> · finished {new Date(selected.completed_at).toLocaleString()}</>}
                      </p>
                      <PlaybookPanel ops={ops} selected={selected} steps={steps} firstWeek={firstWeek} onHelp={openHelp} />
                      {finished && canManage && <ReopenForm ops={ops} />}
                      {!finished && <DeadlinePanel ops={ops} selected={selected} onHelp={openHelp} />}

                      {/* 1. The work itself */}
                      {requestContext && (
                        <div id="ops-request">
                          <RequestContextPanel ops={ops} selected={selected} requestContext={requestContext} />
                          {selected.department === "sourcing" && !finished && (
                            <RequestStagePanel ops={ops} selected={selected} />
                          )}
                        </div>
                      )}
                      {requestContext && selected.department === "sourcing" && <BatchPanel ops={ops} selected={selected} />}
                      {requestContext && selected.department === "sourcing" && (
                        <div id="ops-candidates">
                          <SourcingCandidatesPanel ops={ops} selected={selected} requestContext={requestContext} />
                        </div>
                      )}
                      {requestContext && selected.department === "sourcing" && owner && sourcingCandidates.length > 0 && !finished && (
                        <div id="ops-share">
                          <ShareOptionsForm ops={ops} selected={selected} requestContext={requestContext} />
                        </div>
                      )}
                      {selected.member_request_id && selected.department === "sourcing" && (
                        <OpsSection id="ops-payments" title="Payments" onHelp={openHelp}>
                          <PaymentsPanel ops={ops} selected={selected} />
                        </OpsSection>
                      )}
                      {requestContext &&
                        selected.member_request_id &&
                        selected.department === "fulfillment" &&
                        selected.status === "claimed" &&
                        selected.assigned_worker_id === userId && (
                          <div id="ops-fulfillment">
                            <FulfillmentPanel ops={ops} selected={selected} requestContext={requestContext} />
                          </div>
                        )}
                      {requestContext && selected.department === "fulfillment" && selected.assigned_worker_id !== userId && !finished && (
                        <p className="operations-muted" id="ops-fulfillment">
                          {canManage ? "Workers record fulfillment milestones after claiming." : "Claim this work to record milestones."}
                        </p>
                      )}
                      {token && isDisputeItem(selected) && <CaseFile token={token} item={selected} />}
                      {disputeCase && (
                        <div id="ops-dispute">
                          <DisputeCasePanel ops={ops} selected={selected} disputeCase={disputeCase} />
                        </div>
                      )}
                      {source && (
                        <OpsSection id="ops-flow" title={GUIDES[guideKey]?.title || "Details"} onHelp={openHelp}>
                          <FlowPanel ops={ops} selected={selected} />
                        </OpsSection>
                      )}

                      {/* 2. The conversation */}
                      {(memberConversationContext || handoffContext || businessConversationContext) && (
                        <div id="ops-chat">
                          {memberConversationContext && (
                            <MemberConversationPanel ops={ops} selected={selected} memberConversationContext={memberConversationContext} />
                          )}
                          {handoffContext && <HandoffPanel ops={ops} selected={selected} handoffContext={handoffContext} />}
                          {businessConversationContext && (
                            <BusinessConversationPanel
                              ops={ops}
                              selected={selected}
                              businessConversationContext={businessConversationContext}
                            />
                          )}
                        </div>
                      )}
                      {selected.member_conversation_id && !memberConversationContext && !canManage && selected.assigned_worker_id !== userId && (
                        <p className="operations-muted" id="ops-chat">
                          Claim this work item to open its private member conversation.
                        </p>
                      )}
                      {selected.business_id && (businessConversationContext?.id || selected.business_conversation_id) && (
                        <p>
                          <a
                            className="secondary-button"
                            href={`/?operationsBusiness=${encodeURIComponent(selected.business_id)}&operationsConversation=${encodeURIComponent(businessConversationContext?.id || selected.business_conversation_id || "")}`}
                          >
                            Open in Conversations
                          </a>
                        </p>
                      )}

                      {/* 3. Status, transfer, dispute */}
                      {!finished && !selected.handoff_id && (
                        <OpsSection id="ops-status" title="Update status" collapsible defaultOpen={false} onHelp={() => setHelp("glossary")}>
                          {owner || canManage ? (
                            <WorkActionForm ops={ops} selected={selected} />
                          ) : (
                            <p className="operations-muted">Claim this work item before changing its status or next action.</p>
                          )}
                          {(canManage ||
                            (selected.assigned_worker_id === userId &&
                              departmentsForUser.some((department) => department !== selected.department))) && (
                            <TransferForm ops={ops} selected={selected} />
                          )}
                          {requestContext &&
                            selected.member_request_id &&
                            !selected.dispute_case_id &&
                            owner &&
                            (canManage || departmentsForUser.includes("disputes")) && (
                              <DisputeCreateForm ops={ops} selected={selected} requestContext={requestContext} />
                            )}
                        </OpsSection>
                      )}

                      {/* 4. Your notes */}
                      <OpsSection title="Checklist and notes" collapsible defaultOpen={!finished}>
                        <ChecklistPanel ops={ops} selected={selected} />
                        <NotesPanel ops={ops} selected={selected} />
                      </OpsSection>

                      {/* 5. What happened */}
                      <OpsSection title="History" collapsible defaultOpen={finished}>
                        <WorkHistory ops={ops} selected={selected} />
                      </OpsSection>
                    </>
                  )}
                </section>
                {selected && isChatItem(selected) && <CustomerPane ops={ops} selected={selected} />}
              </div>
            </>
          )}
          </div>
        </div>
      )}
      {help && <HelpSheet guideKey={help} onClose={() => setHelp(null)} />}
    </main>
    </ShiftGate>
  );
}
