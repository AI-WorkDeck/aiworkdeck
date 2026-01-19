"use client";

import { useTranslation } from 'react-i18next';
import '../../../i18n';

export default function PricingPage() {
    const { t } = useTranslation();

    return (
        <div className="min-h-screen pt-32 pb-20 container mx-auto px-6">
            <h1 className="text-4xl font-bold mb-8 text-center">{t('pricing.title')}</h1>

            <div className="bg-surface border border-border rounded-xl p-8 max-w-2xl mx-auto shadow-lg text-center">
                <p className="text-xl text-text-1 mb-6 font-medium">
                    {t('pricing.promo')}
                </p>
                <div className="text-text-2 space-y-2">
                    <p>{t('pricing.basic')}</p>
                    <p>{t('pricing.pro')}</p>
                </div>
            </div>
        </div>
    );
}
