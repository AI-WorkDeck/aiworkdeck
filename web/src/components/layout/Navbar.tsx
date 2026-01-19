"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { Menu, X, Download, Shield } from "lucide-react";
import clsx from "clsx";
import { useTranslation } from 'react-i18next';
import '../../i18n';

export function Navbar() {
    const { t, i18n } = useTranslation();
    const [isScrolled, setIsScrolled] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    useEffect(() => {
        const handleScroll = () => {
            setIsScrolled(window.scrollY > 20);
        };
        window.addEventListener("scroll", handleScroll);
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    const toggleLanguage = () => {
        const newLang = i18n.language === 'en' ? 'zh' : 'en';
        i18n.changeLanguage(newLang);
    };

    const navLinks = [
        { name: t('nav.product'), href: "/#product" },
        { name: t('nav.pricing'), href: "/pricing" },
        { name: t('nav.plugins'), href: "/plugins" },
    ];

    return (
        <nav
            className={clsx(
                "fixed top-0 left-0 right-0 z-50 transition-all duration-300 border-b",
                isScrolled
                    ? "bg-bg/80 backdrop-blur-md border-border py-3 shadow-sm"
                    : "bg-transparent border-transparent py-5"
            )}
        >
            <div className="container mx-auto px-6 h-16 flex items-center justify-between relative">
                {/* Logo - Absolute Left or Flex Start */}
                <Link href="/" className="flex items-center gap-2 group z-20">
                    <img src="/logo.png" alt="King IDE Logo" className="w-8 h-8 rounded-lg shadow-lg group-hover:scale-105 transition-transform" />
                    <span className="font-bold text-xl tracking-tight">King IDE</span>
                </Link>

                {/* Desktop Nav - Absolute Center to prevent pushing other elements */}
                <div className="hidden md:flex items-center gap-8 absolute left-1/2 -translate-x-1/2">
                    {navLinks.map((link) => (
                        <Link
                            key={link.name}
                            href={link.href}
                            className="text-sm font-medium text-text-2 hover:text-brand transition-colors whitespace-nowrap"
                        >
                            {link.name}
                        </Link>
                    ))}
                </div>

                {/* CTA - Flex End */}
                <div className="hidden md:flex items-center gap-4 z-20">
                    <Link
                        href="/account/login"
                        className="text-sm font-medium text-text-1 hover:text-brand transition-colors"
                    >
                        {t('nav.login')}
                    </Link>
                    <Link
                        href="/download"
                        className="flex items-center gap-2 px-4 py-2 rounded-full bg-brand text-white text-sm font-medium shadow-lg shadow-brand/20 hover:bg-brand-hover hover:shadow-brand/30 hover:-translate-y-0.5 transition-all duration-200"
                    >
                        <Download className="w-4 h-4" />
                        {t('nav.download')}
                    </Link>
                    <div className="w-px h-6 bg-border mx-2" />
                    <button
                        onClick={toggleLanguage}
                        className="text-sm font-medium text-text-1 hover:text-brand transition-colors uppercase w-8 text-center"
                    >
                        {i18n.language === 'en' ? '中' : 'En'}
                    </button>
                </div>

                {/* Mobile Menu Toggle */}
                <button
                    className="md:hidden p-2 text-text-1"
                    onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                >
                    {mobileMenuOpen ? <X /> : <Menu />}
                </button>
            </div>

            {/* Mobile Menu */}
            {mobileMenuOpen && (
                <div className="md:hidden absolute top-full left-0 right-0 bg-surface border-b border-border shadow-2xl p-6 flex flex-col gap-4 animate-in slide-in-from-top-4 fade-in duration-200">
                    {navLinks.map((link) => (
                        <Link
                            key={link.name}
                            href={link.href}
                            className="text-lg font-medium text-text-1 py-2 border-b border-border/50"
                            onClick={() => setMobileMenuOpen(false)}
                        >
                            {link.name}
                        </Link>
                    ))}
                    <div className="flex flex-col gap-3 mt-4">
                        <button
                            onClick={toggleLanguage}
                            className="w-full py-3 text-center rounded-lg border border-border text-text-1 font-medium hover:bg-surface-alt uppercase"
                        >
                            {i18n.language === 'en' ? '中文' : 'English'}
                        </button>
                        <Link
                            href="/account/login"
                            className="w-full py-3 text-center rounded-lg border border-border text-text-1 font-medium hover:bg-surface-alt"
                        >
                            {t('nav.login')}
                        </Link>
                        <Link
                            href="/download"
                            className="w-full py-3 text-center rounded-lg bg-brand text-white font-medium shadow-md"
                        >
                            {t('nav.download')}
                        </Link>
                    </div>
                </div>
            )}
        </nav>
    );
}
