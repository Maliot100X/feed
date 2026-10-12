-- Additive reconciliation for the restored staging database.
-- Generated from the tested current schema; preserves all legacy tables and rows.
-- Apply only once after a verified empty-target restore. The restore is never altered in Neon.
BEGIN;
SET LOCAL lock_timeout = '10s';
--
-- PostgreSQL database dump
--


-- Dumped from database version 16.11 (Homebrew)
-- Dumped by pg_dump version 16.11 (Homebrew)

SET statement_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: FeedEvent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FeedEvent" (
    id text NOT NULL,
    "userId" text NOT NULL,
    surface text NOT NULL,
    "actionType" text NOT NULL,
    "itemId" text NOT NULL,
    "itemType" text NOT NULL,
    "clusterId" text,
    "marketId" text,
    "topicKey" text,
    "authorId" text,
    "feedPosition" integer,
    "dwellMs" integer,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: WalletTransferLimit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."WalletTransferLimit" (
    "userId" text NOT NULL,
    "dailyLimitUsd" numeric(18,2) DEFAULT 1000.00 NOT NULL,
    "dailySpentUsd" numeric(18,2) DEFAULT 0.00 NOT NULL,
    "lastResetAt" timestamp without time zone DEFAULT now() NOT NULL,
    "elevatedUntil" timestamp without time zone,
    "elevatedLimitUsd" numeric(18,2)
);


--
-- Name: WalletTransferLog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."WalletTransferLog" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "fromAddress" text NOT NULL,
    "toAddress" text NOT NULL,
    "tokenAddress" text,
    "tokenId" text,
    amount text NOT NULL,
    "txHash" text,
    "chainId" integer NOT NULL,
    status text NOT NULL,
    type text NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "confirmedAt" timestamp without time zone,
    "usdValueAtTime" numeric(18,2),
    "ipAddress" text
);


