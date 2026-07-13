export interface PublicConfig {
  isGoogleSSOEnabled: boolean;
  isTurnstileEnabled: boolean;
  turnstileSiteKey: string | null;
  isBillingEnabled: boolean;
  stripePublishableKey: string | null;
}
