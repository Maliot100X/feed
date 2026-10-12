-- Additive reconciliation for the restored production database.
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
-- PostgreSQL database dump complete
--


ALTER TYPE public.message_type ADD VALUE IF NOT EXISTS 'coordinator';
COMMIT;
