"use client";

import { useState, useEffect } from "react";
import { Download, Monitor, Apple, AlertTriangle } from "lucide-react";
import clsx from "clsx";

export default function DownloadPage() {
    const [os, setOs] = useState<"mac" | "windows" | "unknown">("unknown");

    useEffect(() => {
        const userAgent = window.navigator.userAgent.toLowerCase();
        if (userAgent.indexOf("mac") !== -1) setOs("mac");
        else if (userAgent.indexOf("win") !== -1) setOs("windows");
    }, []);

    return (
        <div className="bg-bg min-h-screen py-24 flex flex-col items-center">
            <div className="container mx-auto px-6 text-center max-w-3xl">
                <h1 className="text-4xl md:text-5xl font-bold mb-6">
                    Download King IDE <span className="text-brand">v1.0.2</span>
                </h1>
                <p className="text-text-2 text-lg mb-12">
                    The desktop client for professional legal execution. <br />
                    Secure, fast, and offline-capable.
                </p>

                <div className="bg-surface p-10 rounded-3xl border border-border shadow-xl inline-flex flex-col items-center min-w-[320px]">
                    {os === "mac" ? (
                        <Apple className="w-16 h-16 text-text-1 mb-6" />
                    ) : os === "windows" ? (
                        <Monitor className="w-16 h-16 text-text-1 mb-6" />
                    ) : (
                        <Monitor className="w-16 h-16 text-text-1 mb-6" />
                    )}

                    <button className="flex items-center gap-3 px-8 py-4 bg-brand text-white rounded-full font-bold text-lg hover:bg-brand-hover hover:scale-105 transition-all shadow-lg shadow-brand/20 mb-4">
                        <Download className="w-6 h-6" />
                        Download for {os === "mac" ? "macOS" : os === "windows" ? "Windows" : "Desktop"}
                    </button>

                    <div className="text-sm text-text-3 font-mono">
                        SHA256: 8f4b...2a9c | 148 MB
                    </div>
                </div>

                <div className="mt-12 flex gap-8 justify-center text-sm text-text-2">
                    <button
                        className={clsx("hover:text-brand", os === "mac" && "font-bold text-brand")}
                        onClick={() => setOs("mac")}
                    >
                        macOS
                    </button>
                    <div className="w-px h-4 bg-divider" />
                    <button
                        className={clsx("hover:text-brand", os === "windows" && "font-bold text-brand")}
                        onClick={() => setOs("windows")}
                    >
                        Windows
                    </button>
                </div>

                <div className="mt-16 p-4 bg-orange-500/10 border border-orange-500/20 rounded-lg flex items-center gap-3 text-orange-700 text-left max-w-lg mx-auto">
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                    <div className="text-sm">
                        <strong>Beta Notice:</strong> This version is an Early Access Build. Please report any issues to support@hyltech.go.
                    </div>
                </div>

            </div>
        </div>
    );
}
