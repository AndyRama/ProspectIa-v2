export type QualificationDecision = "qualified" | "review" | "rejected";
export interface AIQualification {
  runId: string;
  model: "google/gemma-4-26b-a4b-it:free";
  score: number;
  decision: QualificationDecision;
  reason: string;
  missingData: string[];
  criteria: string;
  evaluatedAt: string;
  profileFingerprint: string;
}
export interface QualificationPreview {
  id: string;
  status: "prepared";
  model: "google/gemma-4-26b-a4b-it:free";
  expiresAt: string;
  criteria: string;
  business: { name: string; services: string; zone: string };
  leads: { id: string; name: string; city: string; engine: string }[];
  excluded: { id: string; reason: string }[];
  max: 10;
  thresholds: { qualified: 60; review: 40 };
}
export interface QualificationRun {
  id: string;
  status: "prepared" | "running" | "completed" | "failed" | "uncertain";
  model: "google/gemma-4-26b-a4b-it:free";
  total: number;
  updated: number;
  skipped: number;
  results: { id: string; name: string; status: "updated" | "skipped"; qualification?: AIQualification; error?: string }[];
  createdAt: string;
  finishedAt?: string;
  error?: string;
  preview?: QualificationPreview;
}
