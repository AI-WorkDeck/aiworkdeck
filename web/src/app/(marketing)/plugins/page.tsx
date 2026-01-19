"use client";

import { useTranslation } from 'react-i18next';
import '../../../i18n';

export default function PluginsPage() {
    const { t } = useTranslation();

    const plugins = [
        { name: "PDF Parser Pro", desc: t('plugins.parser_desc', "Advanced PDF extraction logic for complex agreements."), version: "v1.2.0", author: "King IDE" },
        { name: "Risk Scanner", desc: t('plugins.risk_desc', "AI-powered risk detection for compliance review."), version: "v2.0.1", author: "HylTech" },
        { name: "Formatter", desc: t('plugins.formatter_desc', "Auto-format legal documents to standard styles."), version: "v0.9.5", author: "Community" },
        { name: "Citation Checker", desc: t('plugins.citation_desc', "Verify case law citations automatically."), version: "v1.1.2", author: "LegalOps" },
    ];

    return (
        <div className="min-h-screen pt-32 pb-20 container mx-auto px-6">
            <h1 className="text-4xl font-bold mb-4 text-center">{t('plugins.title')}</h1>
            <p className="text-center text-text-2 mb-16 max-w-2xl mx-auto">{t('plugins.subtitle', "Explore the ecosystem of plugins to supercharge your legal workflow.")}</p>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {plugins.map((plugin) => (
                    <div key={plugin.name} className="bg-surface border border-border rounded-xl p-6 hover:shadow-lg hover:border-brand/30 transition-all cursor-pointer group">
                        <div className="flex justify-between items-start mb-4">
                            <div className="w-10 h-10 rounded-lg bg-brand/10 text-brand flex items-center justify-center font-bold text-xl">
                                {plugin.name[0]}
                            </div>
                            <span className="text-xs font-mono text-text-3 bg-surface-alt px-2 py-1 rounded">{plugin.version}</span>
                        </div>
                        <h3 className="font-bold text-lg mb-2 group-hover:text-brand transition-colors">{plugin.name}</h3>
                        <p className="text-sm text-text-2 mb-4">{plugin.desc}</p>
                        <div className="text-xs text-text-3">By {plugin.author}</div>
                    </div>
                ))}
            </div>

            <div className="mt-16 text-center">
                <button className="px-6 py-3 rounded-full bg-surface-alt border border-border text-text-2 hover:bg-surface hover:text-brand transition-colors text-sm font-medium">
                    {t('plugins.load_more', "Load More")}
                </button>
            </div>
        </div>
    );
}
