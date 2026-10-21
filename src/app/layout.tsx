import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mudita | Sales operations",
  description: "A unified workspace for managing and qualifying sales inquiries.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
