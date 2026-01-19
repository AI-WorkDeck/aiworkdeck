import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import clsx from "clsx";

const inter = Inter({
    subsets: ["latin"],
    variable: "--font-inter",
    display: "swap",
});

const mono = JetBrains_Mono({
    subsets: ["latin"],
    variable: "--font-mono",
    display: "swap",
});

export const metadata: Metadata = {
    title: "King IDE / 核查宝",
    description: "一站式 AI 工作台，让法律人聚焦专业判断",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="zh-CN" className="scroll-smooth">
            <body
                className={clsx(
                    inter.variable,
                    mono.variable,
                    "antialiased bg-bg text-text-1 min-h-screen flex flex-col font-sans"
                )}
            >
                {children}
            </body>
        </html>
    );
}
