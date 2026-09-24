"use client";

import { useCallback, useEffect, useEffectEvent, useRef } from "react";
import { parseAsString, useQueryStates } from "nuqs";

import {
  hasPaymentReturnQuery,
  PAYMENT_RETURN_URL_KEYS,
  resolvePaymentReturn,
  type PaymentReturnAction,
  type PaymentReturnOutcome,
} from "@/lib/billing/payment-return";

const PAYMENT_RETURN_PARSERS = {
  setupIntentId: parseAsString,
  setupIntentClientSecret: parseAsString,
  paymentIntentId: parseAsString,
  paymentIntentClientSecret: parseAsString,
  redirectStatus: parseAsString,
} satisfies Record<keyof typeof PAYMENT_RETURN_URL_KEYS, typeof parseAsString>;

// Runs the step for a return from a redirect-based payment method once, and clears the query
// only on a "final" outcome, so a reload retries a pending or failed step. The ref survives the
// Strict Mode effect replay. Returns a function that drops a return a new checkout replaces.
export function usePaymentReturn({
  onReturn,
}: {
  onReturn: (action: PaymentReturnAction) => Promise<PaymentReturnOutcome>;
}): () => void {
  const [query, setQuery] = useQueryStates(PAYMENT_RETURN_PARSERS, {
    urlKeys: PAYMENT_RETURN_URL_KEYS,
    history: "replace",
  });
  const hasHandledRef = useRef(false);
  const handleReturn = useEffectEvent(onReturn);
  const clearPaymentReturn = useCallback(() => {
    void setQuery(null);
  }, [setQuery]);

  useEffect(() => {
    if (hasHandledRef.current || !hasPaymentReturnQuery(query)) {
      return;
    }

    hasHandledRef.current = true;
    void handleReturn(resolvePaymentReturn(query)).then((outcome) => {
      if (outcome === "final") {
        clearPaymentReturn();
      }
    });
  }, [query, clearPaymentReturn]);

  return clearPaymentReturn;
}
