import Link from 'next/link';
import { Locale } from '@/i18n-config';

interface FooterProps {
    lang: Locale;
    dict: any;
}

export function Footer({ lang, dict }: FooterProps) {
    return (
        <footer className="bg-neutral-gray-pale border-t border-neutral-gray-light py-12">
            <div className="container mx-auto px-4 md:px-8">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                    <div className="space-y-4">
                        <h4 className="font-bold text-lg text-king-forest">{dict.common.productName}</h4>
                        <p className="text-sm text-neutral-gray-medium max-w-xs">{dict.common.productTagline}</p>
                    </div>

                    <div>
                        <h5 className="font-bold mb-4 text-neutral-gray-dark">{dict.common.footer.product}</h5>
                        <ul className="space-y-2 text-sm text-neutral-gray-medium">
                            <li><Link href={`/${lang}/product`} className="hover:text-king-forest">{dict.common.footer.features}</Link></li>
                            <li><Link href={`/${lang}/pricing`} className="hover:text-king-forest">{dict.common.footer.pricing}</Link></li>
                            <li><Link href={`/${lang}/download`} className="hover:text-king-forest">{dict.common.footer.download}</Link></li>
                            <li><Link href={`/${lang}/changelog`} className="hover:text-king-forest">{dict.common.footer.changelog}</Link></li>
                        </ul>
                    </div>

                    <div>
                        <h5 className="font-bold mb-4 text-neutral-gray-dark">{dict.common.footer.ecosystem}</h5>
                        <ul className="space-y-2 text-sm text-neutral-gray-medium">
                            <li><Link href={`/${lang}/plugins`} className="hover:text-king-forest">{dict.common.footer.plugins}</Link></li>
                            <li><Link href={`/${lang}/developers`} className="hover:text-king-forest">{dict.common.footer.developers}</Link></li>
                        </ul>
                    </div>

                    <div>
                        <h5 className="font-bold mb-4 text-neutral-gray-dark">{dict.common.footer.legal}</h5>
                        <ul className="space-y-2 text-sm text-neutral-gray-medium">
                            <li><Link href={`/${lang}/legal/terms`} className="hover:text-king-forest">{dict.common.footer.terms}</Link></li>
                            <li><Link href={`/${lang}/legal/privacy`} className="hover:text-king-forest">{dict.common.footer.privacy}</Link></li>
                        </ul>
                    </div>
                </div>
                <div className="mt-12 pt-8 border-t border-gray-200 text-center text-sm text-neutral-gray-medium">
                    {dict.common.footer.copyright.replace('{year}', new Date().getFullYear().toString())}
                </div>
            </div>
        </footer>
    );
}
