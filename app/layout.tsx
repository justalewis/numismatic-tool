import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Numismatic Tool — Coin Grading",
  description:
    "Upload the front and back of a coin for an estimated numismatic grading report.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
