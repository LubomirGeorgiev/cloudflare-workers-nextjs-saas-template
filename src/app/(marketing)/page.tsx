import { Metadata } from "next";
import { Hero } from "@/components/landing/hero";
import { Stack } from "@/components/landing/stack";
import { Features } from "@/components/landing/features";
import { CallToAction } from "@/components/landing/cta";
import { FAQ } from "@/components/landing/faq";
import { SITE_NAME, SITE_DESCRIPTION } from "@/constants";

export const metadata: Metadata = {
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
};

export default function Home() {
  return (
    <>
      <Hero />
      <Stack />
      <Features />
      <CallToAction />
      <FAQ />
    </>
  );
}
