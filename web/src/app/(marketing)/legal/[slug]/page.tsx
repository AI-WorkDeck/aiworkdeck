export default function LegalPage({ params }: { params: { slug: string } }) {
    const { slug } = params;

    // In a real app, fetch MDX content based on slug.
    // Here we mock it based on URL.

    const title = slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());

    return (
        <div className="bg-bg min-h-screen py-24">
            <div className="container mx-auto px-6 max-w-3xl">
                <h1 className="text-4xl font-bold mb-8">{title}</h1>
                <div className="prose prose-lg prose-neutral dark:prose-invert">
                    <p className="lead">
                        Last updated: January 1, 2026.
                    </p>
                    <hr />
                    <p>
                        <strong>1. Introduction</strong><br />
                        Welcome to King IDE. By accessing our website and using our services, you agree to these {title}.
                    </p>
                    <p>
                        <strong>2. Data Usage</strong><br />
                        We respect your data. Your execution logs are stored locally unless you explicitly enable Cloud Sync.
                    </p>
                    <p>
                        <strong>3. Disclaimer</strong><br />
                        King IDE is a tool for professionals. It does not provide legal advice.
                    </p>
                    {/* Mock content filler */}
                    <p>
                        (Content for {slug} would go here...)
                    </p>
                </div>
            </div>
        </div>
    );
}

export function generateStaticParams() {
    return [
        { slug: 'terms' },
        { slug: 'privacy' },
        { slug: 'data-sources' },
        { slug: 'security' },
    ];
}
