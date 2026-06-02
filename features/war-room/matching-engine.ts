export type MatchingProjectContext = {
  category: string;
  platform: string;
  preferredStyles: string[];
  requiredMinutes: number;
};

export type StreamerReferenceProject = {
  id: string;
  name: string;
  result: string;
};

export type StreamerCandidateSnapshot = {
  id: string;
  name: string;
  categories: string[];
  platforms: string[];
  styles: string[];
  completionRateBps: number;
  screeningPassRateBps: number;
  roiBps: number;
  grossMarginContributionCents: number;
  riskTags: string[];
  availableMinutes: number;
  referenceProjects: StreamerReferenceProject[];
};

export type StreamerMatchResult = {
  streamerId: string;
  streamerName: string;
  score: number;
  reasons: string[];
  riskNotes: string[];
  referenceProjects: StreamerReferenceProject[];
  suggestedSettlementMethod: "cpt" | "base_salary" | "base_salary_cpt";
};

export type SupplierQualitySnapshot = {
  id: string;
  name: string;
  screeningPassRateBps: number;
  completionRateBps: number;
  marginContributionCents: number;
  anomalyRateBps: number;
  blacklistRateBps: number;
  isBlacklisted: boolean;
};

export type SupplierQualityScore = {
  supplierId: string;
  supplierName: string;
  score: number;
  grade: "A" | "B" | "C" | "D";
  reasons: string[];
  riskNotes: string[];
};

export function rankStreamerCandidates({
  project,
  candidates,
}: {
  project: MatchingProjectContext;
  candidates: StreamerCandidateSnapshot[];
}): StreamerMatchResult[] {
  return candidates
    .map((candidate) => scoreStreamer(project, candidate))
    .sort((left, right) => right.score - left.score);
}

export function scoreSupplierQuality(
  supplier: SupplierQualitySnapshot,
): SupplierQualityScore {
  const reasons: string[] = [];
  const riskNotes: string[] = [];
  const passRate = safeBps(supplier.screeningPassRateBps);
  const completionRate = safeBps(supplier.completionRateBps);
  const anomalyRate = safeBps(supplier.anomalyRateBps);
  const blacklistRate = safeBps(supplier.blacklistRateBps);
  const marginPoints = Math.round(
    (Math.max(0, Math.min(2000000, supplier.marginContributionCents)) /
      2000000) *
      20,
  );

  if (passRate >= 8500) {
    reasons.push("high_screening_pass_rate");
  }
  if (completionRate >= 8000) {
    reasons.push("high_completion_rate");
  }
  if (supplier.marginContributionCents > 0) {
    reasons.push("positive_margin_contribution");
  } else if (supplier.marginContributionCents < 0) {
    riskNotes.push("negative_margin_contribution");
  }
  if (anomalyRate >= 2000) {
    riskNotes.push("high_anomaly_rate");
  }
  if (blacklistRate > 0) {
    riskNotes.push("blacklist_penalty");
  }
  if (supplier.isBlacklisted) {
    riskNotes.push("supplier_blacklisted");
  }

  const score = clampScore(
    22 +
      Math.round((passRate / 10000) * 30) +
      Math.round((completionRate / 10000) * 30) +
      marginPoints -
      Math.round((anomalyRate / 10000) * 20) -
      Math.round((blacklistRate / 10000) * 30) -
      (supplier.isBlacklisted ? 40 : 0),
  );

  return {
    supplierId: supplier.id,
    supplierName: supplier.name,
    score,
    grade: gradeForScore(score),
    reasons,
    riskNotes,
  };
}

function scoreStreamer(
  project: MatchingProjectContext,
  candidate: StreamerCandidateSnapshot,
): StreamerMatchResult {
  const reasons: string[] = [];
  const riskNotes = [...candidate.riskTags];
  let score = 5;

  if (candidate.categories.includes(project.category)) {
    score += 20;
    reasons.push("category_match");
  }
  if (candidate.platforms.includes(project.platform)) {
    score += 15;
    reasons.push("platform_match");
  }
  if (project.preferredStyles.some((style) => candidate.styles.includes(style))) {
    score += 10;
    reasons.push("style_match");
  }

  const completionRate = safeBps(candidate.completionRateBps);
  const passRate = safeBps(candidate.screeningPassRateBps);
  score += Math.round((completionRate / 10000) * 20);
  score += Math.round((passRate / 10000) * 15);
  score += Math.round((Math.min(20000, safeBps(candidate.roiBps)) / 20000) * 10);

  if (completionRate >= 8500) {
    reasons.push("high_completion_rate");
  }
  if (passRate >= 8500) {
    reasons.push("high_screening_pass_rate");
  }
  if (candidate.grossMarginContributionCents > 0) {
    score += 5;
    reasons.push("positive_margin_contribution");
  } else if (candidate.grossMarginContributionCents < 0) {
    riskNotes.push("negative_margin_contribution");
  }

  if (candidate.availableMinutes < project.requiredMinutes) {
    score -= 5;
    riskNotes.push("availability_shortage");
  }

  score -= riskPenalty(candidate.riskTags);

  return {
    streamerId: candidate.id,
    streamerName: candidate.name,
    score: clampScore(score),
    reasons,
    riskNotes,
    referenceProjects: candidate.referenceProjects,
    suggestedSettlementMethod: suggestSettlementMethod(candidate, riskNotes),
  };
}

function suggestSettlementMethod(
  candidate: StreamerCandidateSnapshot,
  riskNotes: string[],
): StreamerMatchResult["suggestedSettlementMethod"] {
  if (riskNotes.length > 0) {
    return "base_salary";
  }
  if (
    candidate.roiBps >= 10000 &&
    candidate.completionRateBps >= 8500 &&
    candidate.screeningPassRateBps >= 8500
  ) {
    return "base_salary_cpt";
  }
  return "cpt";
}

function riskPenalty(riskTags: string[]): number {
  return riskTags.reduce((penalty, tag) => {
    if (tag === "dispute") {
      return penalty + 10;
    }
    if (tag === "recent_anomaly") {
      return penalty + 5;
    }
    if (tag === "blacklisted") {
      return penalty + 40;
    }
    return penalty + 3;
  }, 0);
}

function gradeForScore(score: number): SupplierQualityScore["grade"] {
  if (score >= 85) {
    return "A";
  }
  if (score >= 70) {
    return "B";
  }
  if (score >= 50) {
    return "C";
  }
  return "D";
}

function safeBps(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
