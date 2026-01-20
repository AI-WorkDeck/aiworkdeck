'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Locale } from '@/i18n-config';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';

interface NavbarProps {
    lang: Locale;
    dict: any; // Type accurately if possible, using 'any' for speed for now
}

export function Navbar({ lang, dict }: NavbarProps) {
    const [isScrolled, setIsScrolled] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const pathname = usePathname();

    const redirectedPathName = (locale: string) => {
        if (!pathname) return '/';
        const segments = pathname.split('/');
        segments[1] = locale;
        return segments.join('/');
    };

    useEffect(() => {
        const handleScroll = () => {
            setIsScrolled(window.scrollY > 10);
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    const navLinks = [
        { href: `/${lang}/product`, label: dict.common.nav.product },
        { href: `/${lang}/plugins`, label: dict.common.nav.plugins },
        { href: `/${lang}/pricing`, label: dict.common.nav.pricing },
    ];

    return (
        <header
            className={cn(
                'fixed left-0 right-0 z-50 mx-auto w-full transition-all duration-300 ease-in-out',
                isScrolled
                    ? 'top-4 md:max-w-7xl md:rounded-2xl bg-neutral-white/80 backdrop-blur-lg shadow-sm border border-neutral-gray-light'
                    : 'top-0 max-w-full rounded-none bg-transparent border-b border-transparent'
            )}
        >
            <div className="relative flex h-16 items-center justify-between px-4 md:px-8">
                {/* Logo - Left aligned */}
                <Link href={`/${lang}`} className="flex items-center gap-2 z-10">
                    {/* Placeholder for Logo */}
                    <div className="h-8 w-8 rounded-lg bg-king-forest" />
                    <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-king-forest to-king-forest-lighter">
                        {dict.common.productName}
                    </span>
                </Link>

                {/* Desktop Nav - Absolutely Centered */}
                <nav className="hidden md:flex gap-8 items-center absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                    {navLinks.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            className="text-sm font-medium text-neutral-gray-dark hover:text-king-forest transition-colors"
                        >
                            {link.label}
                        </Link>
                    ))}
                </nav>

                {/* Desktop Actions - Right aligned */}
                <div className="hidden md:flex gap-4 items-center z-10">
                    {/* Language Switcher */}
                    <Link
                        href={redirectedPathName(lang === 'en' ? 'zh' : 'en')}
                        className="text-sm font-medium text-neutral-gray-dark hover:text-king-forest transition-colors px-2"
                    >
                        {lang === 'en' ? '中文' : 'En'}
                    </Link>

                    <div className="h-4 w-px bg-neutral-gray-light" />

                    <Link href={`/${lang}/account/login`}>
                        <Button variant="secondary" className="text-neutral-gray-dark font-semibold hover:bg-neutral-gray-light/80">
                            {dict.common.nav.login}
                        </Button>
                    </Link>
                    <Link href={`/${lang}/download`}>
                        <Button className="font-bold shadow-md shadow-king-forest/10">
                            {dict.common.nav.download}
                        </Button>
                    </Link>
                </div>

                {/* Mobile Menu Toggle */}
                <button
                    className="md:hidden ml-auto"
                    onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                >
                    {isMobileMenuOpen ? <X /> : <Menu />}
                </button>
            </div>

            {/* Mobile Menu */}
            {
                isMobileMenuOpen && (
                    <div className="md:hidden absolute top-16 left-0 right-0 bg-white border-b border-gray-200 p-4 shadow-lg flex flex-col gap-4">
                        {navLinks.map((link) => (
                            <Link
                                key={link.href}
                                href={link.href}
                                onClick={() => setIsMobileMenuOpen(false)}
                                className="text-base font-medium py-2 text-neutral-gray-dark"
                            >
                                {link.label}
                            </Link>
                        ))}
                        <div className="flex flex-col gap-2 pt-4 border-t border-gray-100">
                            <Link href={`/${lang}/account/login`}>
                                <Button variant="ghost" className="w-full justify-start">{dict.common.nav.login}</Button>
                            </Link>
                            <Link href={`/${lang}/download`}>
                                <Button className="w-full">{dict.common.nav.download}</Button>
                            </Link>
                        </div>
                    </div>
                )
            }
        </header >
    );
}
