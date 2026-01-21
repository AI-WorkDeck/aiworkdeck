import Link from 'next/link';
import { Locale } from '@/i18n-config';

interface FooterProps {
    lang: Locale;
    dict: any;
}

export function Footer({ lang, dict }: FooterProps) {
    // 插件列表 - 分两列
    const pluginsColumn1 = [
        { id: 'tts', key: 'tts' },
        { id: 'ppt', key: 'ppt' },
        { id: 'dueDiligence', key: 'dueDiligence' },
        { id: 'top', key: 'meetingVerification' },
    ];

    const pluginsColumn2 = [
        { id: 'clipboard', key: 'clipboard' },
        { id: 'staging', key: 'staging' },
        { id: 'workLog', key: 'workLog' },
        { id: 'docLink', key: 'docLink' },
    ];

    return (
        <footer className="bg-neutral-gray-pale">
            {/* Links Section */}
            <div className="container mx-auto px-4 md:px-8 py-12">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12 text-sm">

                    {/* Product Column */}
                    <div className="flex flex-col gap-3">
                        <h4 className="font-semibold text-neutral-dark-bg mb-2">{dict.common.footer.product}</h4>
                        <Link
                            href={`/${lang}#product`}
                            className="text-neutral-gray-medium hover:text-king-forest transition-colors"
                        >
                            {dict.common.footer.features}
                        </Link>
                        <Link
                            href={`/${lang}#pricing`}
                            className="text-neutral-gray-medium hover:text-king-forest transition-colors"
                        >
                            {dict.common.footer.pricing}
                        </Link>
                        <Link
                            href="https://github.com/checkba/ai-workdeck"
                            target="_blank"
                            className="text-neutral-gray-medium hover:text-king-forest transition-colors"
                        >
                            {dict.common.footer.download}
                        </Link>
                    </div>

                    {/* Showcase Column - 两列插件 */}
                    <div className="md:col-span-2">
                        <h4 className="font-semibold text-neutral-dark-bg mb-4">{dict.common.footer.showcase}</h4>
                        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                            {/* Column 1 */}
                            <div className="flex flex-col gap-3">
                                {pluginsColumn1.map((plugin) => (
                                    <Link
                                        key={plugin.id}
                                        href={`/${lang}/showcase#${plugin.id}`}
                                        className="text-neutral-gray-medium hover:text-king-forest transition-colors"
                                    >
                                        {dict.common.footer.plugins_list?.[plugin.key] ||
                                            dict.showcasePage?.plugins?.[plugin.id]?.title ||
                                            plugin.key}
                                    </Link>
                                ))}
                            </div>
                            {/* Column 2 */}
                            <div className="flex flex-col gap-3">
                                {pluginsColumn2.map((plugin) => (
                                    <Link
                                        key={plugin.id}
                                        href={`/${lang}/showcase#${plugin.id}`}
                                        className="text-neutral-gray-medium hover:text-king-forest transition-colors"
                                    >
                                        {dict.common.footer.plugins_list?.[plugin.key] ||
                                            dict.showcasePage?.plugins?.[plugin.id]?.title ||
                                            plugin.key}
                                    </Link>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Divider */}
            <div className="border-t border-neutral-gray-light"></div>

            {/* Legal Footer Bar */}
            <div className="container mx-auto px-4 md:px-8 py-4">
                <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-xs">
                    {/* Copyright */}
                    <p className="text-neutral-gray-medium">
                        {dict.common.footer.copyright.replace('{year}', new Date().getFullYear().toString())}
                    </p>

                    {/* Legal Links */}
                    <div className="flex items-center gap-4 md:gap-6">
                        <Link
                            href={`/${lang}/legal/privacy`}
                            className="text-neutral-gray-medium hover:text-king-forest transition-colors"
                        >
                            {dict.common.footer.privacy}
                        </Link>
                        <span className="text-neutral-gray-light">|</span>
                        <Link
                            href={`/${lang}/legal/terms`}
                            className="text-neutral-gray-medium hover:text-king-forest transition-colors"
                        >
                            {dict.common.footer.terms}
                        </Link>
                    </div>
                </div>
            </div>
        </footer>
    );
}
