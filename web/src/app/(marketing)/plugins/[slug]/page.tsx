import Link from "next/link";
import { ArrowLeft, Download, ShieldCheck, Globe, Calendar } from "lucide-react";

export default function PluginDetailPage({ params }: { params: { slug: string } }) {
    const { slug } = params;

    // Mock Detail Data
    const plugin = {
        name: "Company Lookup",
        desc: "Instantly fetch company registration data from official registries.",
        author: "HylTech",
        version: "1.2.4",
        updated: "2 days ago",
        downloads: "12k",
        price: "Free",
        images: ["/placeholder-1.png", "/placeholder-2.png"]
    };

    return (
        <div className="bg-bg min-h-screen py-10">
            <div className="container mx-auto px-6 max-w-5xl">

                <Link href="/plugins" className="inline-flex items-center gap-2 text-text-3 hover:text-text-1 mb-8 transition-colors">
                    <ArrowLeft className="w-4 h-4" /> Back to Marketplace
                </Link>

                <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">
                    {/* Header */}
                    <div className="p-8 border-b border-divider flex flex-col md:flex-row gap-6 md:items-start">
                        <div className="w-24 h-24 rounded-2xl bg-brand flex items-center justify-center text-white text-3xl font-bold shrink-0 shadow-lg">
                            {plugin.name.charAt(0)}
                        </div>
                        <div className="flex-1">
                            <div className="flex justify-between items-start">
                                <div>
                                    <h1 className="text-3xl font-bold text-text-1 mb-2">{plugin.name}</h1>
                                    <p className="text-text-2 text-lg mb-4">{plugin.desc}</p>
                                    <div className="flex items-center gap-4 text-sm text-text-3">
                                        <span className="flex items-center gap-1"><ShieldCheck className="w-4 h-4 text-brand" /> Verified by HylTech</span>
                                        <span className="flex items-center gap-1"><Globe className="w-4 h-4" /> {plugin.author}</span>
                                    </div>
                                </div>
                                <div className="text-right hidden md:block">
                                    <div className="text-2xl font-bold text-brand mb-1">{plugin.price}</div>
                                </div>
                            </div>
                        </div>
                        <div className="flex flex-col gap-3 min-w-[200px]">
                            <button className="w-full py-3 bg-brand text-white rounded-xl font-bold hover:bg-brand-hover shadow-lg hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2">
                                <Download className="w-5 h-5" /> Install
                            </button>
                            <div className="text-center text-xs text-text-3">
                                Compatible with v1.0+
                            </div>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="p-8 grid md:grid-cols-3 gap-12">
                        <div className="md:col-span-2 space-y-8">
                            <section>
                                <h3 className="text-xl font-bold mb-4">Gallery</h3>
                                <div className="aspect-video bg-surface-alt rounded-xl flex items-center justify-center text-text-3 border border-dashed border-border">
                                    Image Placeholder
                                </div>
                            </section>
                            <section className="prose prose-sm dark:prose-invert">
                                <h3>About this plugin</h3>
                                <p>
                                    This plugin connects directly to the National Enterprise Credit Information Publicity System.
                                    It allows you to verify company status, capital, and shareholders without leaving the IDE.
                                </p>
                            </section>
                        </div>

                        <div className="space-y-6">
                            <div className="p-4 bg-surface-alt/30 rounded-xl border border-border">
                                <h4 className="font-bold mb-4 text-sm uppercase tracking-wider text-text-3">Metadata</h4>
                                <div className="space-y-3 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-text-2">Version</span>
                                        <span className="font-mono">{plugin.version}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-text-2">Last Updated</span>
                                        <span>{plugin.updated}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-text-2">Downloads</span>
                                        <span>{plugin.downloads}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-text-2">License</span>
                                        <span>MIT</span>
                                    </div>
                                </div>
                            </div>

                            <div className="text-sm text-text-3">
                                <h4 className="font-bold mb-2">Support</h4>
                                <p className="mb-2">Need help? Contact the developer.</p>
                                <a href="#" className="text-brand hover:underline">Report an issue</a>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
