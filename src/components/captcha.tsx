'use client'

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import { FormMessage } from './ui/form';
import { usePublicAuthFeatureState } from '@/state/public-config';

const Turnstile = dynamic(() => import('@marsidev/react-turnstile').then(mod => mod.Turnstile), {
  ssr: false,
})

type Props = Omit<ComponentProps<typeof Turnstile>, 'siteKey'> & {
  validationError?: string
}

export const Captcha = ({
  validationError,
  ...props
}: Props) => {
  const { isTurnstileEnabled, turnstileSiteKey } = usePublicAuthFeatureState();

  if (!isTurnstileEnabled || !turnstileSiteKey) {
    return null;
  }

  return (
    <>
      <Turnstile
        options={{
          size: 'flexible',
          language: 'auto',
        }}
        {...props}
        siteKey={turnstileSiteKey}
      />

      {validationError && (
        <FormMessage className="text-red-500 mt-2">
          {validationError}
        </FormMessage>
      )}
    </>
  );
}
