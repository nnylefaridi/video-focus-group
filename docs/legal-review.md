# Legal review

**DRAFT — needs Nyle's review before launch.**

`/privacy` (`src/app/privacy/page.tsx`) and `/terms` (`src/app/terms/page.tsx`) are plain-language drafts written from what the code does today. They are not legal advice. Both carry a code comment saying they're drafts; users don't see it. Neither names a company, address or jurisdiction on purpose. They call the product "Video Focus Group" and the operator "we" or "the person who runs this site".

Have a lawyer read both before launch. The questions below are the gaps I couldn't fill in.

## Questions for Nyle

1. **Who is the operator?** [COMPANY NAME / sole proprietor?] Terms and privacy both say "we". Do you want the legal name in them?
2. **Contact address.** [CONTACT EMAIL] Privacy says "ask the person who runs this site" to delete an account, because there's no self-serve account deletion and no contact address on the site. Which address should go there? Should I build a delete-my-account button instead (it must also handle the credit ledger, which is append-only, and any Stripe records)?
3. **Governing law and where disputes go.** [JURISDICTION / VENUE] Terms don't say. Add one?
4. **Postal address.** [BUSINESS ADDRESS] Some places require one for privacy notices or consumer sales. Needed?
5. **Cash refunds.** Terms say credit isn't refunded in cash "except where the law says it must be". Do you want a stated exception for, say, a payment made in error or a service failure that ate credit? (The code already gives back unused reserved credit automatically.)
6. **Liability cap.** Terms cap liability at what the user paid in the previous 12 months. Confirm, or have a lawyer set it.
7. **Minimum age.** Terms say "old enough to agree where you live". Do you want a hard number (13? 16? 18?)? Supabase, Stripe and Anthropic have their own age rules.
8. **Retention.** Reviews and videos are kept until the user deletes them; credit history for the life of the account. Is that what you want? Is there any automatic expiry for old videos or inactive accounts?
9. **Network address.** Privacy says request network addresses are collected for per-network limits and abuse prevention. Check how long `app.usage` keeps them (nothing deletes them today) and whether to state a period.
10. **Providers.** Privacy names Anthropic and Stripe and refers to "hosting and database providers" (Supabase and wherever it's deployed). Name them? Do you need a data-processing agreement with any of them, or a notice about data leaving the user's country?
11. **Anthropic data use.** Check Anthropic's current API terms on retention and training for API inputs, and make sure the privacy page matches what you've agreed to.
12. **Real people.** The terms and privacy pages repeat the existing disclaimer: reviewers are AI interpretations of real people's published work, with no affiliation or endorsement. You said the legal question on names and sticker likenesses is settled; this is only the wording.
13. **Cookies / consent.** Only sign-in cookies and a first-party cookie that remembers a browser's pre-sign-in reviews are used. Confirm no consent banner is needed for where you launch.
14. **Sales tax / VAT.** Credits are sold through Stripe Checkout with no tax set up. Do you need Stripe Tax or a registration anywhere?
15. **Stripe's requirements.** Stripe asks for refund/cancellation and contact details on the business. Make sure the final terms satisfy them.
16. **Date.** Both pages say "Last updated November 16, 2026". Update when you finalize them.
17. **Videos are prepared in the browser.** The original file now never leaves the person's device: their browser makes a 720p copy (without the original's metadata, such as location), stills and a transcript, and only those are uploaded. The privacy page still says "the video you upload"; consider saying it's a smaller copy made on their device. Also, the browser downloads the speech model from Hugging Face (huggingface.co) and its runtime from jsDelivr (cdn.jsdelivr.net), so those two see the visitor's network address (no video or text is sent to them). Name them under providers if you name the others (item 10).

## Where the pages are linked

Only from screens after the first: the account page, the sign-in page and the sign-in step, and under the top-up buttons. Never on the first screen.
