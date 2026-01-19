"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ShoppingBag, Download, Settings, LogOut, User } from "lucide-react";
import clsx from "clsx";

export default function AppLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();

    const navItems = [
        { name: "Overview", href: "/account", icon: LayoutDashboard },
        { name: "Orders", href: "/account/orders", icon: ShoppingBag },
        { name: "Downloads", href: "/account/downloads", icon: Download },
        { name: "Settings", href: "/account/settings", icon: Settings },
    ];

    return (
        <div className="min-h-screen bg-bg flex">
            {/* Sidebar */}
            <aside className="w-64 bg-surface border-r border-border flex flex-col fixed inset-y-0 left-0 z-50">
                <div className="p-6 border-b border-border">
                    <Link href="/" className="flex items-center gap-2 group">
                        <div className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center text-white font-bold text-lg shadow-lg">
                            K
                        </div>
                        <span className="font-bold text-xl text-text-1 tracking-tight">King IDE</span>
                    </Link>
                </div>

                <nav className="flex-1 p-4 space-y-1">
                    {navItems.map((item) => {
                        const isActive = pathname === item.href;
                        return (
                            <Link
                                key={item.name}
                                href={item.href}
                                className={clsx(
                                    "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group",
                                    isActive
                                        ? "bg-brand/10 text-brand font-medium"
                                        : "text-text-2 hover:bg-surface-alt hover:text-text-1"
                                )}
                            >
                                <item.icon className={clsx("w-5 h-5", isActive ? "text-brand" : "text-text-3 group-hover:text-text-1")} />
                                {item.name}
                            </Link>
                        );
                    })}
                </nav>

                <div className="p-4 border-t border-border">
                    <div className="flex items-center gap-3 px-4 py-3 mb-2">
                        <div className="w-8 h-8 rounded-full bg-surface-alt flex items-center justify-center">
                            <User className="w-4 h-4 text-text-2" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-text-1 truncate">Demo User</p>
                            <p className="text-xs text-text-3 truncate">demo@kingide.com</p>
                        </div>
                    </div>
                    <button className="w-full flex items-center gap-3 px-4 py-2 text-sm text-semantic-danger hover:bg-semantic-danger/10 rounded-lg transition-colors">
                        <LogOut className="w-4 h-4" /> Sign Out
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 ml-64 p-8">
                <div className="max-w-5xl mx-auto">
                    {children}
                </div>
            </main>
        </div>
    );
}