--
-- Name: WorldStateSnapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."WorldStateSnapshot" (
    id text NOT NULL,
    "windowId" character varying(50) NOT NULL,
    "packId" text,
    "gameDay" integer NOT NULL,
    "gameTime" timestamp without time zone NOT NULL,
    "predictionMarketsJson" text,
    "perpMarketsJson" text,
    "worldEventsJson" text,
    "activeStoriesJson" text,
    "insiderAssignmentsJson" text,
    "arcPhase" character varying(20),
    "arcPlanJson" text,
    "orgStatesJson" text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    server_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    name text NOT NULL,
    username text,
    system text DEFAULT ''::text,
    bio jsonb DEFAULT '[]'::jsonb,
    message_examples jsonb DEFAULT '[]'::jsonb NOT NULL,
    post_examples jsonb DEFAULT '[]'::jsonb NOT NULL,
    topics jsonb DEFAULT '[]'::jsonb NOT NULL,
    adjectives jsonb DEFAULT '[]'::jsonb NOT NULL,
    knowledge jsonb DEFAULT '[]'::jsonb NOT NULL,
    plugins jsonb DEFAULT '[]'::jsonb NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    style jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cache (
    key text NOT NULL,
    agent_id uuid NOT NULL,
    value jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone
);


--
-- Name: central_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.central_messages (
    id text NOT NULL,
    channel_id text NOT NULL,
    author_id text NOT NULL,
    content text NOT NULL,
    raw_message jsonb,
    in_reply_to_root_message_id text,
    source_type text,
    source_id text,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: channel_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.channel_participants (
    channel_id text NOT NULL,
    entity_id text NOT NULL
);


--
-- Name: channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.channels (
    id text NOT NULL,
    message_server_id uuid NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    source_type text,
    source_id text,
    topic text,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: components; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.components (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    room_id uuid NOT NULL,
    world_id uuid,
    source_entity_id uuid,
    type text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: entities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entities (
    id uuid NOT NULL,
    agent_id uuid NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    names text[] DEFAULT '{}'::text[] NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    entity_id uuid NOT NULL,
    body jsonb NOT NULL,
    type text NOT NULL,
    room_id uuid NOT NULL
);


--
-- Name: memories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memories (
    id uuid NOT NULL,
    type text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    content jsonb NOT NULL,
    entity_id uuid,
    agent_id uuid NOT NULL,
    room_id uuid,
    world_id uuid,
    "unique" boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT document_metadata_check CHECK (
CASE
    WHEN ((metadata ->> 'type'::text) = 'document'::text) THEN (metadata ? 'timestamp'::text)
    ELSE true
END),
    CONSTRAINT fragment_metadata_check CHECK (
CASE
    WHEN ((metadata ->> 'type'::text) = 'fragment'::text) THEN ((metadata ? 'documentId'::text) AND (metadata ? 'position'::text))
    ELSE true
END)
);


--
-- Name: message_server_agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_server_agents (
    message_server_id uuid NOT NULL,
    agent_id uuid NOT NULL
);


--
-- Name: message_servers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_servers (
    id uuid NOT NULL,
    name text NOT NULL,
    source_type text NOT NULL,
    source_id text,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    entity_id uuid,
    room_id uuid,
    agent_id uuid,
    room_state text
);


--
-- Name: relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.relationships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source_entity_id uuid NOT NULL,
    target_entity_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    tags text[],
    metadata jsonb
);


--
-- Name: rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rooms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id uuid,
    source text NOT NULL,
    type text NOT NULL,
    message_server_id uuid,
    world_id uuid,
    name text,
    metadata jsonb,
    channel_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    room_id uuid,
    world_id uuid,
    entity_id uuid,
    agent_id uuid NOT NULL,
    tags text[] DEFAULT '{}'::text[],
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: worlds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.worlds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id uuid NOT NULL,
    name text NOT NULL,
    metadata jsonb,
    message_server_id uuid,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: FeedEvent FeedEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FeedEvent"
    ADD CONSTRAINT "FeedEvent_pkey" PRIMARY KEY (id);


--
-- Name: WalletTransferLimit WalletTransferLimit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."WalletTransferLimit"
    ADD CONSTRAINT "WalletTransferLimit_pkey" PRIMARY KEY ("userId");


--
-- Name: WalletTransferLog WalletTransferLog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."WalletTransferLog"
    ADD CONSTRAINT "WalletTransferLog_pkey" PRIMARY KEY (id);


--
-- Name: WorldStateSnapshot WorldStateSnapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."WorldStateSnapshot"
    ADD CONSTRAINT "WorldStateSnapshot_pkey" PRIMARY KEY (id);


--
-- Name: agents agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_pkey PRIMARY KEY (id);


--
-- Name: cache cache_key_agent_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cache
    ADD CONSTRAINT cache_key_agent_id_pk PRIMARY KEY (key, agent_id);


--
-- Name: central_messages central_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.central_messages
    ADD CONSTRAINT central_messages_pkey PRIMARY KEY (id);


--
-- Name: channel_participants channel_participants_channel_id_entity_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_participants
    ADD CONSTRAINT channel_participants_channel_id_entity_id_pk PRIMARY KEY (channel_id, entity_id);


--
-- Name: channels channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channels
    ADD CONSTRAINT channels_pkey PRIMARY KEY (id);


--
-- Name: components components_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.components
    ADD CONSTRAINT components_pkey PRIMARY KEY (id);


--
-- Name: entities entities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entities
    ADD CONSTRAINT entities_pkey PRIMARY KEY (id);


--
-- Name: entities id_agent_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entities
    ADD CONSTRAINT id_agent_id_unique UNIQUE (id, agent_id);


--
-- Name: memories memories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memories
    ADD CONSTRAINT memories_pkey PRIMARY KEY (id);


--
-- Name: message_server_agents message_server_agents_message_server_id_agent_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_server_agents
    ADD CONSTRAINT message_server_agents_message_server_id_agent_id_pk PRIMARY KEY (message_server_id, agent_id);


--
-- Name: message_servers message_servers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_servers
    ADD CONSTRAINT message_servers_pkey PRIMARY KEY (id);


--
-- Name: participants participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT participants_pkey PRIMARY KEY (id);


--
-- Name: relationships relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relationships
    ADD CONSTRAINT relationships_pkey PRIMARY KEY (id);


--
-- Name: rooms rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: relationships unique_relationship; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relationships
    ADD CONSTRAINT unique_relationship UNIQUE (source_entity_id, target_entity_id, agent_id);


--
-- Name: worlds worlds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worlds
    ADD CONSTRAINT worlds_pkey PRIMARY KEY (id);


--
-- Name: FeedEvent_actionType_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FeedEvent_actionType_createdAt_idx" ON public."FeedEvent" USING btree ("actionType", "createdAt");


--
-- Name: FeedEvent_clusterId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FeedEvent_clusterId_createdAt_idx" ON public."FeedEvent" USING btree ("clusterId", "createdAt");


--
-- Name: FeedEvent_itemId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FeedEvent_itemId_createdAt_idx" ON public."FeedEvent" USING btree ("itemId", "createdAt");


--
-- Name: FeedEvent_surface_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FeedEvent_surface_createdAt_idx" ON public."FeedEvent" USING btree (surface, "createdAt");


--
-- Name: FeedEvent_topicKey_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FeedEvent_topicKey_createdAt_idx" ON public."FeedEvent" USING btree ("topicKey", "createdAt");


--
-- Name: FeedEvent_userId_surface_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FeedEvent_userId_surface_createdAt_idx" ON public."FeedEvent" USING btree ("userId", surface, "createdAt");


--
-- Name: WalletTransferLog_fromAddress_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "WalletTransferLog_fromAddress_idx" ON public."WalletTransferLog" USING btree ("fromAddress");


--
-- Name: WalletTransferLog_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "WalletTransferLog_status_idx" ON public."WalletTransferLog" USING btree (status);


--
-- Name: WalletTransferLog_toAddress_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "WalletTransferLog_toAddress_idx" ON public."WalletTransferLog" USING btree ("toAddress");


--
-- Name: WalletTransferLog_txHash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "WalletTransferLog_txHash_idx" ON public."WalletTransferLog" USING btree ("txHash");


--
-- Name: WalletTransferLog_userId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "WalletTransferLog_userId_createdAt_idx" ON public."WalletTransferLog" USING btree ("userId", "createdAt");


--
-- Name: WalletTransferLog_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "WalletTransferLog_userId_idx" ON public."WalletTransferLog" USING btree ("userId");


--
-- Name: idx_fragments_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fragments_order ON public.memories USING btree (((metadata ->> 'documentId'::text)), ((metadata ->> 'position'::text)));


--
-- Name: idx_memories_document_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memories_document_id ON public.memories USING btree (((metadata ->> 'documentId'::text)));


--
-- Name: idx_memories_metadata_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memories_metadata_type ON public.memories USING btree (((metadata ->> 'type'::text)));


--
-- Name: idx_memories_type_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memories_type_room ON public.memories USING btree (type, room_id);


--
-- Name: idx_memories_world_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memories_world_id ON public.memories USING btree (world_id);


--
-- Name: idx_participants_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_participants_room ON public.participants USING btree (room_id);


--
-- Name: idx_participants_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_participants_user ON public.participants USING btree (entity_id);


--
-- Name: idx_relationships_users; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_relationships_users ON public.relationships USING btree (source_entity_id, target_entity_id);


--
-- Name: world_state_snapshots_packId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "world_state_snapshots_packId_idx" ON public."WorldStateSnapshot" USING btree ("packId");


--
-- Name: world_state_snapshots_windowId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "world_state_snapshots_windowId_idx" ON public."WorldStateSnapshot" USING btree ("windowId");


--
-- Name: cache cache_agent_id_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cache
    ADD CONSTRAINT cache_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: central_messages central_messages_channel_id_channels_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.central_messages
    ADD CONSTRAINT central_messages_channel_id_channels_id_fk FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;


--
-- Name: central_messages central_messages_in_reply_to_root_message_id_central_messages_i; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.central_messages
    ADD CONSTRAINT central_messages_in_reply_to_root_message_id_central_messages_i FOREIGN KEY (in_reply_to_root_message_id) REFERENCES public.central_messages(id) ON DELETE SET NULL;


--
-- Name: channel_participants channel_participants_channel_id_channels_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_participants
    ADD CONSTRAINT channel_participants_channel_id_channels_id_fk FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;


--
-- Name: channels channels_message_server_id_message_servers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channels
    ADD CONSTRAINT channels_message_server_id_message_servers_id_fk FOREIGN KEY (message_server_id) REFERENCES public.message_servers(id) ON DELETE CASCADE;


--
-- Name: components components_agent_id_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.components
    ADD CONSTRAINT components_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: components components_entity_id_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.components
    ADD CONSTRAINT components_entity_id_entities_id_fk FOREIGN KEY (entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;


--
-- Name: components components_room_id_rooms_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.components
    ADD CONSTRAINT components_room_id_rooms_id_fk FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;


--
-- Name: components components_source_entity_id_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.components
    ADD CONSTRAINT components_source_entity_id_entities_id_fk FOREIGN KEY (source_entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;


--
-- Name: components components_world_id_worlds_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.components
    ADD CONSTRAINT components_world_id_worlds_id_fk FOREIGN KEY (world_id) REFERENCES public.worlds(id) ON DELETE CASCADE;


--
-- Name: entities entities_agent_id_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entities
    ADD CONSTRAINT entities_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: memories fk_agent; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memories
    ADD CONSTRAINT fk_agent FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: logs fk_room; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logs
    ADD CONSTRAINT fk_room FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;


--
-- Name: memories fk_room; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memories
    ADD CONSTRAINT fk_room FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;


--
-- Name: participants fk_room; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT fk_room FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;


--
-- Name: logs fk_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logs
    ADD CONSTRAINT fk_user FOREIGN KEY (entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;


--
-- Name: memories fk_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memories
    ADD CONSTRAINT fk_user FOREIGN KEY (entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;


--
-- Name: participants fk_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT fk_user FOREIGN KEY (entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;


--
-- Name: relationships fk_user_a; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relationships
    ADD CONSTRAINT fk_user_a FOREIGN KEY (source_entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;


--
-- Name: relationships fk_user_b; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relationships
    ADD CONSTRAINT fk_user_b FOREIGN KEY (target_entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;


--
-- Name: logs logs_entity_id_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logs
    ADD CONSTRAINT logs_entity_id_entities_id_fk FOREIGN KEY (entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;


--
-- Name: logs logs_room_id_rooms_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logs
    ADD CONSTRAINT logs_room_id_rooms_id_fk FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;


--
-- Name: memories memories_agent_id_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memories
    ADD CONSTRAINT memories_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: memories memories_entity_id_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memories
    ADD CONSTRAINT memories_entity_id_entities_id_fk FOREIGN KEY (entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;


--
-- Name: memories memories_room_id_rooms_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memories
    ADD CONSTRAINT memories_room_id_rooms_id_fk FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;


--
-- Name: message_server_agents message_server_agents_agent_id_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_server_agents
    ADD CONSTRAINT message_server_agents_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: message_server_agents message_server_agents_message_server_id_message_servers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_server_agents
    ADD CONSTRAINT message_server_agents_message_server_id_message_servers_id_fk FOREIGN KEY (message_server_id) REFERENCES public.message_servers(id) ON DELETE CASCADE;


--
-- Name: participants participants_agent_id_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT participants_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: participants participants_entity_id_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT participants_entity_id_entities_id_fk FOREIGN KEY (entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;


--
-- Name: participants participants_room_id_rooms_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT participants_room_id_rooms_id_fk FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;


--
-- Name: relationships relationships_agent_id_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relationships
    ADD CONSTRAINT relationships_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: relationships relationships_source_entity_id_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relationships
    ADD CONSTRAINT relationships_source_entity_id_entities_id_fk FOREIGN KEY (source_entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;


--
-- Name: relationships relationships_target_entity_id_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relationships
    ADD CONSTRAINT relationships_target_entity_id_entities_id_fk FOREIGN KEY (target_entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;


--
-- Name: rooms rooms_agent_id_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_agent_id_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: worlds worlds_agent_id_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worlds
    ADD CONSTRAINT worlds_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


ALTER TABLE public.trajectories ADD COLUMN "worldStateSnapshotId" text;
ALTER TABLE public.trajectories ADD COLUMN "packId" text;
ALTER TABLE public.trajectories ADD COLUMN "npcRole" varchar(20);
ALTER TABLE public.trajectories ADD COLUMN "questionIds" text;
ALTER TABLE public.trajectories ADD COLUMN "eventIds" text;
ALTER TABLE public.trajectories ADD COLUMN "arcPhase" varchar(20);
ALTER TABLE public.trajectories ADD COLUMN "memorySnapshotJson" text;
ALTER TABLE public.trajectories ADD COLUMN "relationshipSnapshotJson" text;
COMMIT;
