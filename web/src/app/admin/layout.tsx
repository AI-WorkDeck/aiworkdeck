"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Package, Tag, Users, ShoppingCart, LogOut } from "lucide-react";
import clsx from "clsx";

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();

    const navItems = [
        { name: "Dashboard", href: "/admin", icon: LayoutDashboard },
        { name: "Products", href: "/admin/products", icon: Package },
        { name: "Plugins", href: "/admin/plugins", icon: Tag },
        { name: "Orders", href: "/admin/orders", icon: ShoppingCart },
        { name: "Users", href: "/admin/users", icon: Users },
    ];

    return (
        <div className="min-h-screen bg-bg flex font-sans">
            <aside className="w-64 bg-neutral-darkBg text-text-3 flex flex-col fixed inset-y-0 left-0 z-50">
                <div className="p-6 border-b border-white/10">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-white font-bold">A</div>
                        <span className="font-bold text-white tracking-tight">Admin Console</span>
                    </div>
                </div>

                <nav className="flex-1 p-4 space-y-1">
                    {navItems.map((item) => {
                        const isActive = pathname === item.href;
                        return (
                            <Link
                                key={item.name}
                                href={item.href}
                                className={clsx(
                                    "flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 group",
                                    isActive
                                        ? "bg-brand text-white"
                                        : "hover:bg-white/5 hover:text-white"
                                )}
                            >
                                <item.icon className={clsx("w-5 h-5", isActive ? "text-white" : "text-text-3 group-hover:text-white")} />
                                {item.name}
                            </Link>
                        );
                    })}
                </nav>

                <div className="p-4 border-t border-white/10">
                    <button className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-white/5 text-white rounded-lg transition-colors">
                        <LogOut className="w-4 h-4" /> Exit Admin
                    </button>
                </div>
            </aside>

            <main className="flex-1 ml-64 p-8">
                {children}
            </main>
        </div>
    );
}
