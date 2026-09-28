import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CSM Bonus Tracking",
  description: "Bonus progress by CSM — logo churn, conversions, QBR coverage, NPS, save rate, CSAT.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
