import type { Metadata } from "next";
import { Suspense } from "react";
import { Nunito } from "next/font/google";
import "./globals.css";
import { CoffeeLink } from "@/components/CoffeeLink";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Video Focus Group",
  description: "Show your short video to a paper board of the people who wrote the book on it.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${nunito.variable} h-full`}>
      <body className="min-h-full">
        <div className="paper-margin" aria-hidden />
        <div className="relative z-[1]">{children}</div>
        {/* Reads the path (it stays off the first screen), which a review's id only gives at request time. */}
        <Suspense>
          <CoffeeLink />
        </Suspense>
      </body>
    </html>
  );
}
