// DRAFT — needs Nyle's review before launch. See docs/legal-review.md.
import Link from "next/link";
import { LegalPage, Points, Section } from "@/components/LegalPage";

export const metadata = { title: "Terms · Video Focus Group" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms" updated="November 16, 2026">
      <p>
        These are the rules for using the hosted Video Focus Group site. By making an account or using it, you agree to them. Copies of Video Focus Group that people run on their own computers are covered by
        their own license, not this page.
      </p>

      <Section title="What it is">
        <p>
          Video Focus Group shows your short video to a board of AI reviewers, each built from one real person&apos;s published work, and gives you their notes. It&apos;s feedback to think with, not a verdict.
        </p>
        <Points
          items={[
            "The reviewers are AI interpretations. The real people didn't watch your video, and Video Focus Group isn't affiliated with or endorsed by any of them.",
            "A reviewer's quote is only ever an excerpt of something they actually published. Everything else is the AI's reading of their ideas.",
            "We don't predict views, virality, sales or income, and nothing here promises any. A review can be wrong or miss something.",
          ]}
        />
      </Section>

      <Section title="Your account">
        <p>You need an account to send a video. Keep your sign-in safe; what happens through your account is your responsibility. You must be old enough to agree to these terms where you live.</p>
      </Section>

      <Section title="Your videos">
        <p>
          You keep ownership of what you upload. You give us permission to process it (including sending frames and the transcript to Anthropic) only to make your reviews and answer your follow-ups. Only
          upload videos you have the right to upload. Don&apos;t upload anything illegal, anything that exposes someone else&apos;s private information, or anything you aren&apos;t allowed to share. See the{" "}
          <Link href="/privacy" className="underline decoration-line-strong underline-offset-4 hover:text-ink">
            privacy page
          </Link>{" "}
          for what happens to it.
        </p>
      </Section>

      <Section title="Credits and your own key">
        <Points
          items={[
            "You can pay for reviews with prepaid credits, or with your own Anthropic API key. You choose, and you can change it on your account page.",
            "Credits come in $10, $25 and $50 packs, paid through Stripe. A review or follow-up answer costs what Anthropic charges us for it, plus 20%. While one runs, a share of your credit is set aside and whatever isn't used is given back.",
            "Credits are for reviews and follow-up questions on Video Focus Group. Unused credit isn't refunded in cash, except where the law says it must be.",
            "If a payment is refunded or disputed, we take that much credit back. If it was already spent, your account is paused for new paid reviews and top-ups until it's sorted out.",
            "If you pay with your own key, Anthropic bills you for it directly and Video Focus Group charges nothing. You're responsible for that key and its costs.",
          ]}
        />
      </Section>

      <Section title="Using it fairly">
        <p>
          There are limits on how many reviews and answers you can ask for in a day, and on how big a video can be. Don&apos;t try to get around them, overload the site, or use it to attack anyone or anything.
          We may pause an account that does.
        </p>
      </Section>

      <Section title="No guarantees">
        <p>
          Video Focus Group is provided as it is. We try to keep it running and the reviews useful, but we don&apos;t promise it will always be available, or that any review is correct or right for your video.
          To the extent the law allows, we aren&apos;t liable for losses from using it, and our total liability to you is limited to what you paid us in the 12 months before the problem.
        </p>
      </Section>

      <Section title="Changes and ending">
        <p>
          You can stop using Video Focus Group at any time, and ask to have your account deleted (see the privacy page). We may change these terms or the service; if a change matters, we&apos;ll say so here and
          update the date at the top. Using it after that means you accept the change.
        </p>
      </Section>
    </LegalPage>
  );
}
