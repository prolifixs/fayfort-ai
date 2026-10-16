export type RequestEvent = {
  id: string;
  sequence_no: number;
  stage: string;
  member_note: string | null;
  details?: { carrier_name?: string; tracking_number?: string; tracking_url?: string };
  media?: {
    id: string;
    url: string;
    content_type: string;
    byte_size: number;
    original_filename: string;
    created_at: string;
  }[];
  created_at: string;
};

export type RequestSourceMedia = {
  id: string;
  url: string;
  content_type: string;
  byte_size: number;
  original_filename: string;
  created_at: string;
};

export function RequestSourceSummary({
  sourceType,
  sourceUrl,
  sourceMedia,
  productName,
}: {
  sourceType?: string;
  sourceUrl?: string | null;
  sourceMedia?: RequestSourceMedia[];
  productName?: string | null;
}) {
  const source = sourceType || "description";
  return (
    <section className="member-request-source-summary" aria-label="Request source">
      <strong>
        {source === "saved_product"
          ? "Saved product"
          : source === "catalog_product"
            ? "Catalog product"
            : source === "url"
              ? "Product link"
              : source === "image"
                ? "Product screenshot"
                : "Request description"}
      </strong>
      {productName && <p>{productName}</p>}
      {sourceUrl && (
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
          Open product link
        </a>
      )}
      {sourceMedia?.map((media) => (
        <figure key={media.id}>
          <a href={media.url} target="_blank" rel="noopener noreferrer">
            <img src={media.url} alt={media.original_filename} />
          </a>
          <figcaption>{media.original_filename}</figcaption>
        </figure>
      ))}
    </section>
  );
}

export type MemberSourcingOption = {
  id: string;
  product_name: string;
  product_url: string;
  price_amount: number | null;
  currency: string | null;
  availability: string | null;
  member_note: string | null;
  status: "offered" | "selected";
  selected_at: string | null;
  created_at: string;
};

export type MemberRequestRow = {
  id: string;
  product_id: string | null;
  product_name_snapshot: string | null;
  request_title: string;
  request_description: string | null;
  source_type?: string;
  source_url?: string | null;
  source_media?: RequestSourceMedia[];
  sourcing_options?: MemberSourcingOption[];
  created_at: string;
  events: RequestEvent[];
};

export const requestStageLabels: Record<string, string> = {
  submitted: "Request received",
  under_review: "Under review",
  sourcing: "Sourcing",
  needs_member_input: "Your input is needed",
  options_sent: "Options sent",
  purchase_confirmed: "Purchase confirmed · paid",
  item_in_warehouse: "At FayFort warehouse",
  shipped: "Shipped",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const requestProgressStages = [
  "submitted",
  "under_review",
  "sourcing",
  "item_in_warehouse",
  "shipped",
  "in_transit",
  "out_for_delivery",
  "delivered",
];

export const requestStageDescriptions: Record<string, string> = {
  submitted: "We received your request and saved the details.",
  under_review: "Our team is checking the request and confirming what is needed.",
  sourcing: "We are contacting suppliers and comparing suitable options.",
  needs_member_input: "We need a detail from you before sourcing can continue.",
  options_sent: "Options are ready for you to review.",
  purchase_confirmed: "Payment is confirmed. The item can now move to the warehouse.",
  item_in_warehouse: "The item has arrived at FayFort. A team member may add inspection photos or video.",
  shipped: "The item has left the warehouse. Carrier and tracking details appear with this update.",
  in_transit: "The carrier is moving your shipment toward its destination.",
  out_for_delivery: "The carrier expects to deliver the shipment soon.",
  delivered: "Delivery is marked complete.",
  cancelled: "This request has been cancelled.",
};

export const requestStageIcons: Record<string, string> = {
  submitted: "M5 4h14v16H5z M8 8h8 M8 11h6 M12 17v-4m0 4-2-2m2 2 2-2",
  under_review: "M10.5 4.5a6 6 0 1 0 0 12 6 6 0 0 0 0-12 M15 15l5 5",
  sourcing: "M4 7h7 M13 7l3-3m-3 3 3 3 M20 17h-7m-2 0-3-3m3 3-3 3 M7 7v10",
  item_in_warehouse: "M4 20V8l8-4 8 4v12z M4 8l8 4 8-4 M12 12v8 M8 6l8 4",
  shipped: "M5 7h9v12H5z M14 11h3l3 3v5h-6 M8 19h.01 M17 19h.01 M8 11h5m-2-2 2 2-2 2",
  in_transit: "M3 8h12v10H3z M15 11h4l3 3v4h-7 M7 18h.01 M18 18h.01",
  out_for_delivery: "M12 21s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12z M12 9a2 2 0 1 0 0 .01",
  delivered: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M8 12l2.5 2.5L16 9",
};

export function requestProgressIndex(stage: string) {
  if (["sourcing", "needs_member_input", "options_sent"].includes(stage)) return 2;
  if (stage === "purchase_confirmed") return 3;
  return Math.max(0, requestProgressStages.indexOf(stage));
}

export type WorkerRequestRow = {
  id: string;
  request_title: string;
  request_description: string | null;
  product_id?: string | null;
  product_name_snapshot: string | null;
  source_type?: string;
  source_url?: string | null;
  source_media?: RequestSourceMedia[];
  events: RequestEvent[];
};

export const requestNextStages: Record<string, string[]> = {
  submitted: ["under_review", "cancelled"],
  under_review: ["sourcing", "needs_member_input", "cancelled"],
  sourcing: ["needs_member_input", "options_sent", "purchase_confirmed", "item_in_warehouse", "cancelled"],
  needs_member_input: ["sourcing", "options_sent", "cancelled"],
  options_sent: ["purchase_confirmed", "cancelled"],
  purchase_confirmed: ["item_in_warehouse", "cancelled"],
  item_in_warehouse: ["shipped", "cancelled"],
  shipped: ["in_transit", "out_for_delivery", "delivered"],
  in_transit: ["out_for_delivery", "delivered"],
  out_for_delivery: ["delivered"],
};
