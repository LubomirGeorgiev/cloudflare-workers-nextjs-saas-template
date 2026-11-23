/**
 * The order of the payment form's submit: Elements submit, then the EU consent record, then the
 * confirm. Each step runs only when the one before it succeeded; a failure goes to `onFailure`.
 * `submit` runs before any other await, so a wallet sheet keeps the click's gesture.
 */
export async function runCheckoutSubmit({
  submitFirst,
  submit,
  recordConsent,
  confirm,
  onFailure,
}: {
  submitFirst: boolean;
  submit: () => Promise<{ error?: { message?: string } }>;
  /** Null when the form asks for no consent. */
  recordConsent: (() => Promise<CheckoutSubmitFailure | null>) | null;
  confirm: () => Promise<void>;
  /** Gets the message to show; undefined when the step gave none. */
  onFailure: (message: string | undefined) => void;
}): Promise<void> {
  if (submitFirst) {
    const { error } = await submit();
    if (error) {
      onFailure(error.message);
      return;
    }
  }
  // No payment goes through without the record of the consent the buyer gave.
  const failure = recordConsent ? await recordConsent() : null;
  if (failure) {
    onFailure(failure.message);
    return;
  }
  await confirm();
}

interface CheckoutSubmitFailure {
  message: string | undefined;
}
