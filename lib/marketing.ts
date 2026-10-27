/** Marketing labels and rules shared by the server and the browser (no database access here). */

export const CHANNELS = ["email", "cold_call", "direct", "individual_referral", "social", "other"] as const;
export type Channel = (typeof CHANNELS)[number];

export const OUTCOMES = ["no_response", "replied", "meeting", "deal_won", "deal_lost"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const CAMPAIGN_STATUSES = ["planned", "active", "paused", "finished"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CHANNEL_LABEL: Record<Channel, string> = {
  email: "Email",
  cold_call: "Cold calling",
  direct: "Direct",
  individual_referral: "Individual referrals",
  social: "Social",
  other: "Other",
};

export const OUTCOME_LABEL: Record<Outcome, string> = {
  no_response: "No response",
  replied: "Replied",
  meeting: "Meeting booked",
  deal_won: "Deal won",
  deal_lost: "Deal lost",
};

export const OUTCOME_TONE: Record<Outcome, "neutral" | "amber" | "green" | "red"> = {
  no_response: "neutral",
  replied: "amber",
  meeting: "amber",
  deal_won: "green",
  deal_lost: "red",
};

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = { planned: "Planned", active: "Active", paused: "Paused", finished: "Finished" };

/**
 * A contact "responded" if anything came back: a reply, a meeting, or a deal
 * either way. Response rate = responded ÷ contacts reached (activities logged).
 */
export const RESPONDED: readonly Outcome[] = ["replied", "meeting", "deal_won", "deal_lost"];

/** Insights need enough activity to mean something; below this they say so instead of guessing. */
export const INSIGHT_MIN = { day: 20, hour: 15 } as const;

/** Response rate as a percentage with one decimal, or null when nothing was logged. */
export function ratePct(responded: number, contacts: number): number | null {
  return contacts > 0 ? Math.round((responded / contacts) * 1000) / 10 : null;
}
