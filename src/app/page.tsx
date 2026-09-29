import { Hero } from "@/components/landing/Hero";
import { WeeklyTopicBlock } from "@/components/landing/WeeklyTopic";
import { RealStats } from "@/components/landing/Stats";
import { Features } from "@/components/landing/Features";
import { Seasonal } from "@/components/landing/Seasonal";
import { Comparison } from "@/components/landing/Comparison";
import { Subjects } from "@/components/landing/Subjects";
import { PricingTeaser } from "@/components/landing/PricingTeaser";
import { FAQ } from "@/components/landing/FAQ";
import { CTA } from "@/components/landing/CTA";
import { PageTracker } from "@/components/shared/PageTracker";

export default function Home() {
  return (
    <>
      <Hero />
      <RealStats />
      <Features />
      <Seasonal />
      <Subjects />
      <Comparison />
      <PricingTeaser />
      <FAQ />
      <WeeklyTopicBlock />
      <CTA />
      <PageTracker eventName="landing_view" data={{ source: "home" }} />
    </>
  );
}