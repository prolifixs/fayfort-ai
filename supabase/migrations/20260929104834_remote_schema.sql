SET local check_function_bodies = off;

CREATE EXTENSION "vector" SCHEMA "public";

CREATE TABLE "public"."business_members" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "business_id" uuid                     NOT NULL,
  "user_id"     uuid                     NOT NULL,
  "role"        text                     NOT NULL DEFAULT 'member'::text,
  "status"      text                     NOT NULL DEFAULT 'active'::text,
  "joined_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "business_members_business_user_unique" UNIQUE (business_id, user_id),
  CONSTRAINT "business_members_pkey" PRIMARY KEY (id),
  CONSTRAINT "business_members_role_check" CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text]))),
  CONSTRAINT "business_members_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);

CREATE TABLE "public"."businesses" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"        text                     NOT NULL,
  "slug"        text                     NOT NULL,
  "description" text,
  "status"      text                     NOT NULL DEFAULT 'active'::text,
  "settings"    jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "businesses_pkey" PRIMARY KEY (id),
  CONSTRAINT "businesses_slug_key" UNIQUE (slug),
  CONSTRAINT "businesses_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'suspended'::text])))
);

CREATE TABLE "public"."conversation_actions" (
  "id"                    uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id"       uuid                     NOT NULL,
  "intent_id"             uuid,
  "action_key"            text                     NOT NULL,
  "status"                text                     NOT NULL DEFAULT 'pending'::text,
  "input"                 jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "result"                jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "error"                 text,
  "requires_confirmation" boolean                  NOT NULL DEFAULT false,
  "confirmed_at"          timestamp with time zone,
  "started_at"            timestamp with time zone,
  "completed_at"          timestamp with time zone,
  "created_at"            timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"            timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "conversation_actions_pkey" PRIMARY KEY (id)
);

CREATE TABLE "public"."conversation_intents" (
  "id"                     uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id"        uuid                     NOT NULL,
  "intent_key"             text                     NOT NULL,
  "intent_status"          text                     NOT NULL DEFAULT 'active'::text,
  "goal"                   text,
  "entities"               jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "required_information"   jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "missing_information"    jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "confidence"             numeric(5,4),
  "customer_confirmed"     boolean                  NOT NULL DEFAULT false,
  "confirmation_requested" boolean                  NOT NULL DEFAULT false,
  "source_message_id"      uuid,
  "metadata"               jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "created_at"             timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"             timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "conversation_intents_pkey" PRIMARY KEY (id)
);

CREATE TABLE "public"."conversations" (
  "id"                   uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "business_id"          uuid                     NOT NULL,
  "customer_external_id" text                     NOT NULL,
  "channel"              text                     NOT NULL,
  "status"               text                     NOT NULL DEFAULT 'open'::text,
  "created_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "last_message_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "summary"              text,
  CONSTRAINT "conversations_pkey" PRIMARY KEY (id)
);

CREATE TABLE "public"."knowledge_chunks" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "document_id" uuid                     NOT NULL,
  "chunk_index" integer                  NOT NULL,
  "content"     text                     NOT NULL,
  "metadata"    jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY (id)
);

CREATE TABLE "public"."knowledge_documents" (
  "id"          uuid                        NOT NULL DEFAULT gen_random_uuid(),
  "title"       text                        NOT NULL,
  "source"      text,
  "content"     text                        NOT NULL,
  "metadata"    jsonb                       NOT NULL DEFAULT '{}'::jsonb,
  "status"      text                        NOT NULL DEFAULT 'active'::text,
  "created_at"  timestamp without time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp without time zone NOT NULL DEFAULT now(),
  "business_id" uuid,
  "source_type" text,
  "source_url"  text,
  CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY (id)
);

CREATE TABLE "public"."messages" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id"     uuid                     NOT NULL,
  "external_message_id" text,
  "sender_type"         text                     NOT NULL,
  "content"             text                     NOT NULL,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "messages_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."business_members"
  ADD CONSTRAINT "business_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."business_members"
  ADD CONSTRAINT "business_members_business_id_fkey" FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;

ALTER TABLE "public"."conversation_actions"
  ADD CONSTRAINT "conversation_actions_intent_id_fkey" FOREIGN KEY (intent_id) REFERENCES public.conversation_intents(id) ON DELETE SET NULL;

ALTER TABLE "public"."conversations"
  ADD CONSTRAINT "conversations_business_id_fkey" FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;

ALTER TABLE "public"."conversation_actions"
  ADD CONSTRAINT "conversation_actions_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

ALTER TABLE "public"."conversation_intents"
  ADD CONSTRAINT "conversation_intents_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

ALTER TABLE "public"."knowledge_documents"
  ADD CONSTRAINT "knowledge_documents_business_id_fkey" FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;

ALTER TABLE "public"."knowledge_chunks"
  ADD CONSTRAINT "knowledge_chunks_document_id_fkey" FOREIGN KEY (document_id) REFERENCES public.knowledge_documents(id) ON DELETE CASCADE;

ALTER TABLE "public"."messages"
  ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

ALTER TABLE "public"."conversation_intents"
  ADD CONSTRAINT "conversation_intents_source_message_id_fkey" FOREIGN KEY (source_message_id) REFERENCES public.messages(id) ON DELETE SET NULL;

CREATE INDEX conversations_business_id_idx ON public.conversations USING btree (business_id);

CREATE INDEX conversations_customer_idx ON public.conversations USING btree (business_id, customer_external_id, channel);

CREATE INDEX conversations_last_message_idx ON public.conversations USING btree (last_message_at DESC);

CREATE INDEX idx_business_members_business_id ON public.business_members USING btree (business_id);

CREATE INDEX idx_business_members_role ON public.business_members USING btree (ROLE);

CREATE INDEX idx_business_members_status ON public.business_members USING btree (status);

CREATE INDEX idx_business_members_user_id ON public.business_members USING btree (user_id);

CREATE INDEX idx_businesses_created_at ON public.businesses USING btree (created_at);

CREATE INDEX idx_businesses_status ON public.businesses USING btree (status);

CREATE INDEX idx_conversation_actions_conversation_id ON public.conversation_actions USING btree (conversation_id);

CREATE INDEX idx_conversation_actions_intent_id ON public.conversation_actions USING btree (intent_id);

CREATE INDEX idx_conversation_actions_status ON public.conversation_actions USING btree (status);

CREATE INDEX idx_conversation_intents_conversation_id ON public.conversation_intents USING btree (conversation_id);

CREATE INDEX idx_conversation_intents_status ON public.conversation_intents USING btree (intent_status);

CREATE INDEX idx_knowledge_documents_source ON public.knowledge_documents USING btree (source);

CREATE INDEX idx_knowledge_documents_status ON public.knowledge_documents USING btree (status);

CREATE INDEX knowledge_chunks_document_chunk_index_idx ON public.knowledge_chunks USING btree (document_id, chunk_index);

CREATE INDEX knowledge_chunks_document_id_idx ON public.knowledge_chunks USING btree (document_id);

CREATE INDEX knowledge_documents_business_id_idx ON public.knowledge_documents USING btree (business_id);

COMMENT ON EXTENSION "vector" IS 'vector data type and ivfflat and hnsw access methods';

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."business_members" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."businesses" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."conversation_actions" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."conversation_intents" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."conversations" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."knowledge_chunks" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."knowledge_documents" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."messages" TO "anon", "authenticated", "postgres", "service_role";

