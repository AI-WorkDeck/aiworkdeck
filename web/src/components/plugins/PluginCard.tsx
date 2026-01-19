import Link from "next/link";
import { Download, Star } from "lucide-react";
import clsx from "clsx";

export interface Plugin {
    id: string;
    slug: string;
    name: string;
    desc: string;
    category: string;
    author: string;
    downloads: string;
    rating: number;
    price: "Free" | string;
    featured?: boolean;
}

export function PluginCard({ plugin }: { plugin: Plugin }) {
    return (
        <Link
            href={`/plugins/${plugin.slug}`}
            className="group flex flex-col p-5 rounded-xl bg-surface border border-border hover:border-brand/50 hover:shadow-lg transition-all duration-300"
        >
            <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-lg bg-surface-alt flex items-center justify-center text-text-3 font-bold text-xl group-hover:bg-brand group-hover:text-white transition-colors">
                    {plugin.name.charAt(0)}
                </div>
                {plugin.featured && (
                    <span className="px-2 py-1 rounded bg-brand/10 text-brand text-xs font-bold uppercase">
                        Featured
                    </span>
                )}
            </div>

            <h3 className="text-lg font-bold text-text-1 mb-1 group-hover:text-brand transition-colors">
                {plugin.name}
            </h3>
            <p className="text-sm text-text-2 mb-4 line-clamp-2 h-10">
                {plugin.desc}
            </p>

            <div className="mt-auto flex items-center justify-between text-xs text-text-3 border-t border-divider pt-3">
                <div className="flex items-center gap-2">
                    <span className="flex items-center gap-0.5 text-orange-400">
                        <Star className="w-3 h-3 fill-current" /> {plugin.rating}
                    </span>
                    <span>•</span>
                    <span>{plugin.downloads} installs</span>
                </div>
                <div className={clsx("font-semibold", plugin.price === "Free" ? "text-semantic-success" : "text-text-1")}>
                    {plugin.price}
                </div>
            </div>
        </Link>
    );
}
