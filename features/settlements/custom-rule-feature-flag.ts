export function isCustomSettlementRulesEnabled(
  env: Record<string, string | undefined> = {
    NEXT_PUBLIC_AI_CUSTOM_SETTLEMENT_RULES_ENABLED:
      process.env.NEXT_PUBLIC_AI_CUSTOM_SETTLEMENT_RULES_ENABLED,
  },
): boolean {
  return env.NEXT_PUBLIC_AI_CUSTOM_SETTLEMENT_RULES_ENABLED === "true";
}
