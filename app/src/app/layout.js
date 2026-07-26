import "./globals.css";
export const metadata = { title: "SLF GoldDesk", description: "S Lunawat Finance — gold loan system" };
export const viewport = { width: "device-width", initialScale: 1 };
export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
