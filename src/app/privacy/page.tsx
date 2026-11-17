// DRAFT — needs Nyle's review before launch. See docs/legal-review.md.
import { LegalPage, Points, Section } from "@/components/LegalPage";

export const metadata = { title: "Privacy · Video Focus Group" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="November 16, 2026">
      <p>
        This explains what Video Focus Group collects when you use the hosted site, why, who else sees it, and how to get rid of it. If you run Video Focus Group on your own computer, none of this applies: it
        all stays on your machine, apart from what goes to Anthropic with your own API key.
      </p>

      <Section title="What we collect">
        <Points
          items={[
            "Your account: the email address you sign up with, and your sign-in details. If you sign in with Google, we get your email address from Google and nothing else.",
            "Your answers to the questions at the start, and the board you pick.",
            "The video you upload, frames taken from it, and a transcript of what's said in it.",
            "The reviews we write about it, and your follow-up questions and the answers.",
            "Your credit balance and a record of top-ups, charges and anything given back.",
            "If you pay with your own Anthropic API key: the key itself, kept encrypted. We only ever show you its last 4 characters.",
            "A scrambled code made from the network address your requests come from (a keyed hash; the address itself is never stored), used to count limits per network and to stop abuse.",
          ]}
        />
      </Section>

      <Section title="Who sees it">
        <Points
          items={[
            "Anthropic. To write a review, frames from your video, its transcript, and your answers are sent to Anthropic's API. Anthropic handles them under its own terms and privacy policy. Reviews you pay for with your own key are billed to you by Anthropic.",
            "Stripe. Credits are bought through Stripe Checkout. You type your card details into Stripe's page, never ours. Video Focus Group never sees or stores card numbers; Stripe tells us only that a payment went through, and how much.",
            "Our hosting and database providers, who store your account and reviews for us.",
            "No one else. We don't sell your data, and we don't use your videos or reviews to advertise to you.",
          ]}
        />
      </Section>

      <Section title="Your API key">
        <p>
          A key you save is checked with Anthropic once, then stored encrypted. It&apos;s decrypted only on our server, only to run your own reviews and follow-ups, and it&apos;s never sent to your browser. You can
          replace or remove it any time on your account page; removing it deletes it.
        </p>
      </Section>

      <Section title="How long we keep things, and deleting them">
        <Points
          items={[
            "Reviews, with their videos, frames, transcripts and follow-up chats, stay in your account until you delete them. You can delete any review from its page, and that removes it and its video.",
            "Your credit history is kept as long as your account exists, so your balance can always be explained.",
            "To delete your whole account and everything in it, ask the person who runs this site. We'll delete it, except for payment records we have to keep by law.",
            "Anthropic and Stripe keep what they receive under their own policies. Deleting something here doesn't delete their copies.",
          ]}
        />
      </Section>

      <Section title="The reviewers">
        <p>
          The reviewers are AI interpretations of real, well-known people, built from their published work. Video Focus Group isn&apos;t affiliated with or endorsed by any of them, and they didn&apos;t watch or approve
          your video. Nothing you upload is shared with them.
        </p>
      </Section>

      <Section title="Cookies">
        <p>We use only the cookies that keep you signed in, and one that remembers this browser&apos;s reviews from before you signed in. There&apos;s no advertising or tracking cookie.</p>
      </Section>

      <Section title="Changes">
        <p>If this changes in a way that matters, we&apos;ll say so on this page and update the date at the top.</p>
      </Section>
    </LegalPage>
  );
}
