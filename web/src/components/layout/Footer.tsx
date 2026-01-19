"use client";

import Link from "next/link";
import { Github, Twitter, Linkedin } from "lucide-react";
import { useTranslation } from 'react-i18next';
import '../../i18n';

export function Footer() {
    const { t } = useTranslation();

    // Explicitly using lighter text colors for better contrast on dark bg
    const footerSections = [
        {
            title: t('footer.product'),
            links: [
                { name: t('footer.overview'), href: "/#overview" },
                { name: t('footer.pricing'), href: "/pricing" },
                { name: t('footer.download'), href: "/download" },
                { name: t('footer.changelog'), href: "/changelog" },
            ],
        },
        {
            title: t('footer.ecosystem'),
            links: [
                { name: t('footer.plugins'), href: "/plugins" },
                { name: t('footer.developers'), href: "/docs/developers" },
                { name: t('footer.submit_plugin'), href: "/plugins/submit" },
            ],
        },
        {
            title: t('footer.resources'),
            links: [
                { name: t('footer.documentation'), href: "/docs" },
                { name: t('footer.community'), href: "/community" },
                { name: t('footer.help_center'), href: "/help" },
            ],
        },
        {
            title: t('footer.legal'),
            links: [
                { name: t('footer.terms'), href: "/legal/terms" },
                { name: t('footer.privacy'), href: "/legal/privacy" },
                { name: t('footer.data_sources'), href: "/legal/data-sources" },
                { name: t('footer.security'), href: "/legal/security" },
            ],
        },
    ];

    return (
        <footer className="bg-neutral-darkBg text-gray-300 border-t border-divider pt-16 pb-8">
            <div className="container mx-auto px-6">
                <div className="grid grid-cols-2 md:grid-cols-6 gap-8 mb-12">
                    {/* Brand Column */}
                    <div className="col-span-2 md:col-span-2">
                        <Link href="/" className="flex items-center gap-2 mb-4 group">
                            <img src="/logo.png" alt="King IDE Logo" className="w-8 h-8 rounded-lg shadow-lg" />
                            <span className="font-bold text-xl text-white tracking-tight">King IDE</span>
                        </Link>
                        <p className="text-sm leading-relaxed mb-6 max-w-xs text-gray-400">
                            {t('footer.description')}
                        </p>
                        <div className="flex gap-4">
                            <SocialLink href="#" icon={<Twitter className="w-5 h-5" />} />
                            <SocialLink href="#" icon={<Github className="w-5 h-5" />} />
                            <SocialLink href="#" icon={<Linkedin className="w-5 h-5" />} />
                        </div>
                    </div>

                    {/* Links Columns */}
                    {footerSections.map((section) => (
                        <div key={section.title} className="col-span-1">
                            <h4 className="font-semibold text-white mb-4">{section.title}</h4>
                            <ul className="space-y-3">
                                {section.links.map((link) => (
                                    <li key={link.name}>
                                        <Link
                                            href={link.href}
                                            className="text-sm text-gray-400 hover:text-white transition-colors"
                                        >
                                            {link.name}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

                <div className="border-t border-divider/20 pt-8 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-gray-500">
                    <p>© {new Date().getFullYear()} HylTech. {t('footer.rights_reserved')}</p>
                    <div className="flex gap-6">
                        {/* Additional bottom links if needed */}
                    </div>
                </div>
            </div>
        </footer>
    );
}

function SocialLink({ href, icon }: { href: string; icon: React.ReactNode }) {
    return (
        <a
            href={href}
            className="p-2 rounded-full bg-surface-alt/10 hover:bg-surface-alt/20 hover:text-white transition-colors"
        >
            {icon}
        </a>
    );
}
