CREATE TYPE "public"."tikisse_scheduled_job_runs_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."tikisse_scheduled_job_runs_trigger" AS ENUM('schedule', 'manual');--> statement-breakpoint
CREATE TABLE "tikisse_scheduled_job_runs" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"jobName" varchar(60) NOT NULL,
	"slot" varchar(60) NOT NULL,
	"trigger" "tikisse_scheduled_job_runs_trigger" DEFAULT 'schedule' NOT NULL,
	"status" "tikisse_scheduled_job_runs_status" DEFAULT 'running' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"finishedAt" timestamp with time zone,
	"result" text,
	"error" varchar(500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tikisse_scheduled_job_runs_job_slot_unique" ON "tikisse_scheduled_job_runs" USING btree ("jobName","slot");--> statement-breakpoint
CREATE INDEX "tikisse_scheduled_job_runs_job_started_index" ON "tikisse_scheduled_job_runs" USING btree ("jobName","startedAt");--> statement-breakpoint
-- Comme toutes les tables : rien par l'API publique de Supabase (voir 0001).
ALTER TABLE "tikisse_scheduled_job_runs" ENABLE ROW LEVEL SECURITY;
