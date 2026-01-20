import { Locale } from '@/i18n-config';
import { getDictionary } from '@/get-dictionary';
import { Download, Terminal, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';

export default async function DownloadFree({
    params,
}: {
    params: Promise<{ lang: Locale }>;
}) {
    const { lang } = await params;
    const dict = await getDictionary(lang);

    return (
        <div className="min-h-screen bg-neutral-gray-pale pb-20">
            {/* Header */}
            <section className="bg-king-forest text-white py-20">
                <div className="container mx-auto px-4 text-center">
                    <h1 className="text-4xl md:text-5xl font-bold mb-4">Download AI Workdeck (Free Version)</h1>
                    <p className="text-xl text-king-mint-lightest max-w-2xl mx-auto">
                        Get started with the open-source version of AI Workdeck. Perfect for personal use and developers.
                    </p>
                </div>
            </section>

            <div className="container mx-auto px-4 mt-[-40px]">
                {/* Download Options */}
                <Card className="max-w-4xl mx-auto bg-white shadow-xl mb-12">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Download className="w-6 h-6 text-king-forest" /> Download Packages
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        <Button variant="outline" className="h-24 flex flex-col items-center justify-center gap-2 border-2 hover:border-king-forest hover:bg-king-mint-lightest/20">
                            <span className="text-lg font-bold">macOS</span>
                            <span className="text-xs text-neutral-gray-medium">Apple Silicon (M1/M2/M3)</span>
                        </Button>
                        <Button variant="outline" className="h-24 flex flex-col items-center justify-center gap-2 border-2 hover:border-king-forest hover:bg-king-mint-lightest/20">
                            <span className="text-lg font-bold">macOS</span>
                            <span className="text-xs text-neutral-gray-medium">Intel Chip</span>
                        </Button>
                        <Button variant="outline" className="h-24 flex flex-col items-center justify-center gap-2 border-2 hover:border-king-forest hover:bg-king-mint-lightest/20">
                            <span className="text-lg font-bold">Windows</span>
                            <span className="text-xs text-neutral-gray-medium">x64 Installer</span>
                        </Button>
                    </CardContent>
                </Card>

                {/* Instructions */}
                <div className="max-w-4xl mx-auto grid gap-8 md:grid-cols-2">
                    {/* Setup Guide */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Terminal className="w-5 h-5 text-king-forest" /> Quick Start
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <h4 className="font-semibold text-sm mb-1">1. Install</h4>
                                <p className="text-sm text-neutral-gray-medium">Run the installer or drag the app to your Applications folder.</p>
                            </div>
                            <div>
                                <h4 className="font-semibold text-sm mb-1">2. Initialize</h4>
                                <div className="bg-neutral-dark-bg text-white p-3 rounded text-xs font-mono">
                                    ai-workdeck init --default
                                </div>
                            </div>
                            <div>
                                <h4 className="font-semibold text-sm mb-1">3. Login</h4>
                                <p className="text-sm text-neutral-gray-medium">Open the app and use your local account.</p>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Configuration */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Settings className="w-5 h-5 text-king-forest" /> Configuration
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-sm text-neutral-gray-medium">
                                The free version requires local configuration for AI models (Ollama supported out of the box).
                            </p>
                            <div className="bg-neutral-gray-pale p-3 rounded border text-sm">
                                <p className="mb-2 font-medium">~/ai-workdeck/config.json</p>
                                <pre className="text-xs text-neutral-gray-medium overflow-x-auto">
                                    {`{
  "model_provider": "ollama",
  "base_url": "http://localhost:11434",
  "model_name": "llama3"
}`}
                                </pre>
                            </div>
                            <Link href="#" className="text-king-forest text-sm font-medium hover:underline">
                                View Full Documentation &rarr;
                            </Link>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
