import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Multi-tenant ATS (applicant-tracking) schema for the analytics copilot.
 *
 * Every tenant-owned row carries a `workspaceId`. The application contract is
 * that every read and write is scoped to exactly one workspace (see
 * `src/server/context.ts`) — a cross-workspace leak is the worst bug here.
 *
 * `candidates` holds PII (name / email / phone). Reading those columns is
 * gated by role (see `src/db/permissions.ts`).
 */

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  // 'admin' | 'recruiter' | 'analyst' — see src/db/permissions.ts
  role: text("role").notNull(),
});

export const jobs = pgTable("jobs", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  title: text("title").notNull(),
  department: text("department").notNull(),
  location: text("location").notNull(),
  // 'open' | 'closed' | 'draft'
  status: text("status").notNull(),
  createdAt: timestamp("created_at").notNull(),
});

export const candidates = pgTable("candidates", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  name: text("name").notNull(), // PII
  email: text("email").notNull(), // PII
  phone: text("phone").notNull(), // PII
  // 'referral' | 'linkedin' | 'job_board' | 'agency' | 'careers_site'
  source: text("source").notNull(),
  createdAt: timestamp("created_at").notNull(),
});

export const applications = pgTable("applications", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  candidateId: text("candidate_id")
    .notNull()
    .references(() => candidates.id),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id),
  // 'applied' | 'screen' | 'interview' | 'offer' | 'hired' | 'rejected'
  stage: text("stage").notNull(),
  appliedAt: timestamp("applied_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;

export type Candidate = typeof candidates.$inferSelect;
export type NewCandidate = typeof candidates.$inferInsert;

export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;

export const APPLICATION_STAGES = ["applied", "screen", "interview", "offer", "hired", "rejected"] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

export const CANDIDATE_SOURCES = ["referral", "linkedin", "job_board", "agency", "careers_site"] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];
